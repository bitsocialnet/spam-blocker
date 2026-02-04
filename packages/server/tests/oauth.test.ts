import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type SpamDetectionServer } from "../src/index.js";
import { resetPlebbitLoaderForTest, setPlebbitLoaderForTest } from "../src/subplebbit-resolver.js";

// Mock OAuth config - we use fake credentials since we're not actually hitting OAuth providers
const mockOAuthConfig = {
    github: {
        clientId: "test-github-client-id",
        clientSecret: "test-github-client-secret"
    },
    google: {
        clientId: "test-google-client-id",
        clientSecret: "test-google-client-secret"
    }
};

describe("OAuth Challenge Flow", () => {
    let server: SpamDetectionServer;
    let sessionId: string;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        // Create a test challenge session (internal timestamps are in milliseconds)
        sessionId = "test-oauth-session-" + Date.now();
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: Date.now() + 3600 * 1000
        });
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    describe("GET /api/v1/iframe/:sessionId (OAuth mode)", () => {
        it("should serve OAuth iframe HTML with sign-in buttons", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toContain("text/html");
            expect(response.body).toContain("<!DOCTYPE html>");
            expect(response.body).toContain("Sign in with GitHub");
            expect(response.body).toContain("Sign in with Google");
            expect(response.body).toContain("Verify your identity");
            expect(response.body).toContain(sessionId);
        });

        it("should include privacy note in OAuth iframe", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.body).toContain("Your account info is not shared");
        });
    });

    describe("GET /api/v1/oauth/:provider/start", () => {
        it("should redirect to GitHub OAuth for valid session", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/github/start?sessionId=${sessionId}`
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain("github.com/login/oauth/authorize");
            expect(response.headers.location).toContain("client_id=test-github-client-id");
        });

        it("should redirect to Google OAuth for valid session", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/google/start?sessionId=${sessionId}`
            });

            expect(response.statusCode).toBe(302);
            expect(response.headers.location).toContain("accounts.google.com");
            expect(response.headers.location).toContain("client_id=test-google-client-id");
        });

        it("should store OAuth state in database", async () => {
            await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/github/start?sessionId=${sessionId}`
            });

            // Check that an OAuth state was created
            const db = server.db.getDb();
            const state = db.prepare("SELECT * FROM oauthStates WHERE sessionId = ?").get(sessionId) as {
                state: string;
                sessionId: string;
                provider: string;
            };

            expect(state).toBeDefined();
            expect(state.sessionId).toBe(sessionId);
            expect(state.provider).toBe("github");
        });

        it("should return 400 for invalid session", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/oauth/github/start?sessionId=invalid-session"
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return 400 for unconfigured provider", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/twitter/start?sessionId=${sessionId}`
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain("Provider not configured");
        });

        it("should return 410 for expired session", async () => {
            // Create an expired session
            const expiredSessionId = "expired-session-" + Date.now();
            server.db.insertChallengeSession({
                sessionId: expiredSessionId,
                subplebbitPublicKey: "test-pk",
                expiresAt: Date.now() - 100 * 1000 // Already expired (milliseconds)
            });

            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/github/start?sessionId=${expiredSessionId}`
            });

            expect(response.statusCode).toBe(410);
        });
    });

    describe("GET /api/v1/oauth/status/:sessionId", () => {
        it("should return completed: false for pending session", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/status/${sessionId}`
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.completed).toBe(false);
            expect(body.status).toBe("pending");
        });

        it("should return completed: true after session is completed", async () => {
            // Mark session as completed
            server.db.updateChallengeSessionStatus(sessionId, "completed", Date.now());

            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/oauth/status/${sessionId}`
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.completed).toBe(true);
            expect(body.status).toBe("completed");
        });

        it("should return error for non-existent session", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/oauth/status/non-existent-session"
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.completed).toBe(false);
            expect(body.error).toBe("Session not found");
        });
    });

    describe("GET /api/v1/oauth/:provider/callback", () => {
        it("should return error page for missing code", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/oauth/github/callback?state=some-state"
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toContain("text/html");
            expect(response.body).toContain("Missing authorization code");
        });

        it("should return error page for invalid state", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/oauth/github/callback?code=test-code&state=invalid-state"
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toContain("text/html");
            expect(response.body).toContain("Invalid or expired state");
        });

        it("should return error page for OAuth error from provider", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/oauth/github/callback?error=access_denied&error_description=User+denied+access"
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toContain("text/html");
            expect(response.body).toContain("User denied access");
        });
    });
});

describe("OAuth Database Methods", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000"
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should insert and retrieve OAuth state", () => {
        const nowMs = Date.now();

        // Create challenge session first (required by foreign key, timestamps in ms)
        server.db.insertChallengeSession({
            sessionId: "test-session",
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        const state = server.db.insertOAuthState({
            state: "test-state-123",
            sessionId: "test-session",
            provider: "github",
            createdAt: nowMs,
            expiresAt: nowMs + 600 * 1000
        });

        expect(state.state).toBe("test-state-123");
        expect(state.provider).toBe("github");

        const retrieved = server.db.getOAuthState("test-state-123");
        expect(retrieved).toBeDefined();
        expect(retrieved!.sessionId).toBe("test-session");
        expect(retrieved!.provider).toBe("github");
    });

    it("should delete OAuth state", () => {
        const nowMs = Date.now();

        // Create challenge session first (timestamps in ms)
        server.db.insertChallengeSession({
            sessionId: "test-session",
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        server.db.insertOAuthState({
            state: "state-to-delete",
            sessionId: "test-session",
            provider: "google",
            createdAt: nowMs,
            expiresAt: nowMs + 600 * 1000
        });

        const deleted = server.db.deleteOAuthState("state-to-delete");
        expect(deleted).toBe(true);

        const retrieved = server.db.getOAuthState("state-to-delete");
        expect(retrieved).toBeUndefined();
    });

    it("should store code verifier for PKCE providers", () => {
        const nowMs = Date.now();

        // Create challenge session first (timestamps in ms)
        server.db.insertChallengeSession({
            sessionId: "test-session",
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        server.db.insertOAuthState({
            state: "pkce-state",
            sessionId: "test-session",
            provider: "google",
            codeVerifier: "test-code-verifier-abc123",
            createdAt: nowMs,
            expiresAt: nowMs + 600 * 1000
        });

        const retrieved = server.db.getOAuthState("pkce-state");
        expect(retrieved).toBeDefined();
        expect(retrieved!.codeVerifier).toBe("test-code-verifier-abc123");
    });

    it("should cleanup expired OAuth states", () => {
        const nowMs = Date.now();

        // Create challenge sessions first (timestamps in ms)
        server.db.insertChallengeSession({
            sessionId: "test-session",
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });
        server.db.insertChallengeSession({
            sessionId: "test-session-2",
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        // Insert expired state
        server.db.insertOAuthState({
            state: "expired-state",
            sessionId: "test-session",
            provider: "github",
            createdAt: nowMs - 1200 * 1000,
            expiresAt: nowMs - 600 * 1000 // Already expired
        });

        // Insert valid state
        server.db.insertOAuthState({
            state: "valid-state",
            sessionId: "test-session-2",
            provider: "github",
            createdAt: nowMs,
            expiresAt: nowMs + 600 * 1000 // Not expired
        });

        const cleaned = server.db.cleanupExpiredOAuthStates();
        expect(cleaned).toBe(1);

        expect(server.db.getOAuthState("expired-state")).toBeUndefined();
        expect(server.db.getOAuthState("valid-state")).toBeDefined();
    });
});

describe("OAuth Identity Storage", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000"
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should store OAuth identity when completing session", () => {
        const nowMs = Date.now();
        const sessionId = "oauth-identity-test-" + Date.now();

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        // Complete session with OAuth identity (timestamps in ms)
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, "github:12345678");

        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session).toBeDefined();
        expect(session!.status).toBe("completed");
        expect(session!.oauthIdentity).toBe("github:12345678");
    });

    it("should count OAuth identity completions", () => {
        const nowMs = Date.now();

        // Create multiple sessions with same OAuth identity (timestamps in ms)
        for (let i = 0; i < 3; i++) {
            const sessionId = `count-test-${i}-${Date.now()}`;
            server.db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "test-pk",
                expiresAt: nowMs + 3600 * 1000
            });
            server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, "google:987654321");
        }

        // Create one session with different identity
        const differentSessionId = `different-${Date.now()}`;
        server.db.insertChallengeSession({
            sessionId: differentSessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });
        server.db.updateChallengeSessionStatus(differentSessionId, "completed", nowMs, "github:111111");

        const count = server.db.countOAuthIdentityCompletions("google:987654321");
        expect(count).toBe(3);

        const differentCount = server.db.countOAuthIdentityCompletions("github:111111");
        expect(differentCount).toBe(1);

        const unknownCount = server.db.countOAuthIdentityCompletions("twitter:unknown");
        expect(unknownCount).toBe(0);
    });

    it("should count OAuth identity completions with time filter", () => {
        const nowMs = Date.now();
        const oneHourAgoMs = nowMs - 3600 * 1000;
        const twoHoursAgoMs = nowMs - 7200 * 1000;

        // Create old session (timestamps in ms)
        const oldSessionId = `old-${Date.now()}`;
        server.db.insertChallengeSession({
            sessionId: oldSessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });
        server.db.updateChallengeSessionStatus(oldSessionId, "completed", twoHoursAgoMs, "facebook:555");

        // Create recent session
        const recentSessionId = `recent-${Date.now()}`;
        server.db.insertChallengeSession({
            sessionId: recentSessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });
        server.db.updateChallengeSessionStatus(recentSessionId, "completed", nowMs, "facebook:555");

        // Without time filter - should get both
        const allCount = server.db.countOAuthIdentityCompletions("facebook:555");
        expect(allCount).toBe(2);

        // With time filter - should only get recent (timestamp in ms)
        const recentCount = server.db.countOAuthIdentityCompletions("facebook:555", oneHourAgoMs);
        expect(recentCount).toBe(1);
    });

    it("should preserve existing oauthIdentity when not provided", () => {
        const nowMs = Date.now();
        const sessionId = "preserve-identity-" + Date.now();

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        // First update with identity (timestamps in ms)
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, "apple:abc123");

        // Second update without identity (should preserve)
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs + 10000);

        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.oauthIdentity).toBe("apple:abc123");
    });
});

describe("OAuth-First Score Adjustment Logic", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
    });

    afterEach(async () => {
        if (server) await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should mark oauthCompleted without completing session for first OAuth in high-risk flow", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "high-risk-oauth-" + nowMs;

        // riskScore(0.8) * oauthMultiplier(0.6) = 0.48 >= passThreshold(0.4)
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.8
        });

        // Simulate first OAuth completion
        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        server.db.updateChallengeSessionStatus(sessionId, "pending", undefined, "github:12345");

        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.oauthCompleted).toBe(1);
        expect(session!.status).toBe("pending");
        expect(session!.oauthIdentity).toBe("github:12345");
    });

    it("should complete session for first OAuth in normal-risk flow", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "normal-risk-oauth-" + nowMs;

        // riskScore(0.5) * oauthMultiplier(0.6) = 0.30 < passThreshold(0.4)
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.5
        });

        // Simulate first OAuth completion — complete the session
        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, "github:12345");

        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.oauthCompleted).toBe(1);
        expect(session!.status).toBe("completed");
    });

    it("should accumulate multiple OAuth identities as JSON array", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "multi-oauth-" + nowMs;

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        // First OAuth
        server.db.updateChallengeSessionStatus(sessionId, "pending", undefined, "github:111");

        // Second OAuth (append as JSON array)
        const session1 = server.db.getChallengeSessionBySessionId(sessionId);
        const existing = session1!.oauthIdentity;
        expect(existing).toBe("github:111");

        // Manually append second identity like the oauth route does
        const newIdentity = JSON.stringify(["github:111", "google:222"]);
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, newIdentity);

        const session2 = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session2!.oauthIdentity).toBe(newIdentity);
        const parsed = JSON.parse(session2!.oauthIdentity!);
        expect(parsed).toEqual(["github:111", "google:222"]);
    });
});

describe("OAuth-First Polling Endpoint", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should return needsMore=true after first OAuth when score is high", async () => {
        const nowMs = Date.now();
        const sessionId = "poll-need-more-" + nowMs;

        // High risk score: 0.8 * 0.6 = 0.48 >= 0.4
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.8
        });

        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        server.db.updateChallengeSessionStatus(sessionId, "pending", undefined, "github:123");

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/oauth/status/${sessionId}`
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.completed).toBe(false);
        expect(body.oauthCompleted).toBe(true);
        expect(body.needsMore).toBe(true);
        expect(body.firstProvider).toBe("github");
        expect(body.status).toBe("pending");
    });

    it("should return needsMore=false when one OAuth is sufficient", async () => {
        const nowMs = Date.now();
        const sessionId = "poll-sufficient-" + nowMs;

        // Normal risk score: 0.5 * 0.6 = 0.30 < 0.4
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.5
        });

        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, "google:456");

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/oauth/status/${sessionId}`
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.completed).toBe(true);
        expect(body.oauthCompleted).toBe(true);
        expect(body.needsMore).toBe(false);
        expect(body.firstProvider).toBe("google");
    });

    it("should parse firstProvider from JSON array oauthIdentity", async () => {
        const nowMs = Date.now();
        const sessionId = "poll-json-identity-" + nowMs;

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.5
        });

        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        // Store identity as JSON array (multiple OAuth identities)
        server.db.updateChallengeSessionStatus(sessionId, "completed", nowMs, JSON.stringify(["github:111", "google:222"]));

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/oauth/status/${sessionId}`
        });

        const body = JSON.parse(response.body);
        expect(body.firstProvider).toBe("github");
    });
});

describe("CAPTCHA-as-Fallback Complete Route", () => {
    let server: SpamDetectionServer;

    // Cloudflare Turnstile test keys
    const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
    const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
    });

    afterEach(async () => {
        if (server) await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should apply combined OAuth + CAPTCHA multiplier when both completed", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "combined-multiplier-" + nowMs;

        // riskScore(0.8) * captchaMultiplier(0.7) = 0.56 >= 0.4 (FAIL alone)
        // riskScore(0.8) * oauthMultiplier(0.6) * captchaMultiplier(0.7) = 0.336 < 0.4 (PASS combined)
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.8
        });

        // Mark OAuth as completed first (simulate OAuth being done before CAPTCHA)
        server.db.updateChallengeSessionOAuthCompleted(sessionId);
        server.db.updateChallengeSessionStatus(sessionId, "pending", undefined, "github:123");

        // Access iframe
        await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        // Now complete CAPTCHA
        const completeResponse = await server.fastify.inject({
            method: "POST",
            url: "/api/v1/challenge/complete",
            payload: {
                sessionId,
                challengeResponse: "XXXX.DUMMY.TOKEN.XXXX",
                challengeType: "turnstile"
            }
        });

        expect(completeResponse.statusCode).toBe(200);
        const body = completeResponse.json();
        expect(body.success).toBe(true);
        expect(body.passed).toBe(true);

        // Session should be completed
        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.status).toBe("completed");
        expect(session!.captchaCompleted).toBe(1);
        expect(session!.oauthCompleted).toBe(1);
    });

    it("should return oauthRequired when CAPTCHA alone cannot pass", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "captcha-only-fail-" + nowMs;

        // riskScore(0.7) * captchaMultiplier(0.7) = 0.49 >= 0.4 (FAIL)
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.7
        });

        // Access iframe
        await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        // Complete CAPTCHA without OAuth
        const completeResponse = await server.fastify.inject({
            method: "POST",
            url: "/api/v1/challenge/complete",
            payload: {
                sessionId,
                challengeResponse: "XXXX.DUMMY.TOKEN.XXXX",
                challengeType: "turnstile"
            }
        });

        expect(completeResponse.statusCode).toBe(200);
        const body = completeResponse.json();
        expect(body.success).toBe(true);
        expect(body.passed).toBe(false);
        expect(body.oauthRequired).toBe(true);

        // Session should still be pending
        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.status).toBe("pending");
        expect(session!.captchaCompleted).toBe(1);
        expect(session!.oauthCompleted).toBe(0);
    });

    it("should pass with CAPTCHA alone for low risk scores", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "captcha-pass-" + nowMs;

        // riskScore(0.5) * captchaMultiplier(0.7) = 0.35 < 0.4 (PASS)
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.5
        });

        // Access iframe
        await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        // Complete CAPTCHA
        const completeResponse = await server.fastify.inject({
            method: "POST",
            url: "/api/v1/challenge/complete",
            payload: {
                sessionId,
                challengeResponse: "XXXX.DUMMY.TOKEN.XXXX",
                challengeType: "turnstile"
            }
        });

        expect(completeResponse.statusCode).toBe(200);
        const body = completeResponse.json();
        expect(body.success).toBe(true);
        expect(body.passed).toBe(true);
        expect(body.oauthRequired).toBeUndefined();

        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.status).toBe("completed");
    });
});

describe("OAuth-First Iframe Content", () => {
    let server: SpamDetectionServer;

    const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
    const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
    });

    afterEach(async () => {
        if (server) await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should show CAPTCHA fallback link when canPassWithCaptchaAlone is true", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "iframe-captcha-fallback-" + nowMs;

        // Low risk: canPassWithCaptchaAlone should be true
        // riskScore(0.5) * captchaMultiplier(0.7) = 0.35 < 0.4
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.5
        });

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain("I don't have a social account");
        expect(response.body).toContain("Sign in with GitHub");
        expect(response.body).toContain("Sign in with Google");
    });

    it("should hide CAPTCHA fallback link when canPassWithCaptchaAlone is false", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
            oauth: mockOAuthConfig
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "iframe-no-captcha-" + nowMs;

        // High risk: canPassWithCaptchaAlone should be false
        // riskScore(0.8) * captchaMultiplier(0.7) = 0.56 >= 0.4
        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000,
            riskScore: 0.8
        });

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain("I don't have a social account");
        // Should still show OAuth buttons
        expect(response.body).toContain("Sign in with GitHub");
    });

    it("should serve turnstile-only iframe when no OAuth configured", async () => {
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY
            // No OAuth config
        });
        await server.fastify.ready();

        const nowMs = Date.now();
        const sessionId = "iframe-turnstile-only-" + nowMs;

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        const response = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        expect(response.statusCode).toBe(200);
        // Should be a turnstile-only iframe, not OAuth-first
        expect(response.body).toContain("cf-turnstile");
        expect(response.body).not.toContain("Sign in with GitHub");
    });
});

describe("updateChallengeSessionOAuthCompleted", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit: vi.fn().mockResolvedValue({ signature: { publicKey: "test-pk" } }),
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000"
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should set oauthCompleted to 1", () => {
        const nowMs = Date.now();
        const sessionId = "oauth-completed-" + nowMs;

        server.db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-pk",
            expiresAt: nowMs + 3600 * 1000
        });

        // Initially should be 0
        let session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.oauthCompleted).toBe(0);

        // Mark oauth completed
        const result = server.db.updateChallengeSessionOAuthCompleted(sessionId);
        expect(result).toBe(true);

        session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session!.oauthCompleted).toBe(1);
    });

    it("should return false for non-existent session", () => {
        const result = server.db.updateChallengeSessionOAuthCompleted("nonexistent");
        expect(result).toBe(false);
    });
});
