import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type SpamDetectionServer } from "../src/index.js";
import * as cborg from "cborg";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { signBufferEd25519, getPublicKeyFromPrivateKey, getPlebbitAddressFromPublicKey } from "../src/plebbit-js-signer.js";
import { resetPlebbitLoaderForTest, setPlebbitLoaderForTest } from "../src/subplebbit-resolver.js";
import { determineChallengeTier, validateChallengeTierConfig, DEFAULT_CHALLENGE_TIER_CONFIG } from "../src/risk-score/challenge-tier.js";

// Cloudflare Turnstile test keys
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const baseTimestamp = Math.floor(Date.now() / 1000);

// Signed property names for comment publications
const CommentSignedPropertyNames = [
    "timestamp",
    "flair",
    "subplebbitAddress",
    "author",
    "protocolVersion",
    "content",
    "spoiler",
    "nsfw",
    "link",
    "title",
    "linkWidth",
    "linkHeight",
    "linkHtmlTagName",
    "parentCid",
    "postCid"
];

const baseSubplebbitAuthor = {
    postScore: 0,
    replyScore: 0,
    firstCommentTimestamp: baseTimestamp - 86400,
    lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
};

// Signers
const testPrivateKey = Buffer.alloc(32, 7).toString("base64");
const authorPrivateKey = Buffer.alloc(32, 9).toString("base64");

let testPublicKey = "";
let authorPublicKey = "";
let authorPlebbitAddress = "";

let testSigner = {
    privateKey: testPrivateKey,
    publicKey: "",
    type: "ed25519"
};
let authorSigner = {
    privateKey: authorPrivateKey,
    publicKey: "",
    type: "ed25519"
};

// Helper to create a properly signed publication signature
const signPublication = async (
    publication: Record<string, unknown>,
    signer: { privateKey: string; publicKey: string },
    signedPropertyNames: string[]
) => {
    const propsToSign: Record<string, unknown> = {};
    for (const key of signedPropertyNames) {
        if (publication[key] !== undefined && publication[key] !== null) {
            propsToSign[key] = publication[key];
        }
    }

    const encoded = cborg.encode(propsToSign);
    const signatureBytes = await signBufferEd25519(encoded, signer.privateKey);

    return {
        type: "ed25519",
        signature: uint8ArrayToString(signatureBytes, "base64"),
        publicKey: signer.publicKey,
        signedPropertyNames: Object.keys(propsToSign)
    };
};

const createRequestSignature = async (propsToSign: Record<string, unknown>, signer = testSigner) => {
    const encoded = cborg.encode(propsToSign);
    const signatureBuffer = await signBufferEd25519(encoded, signer.privateKey);
    return {
        signature: signatureBuffer,
        publicKey: uint8ArrayFromString(signer.publicKey, "base64"),
        type: signer.type,
        signedPropertyNames: Object.keys(propsToSign)
    };
};

const injectCbor = async (fastify: SpamDetectionServer["fastify"], method: "POST" | "GET", url: string, payload?: unknown) => {
    const options: Parameters<typeof fastify.inject>[0] = {
        method,
        url,
        headers: {
            "content-type": "application/cbor",
            accept: "application/json"
        }
    };
    if (payload !== undefined) {
        options.body = Buffer.from(cborg.encode(payload));
    }
    return fastify.inject(options);
};

const createEvaluatePayload = async ({
    commentOverrides = {},
    authorOverrides = {},
    subplebbitOverrides = {},
    omitSubplebbitAuthor = false
}: {
    commentOverrides?: Record<string, unknown>;
    authorOverrides?: Record<string, unknown>;
    subplebbitOverrides?: Record<string, unknown>;
    omitSubplebbitAuthor?: boolean;
} = {}) => {
    // Build author WITHOUT subplebbit for signing (matches production flow)
    const authorForSigning: Record<string, unknown> = {
        address: authorPlebbitAddress,
        ...authorOverrides
    };

    const commentWithoutSignature: Record<string, unknown> = {
        author: authorForSigning,
        subplebbitAddress: "test-sub.eth",
        timestamp: baseTimestamp,
        protocolVersion: "1",
        content: "Hello world",
        ...commentOverrides
    };

    const publicationSignature = await signPublication(commentWithoutSignature, authorSigner, CommentSignedPropertyNames);

    // After signing, add author.subplebbit (matches production flow where
    // the subplebbit adds this field after the author signs)
    let finalAuthor: Record<string, unknown> = { ...authorForSigning };
    if (!omitSubplebbitAuthor) {
        finalAuthor.subplebbit = {
            ...baseSubplebbitAuthor,
            ...subplebbitOverrides
        };
    }

    const comment = {
        ...commentWithoutSignature,
        author: finalAuthor,
        signature: publicationSignature
    };

    const challengeRequest = { comment };
    const timestamp = Math.floor(Date.now() / 1000);
    const propsToSign = { challengeRequest, timestamp };
    const signature = await createRequestSignature(propsToSign, testSigner);

    return {
        ...propsToSign,
        signature
    };
};

describe("determineChallengeTier", () => {
    it("should return auto_accept for scores below autoAcceptThreshold", () => {
        expect(determineChallengeTier(0)).toBe("auto_accept");
        expect(determineChallengeTier(0.1)).toBe("auto_accept");
        expect(determineChallengeTier(0.19)).toBe("auto_accept");
    });

    it("should return oauth_sufficient for scores between autoAcceptThreshold and oauthSufficientThreshold", () => {
        expect(determineChallengeTier(0.2)).toBe("oauth_sufficient");
        expect(determineChallengeTier(0.3)).toBe("oauth_sufficient");
        expect(determineChallengeTier(0.39)).toBe("oauth_sufficient");
    });

    it("should return oauth_plus_more for scores between oauthSufficientThreshold and autoRejectThreshold", () => {
        expect(determineChallengeTier(0.4)).toBe("oauth_plus_more");
        expect(determineChallengeTier(0.5)).toBe("oauth_plus_more");
        expect(determineChallengeTier(0.79)).toBe("oauth_plus_more");
    });

    it("should return auto_reject for scores at or above autoRejectThreshold", () => {
        expect(determineChallengeTier(0.8)).toBe("auto_reject");
        expect(determineChallengeTier(0.9)).toBe("auto_reject");
        expect(determineChallengeTier(1.0)).toBe("auto_reject");
    });

    it("should use custom thresholds when provided", () => {
        const customConfig = {
            autoAcceptThreshold: 0.1,
            oauthSufficientThreshold: 0.3,
            autoRejectThreshold: 0.6
        };

        expect(determineChallengeTier(0.05, customConfig)).toBe("auto_accept");
        expect(determineChallengeTier(0.15, customConfig)).toBe("oauth_sufficient");
        expect(determineChallengeTier(0.4, customConfig)).toBe("oauth_plus_more");
        expect(determineChallengeTier(0.7, customConfig)).toBe("auto_reject");
    });

    it("should throw error for invalid threshold configuration", () => {
        expect(() => determineChallengeTier(0.5, { autoAcceptThreshold: 0.5, oauthSufficientThreshold: 0.3 })).toThrow(
            "autoAcceptThreshold must be less than oauthSufficientThreshold"
        );

        expect(() => determineChallengeTier(0.5, { oauthSufficientThreshold: 0.9, autoRejectThreshold: 0.7 })).toThrow(
            "oauthSufficientThreshold must be less than autoRejectThreshold"
        );
    });

    it("should handle boundary values correctly", () => {
        // At exactly autoAcceptThreshold, should be oauth_sufficient
        expect(determineChallengeTier(0.2)).toBe("oauth_sufficient");
        // At exactly oauthSufficientThreshold, should be oauth_plus_more
        expect(determineChallengeTier(0.4)).toBe("oauth_plus_more");
        // At exactly autoRejectThreshold, should be auto_reject
        expect(determineChallengeTier(0.8)).toBe("auto_reject");
    });
});

describe("validateChallengeTierConfig", () => {
    it("should pass for a valid config", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.2,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: 0.8
            })
        ).not.toThrow();
    });

    it("should pass for the default config", () => {
        expect(() => validateChallengeTierConfig(DEFAULT_CHALLENGE_TIER_CONFIG)).not.toThrow();
    });

    it("should throw when autoAcceptThreshold >= oauthSufficientThreshold", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.5,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: 0.8
            })
        ).toThrow("autoAcceptThreshold must be less than oauthSufficientThreshold");
    });

    it("should throw when autoAcceptThreshold equals oauthSufficientThreshold", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.4,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: 0.8
            })
        ).toThrow("autoAcceptThreshold must be less than oauthSufficientThreshold");
    });

    it("should throw when oauthSufficientThreshold >= autoRejectThreshold", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.2,
                oauthSufficientThreshold: 0.9,
                autoRejectThreshold: 0.8
            })
        ).toThrow("oauthSufficientThreshold must be less than autoRejectThreshold");
    });

    it("should throw when a threshold is NaN", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: NaN,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: 0.8
            })
        ).toThrow("autoAcceptThreshold must be a finite number");

        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.2,
                oauthSufficientThreshold: NaN,
                autoRejectThreshold: 0.8
            })
        ).toThrow("oauthSufficientThreshold must be a finite number");

        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.2,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: NaN
            })
        ).toThrow("autoRejectThreshold must be a finite number");
    });

    it("should throw when a threshold is Infinity", () => {
        expect(() =>
            validateChallengeTierConfig({
                autoAcceptThreshold: 0.2,
                oauthSufficientThreshold: 0.4,
                autoRejectThreshold: Infinity
            })
        ).toThrow("autoRejectThreshold must be a finite number");
    });
});

describe("Challenge Tier Integration", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        testPublicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
        authorPublicKey = await getPublicKeyFromPrivateKey(authorPrivateKey);
        authorPlebbitAddress = await getPlebbitAddressFromPublicKey(authorPublicKey);
        testSigner = { privateKey: testPrivateKey, publicKey: testPublicKey, type: "ed25519" };
        authorSigner = { privateKey: authorPrivateKey, publicKey: authorPublicKey, type: "ed25519" };

        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
    });

    afterEach(async () => {
        if (server) {
            await server.stop();
        }
        resetPlebbitLoaderForTest();
    });

    describe("Session creation with challenge tier and riskScore", () => {
        it("should store challengeTier and riskScore in session", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(200);
            const { sessionId } = response.json();

            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session).toBeDefined();
            expect(session?.riskScore).toBeTypeOf("number");
            expect(session?.riskScore).toBeGreaterThanOrEqual(0);
            expect(session?.riskScore).toBeLessThanOrEqual(1);
            // Challenge tier should be set based on risk score
            expect(["oauth_sufficient", "oauth_plus_more", null]).toContain(session?.challengeTier);
        });
    });

    describe("Iframe route with challenge tiers", () => {
        it("should serve turnstile iframe for oauth_sufficient tier", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
                // Set thresholds so most scores result in oauth_sufficient
                autoAcceptThreshold: 0,
                oauthSufficientThreshold: 0.99,
                autoRejectThreshold: 1.0
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId } = evalResponse.json();

            // Verify session has oauth_sufficient tier
            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session?.challengeTier).toBe("oauth_sufficient");

            const iframeResponse = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(iframeResponse.statusCode).toBe(200);
            expect(iframeResponse.body).toContain("cf-turnstile");
            expect(iframeResponse.body).toContain("Verify you are human");
        });

        it("should return 403 for auto_reject tier", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
                autoAcceptThreshold: 0,
                oauthSufficientThreshold: 0.001,
                autoRejectThreshold: 0.002
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload({
                omitSubplebbitAuthor: true
            });
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId, riskScore } = evalResponse.json();

            expect(riskScore).toBeGreaterThanOrEqual(0.002);

            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session?.status).toBe("failed");

            const iframeResponse = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(iframeResponse.statusCode).toBe(403);
            expect(iframeResponse.body).toContain("rejected");
        });

        it("should mark session as completed for auto_accept tier", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                autoAcceptThreshold: 1.1,
                oauthSufficientThreshold: 1.2,
                autoRejectThreshold: 1.3
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId } = evalResponse.json();

            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session?.status).toBe("completed");
        });
    });

    describe("Score adjustment after CAPTCHA", () => {
        it("should pass after CAPTCHA when adjusted score is below threshold (low risk)", async () => {
            // Use multiplier=0.7 and threshold=0.4 (defaults)
            // For this to pass: riskScore * 0.7 < 0.4 → riskScore < 0.571
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
                // Ensure score falls in challenge range (0.2–0.8)
                autoAcceptThreshold: 0,
                oauthSufficientThreshold: 0.99,
                autoRejectThreshold: 1.0,
                // Use defaults for score adjustment
                captchaScoreMultiplier: 0.7,
                challengePassThreshold: 0.4
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId, riskScore } = evalResponse.json();

            // For a standard user, riskScore should be moderate (0.3-0.5)
            // 0.4 * 0.7 = 0.28 < 0.4, so CAPTCHA should suffice

            // Access iframe first
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
            const completeBody = completeResponse.json();
            expect(completeBody.success).toBe(true);

            if (riskScore * 0.7 < 0.4) {
                // CAPTCHA alone was sufficient
                expect(completeBody.passed).toBe(true);
                expect(completeBody.oauthRequired).toBeUndefined();

                const session = server.db.getChallengeSessionBySessionId(sessionId);
                expect(session?.status).toBe("completed");
                expect(session?.captchaCompleted).toBe(1);
            } else {
                // CAPTCHA not sufficient, OAuth required
                expect(completeBody.passed).toBe(false);
                expect(completeBody.oauthRequired).toBe(true);

                const session = server.db.getChallengeSessionBySessionId(sessionId);
                expect(session?.status).toBe("pending");
                expect(session?.captchaCompleted).toBe(1);
            }
        });

        it("should require OAuth when adjusted score is above threshold (high risk)", async () => {
            // Use a very low multiplier threshold to force OAuth requirement
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
                oauth: {
                    github: { clientId: "test", clientSecret: "test" }
                },
                autoAcceptThreshold: 0,
                oauthSufficientThreshold: 0.99,
                autoRejectThreshold: 1.0,
                // Very low threshold so score * multiplier is always above it
                captchaScoreMultiplier: 0.99,
                challengePassThreshold: 0.01
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId, riskScore } = evalResponse.json();

            // riskScore is > 0 for any real scenario, so riskScore * 0.99 > 0.01

            // Access iframe first
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
            const completeBody = completeResponse.json();
            expect(completeBody.success).toBe(true);
            expect(completeBody.passed).toBe(false);
            expect(completeBody.oauthRequired).toBe(true);

            // Session should NOT be completed yet
            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session?.status).toBe("pending");
            expect(session?.captchaCompleted).toBe(1);
        });

        it("should complete session for oauth_sufficient tier after CAPTCHA with sufficient score reduction", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY,
                autoAcceptThreshold: 0,
                oauthSufficientThreshold: 0.99,
                autoRejectThreshold: 1.0,
                // Very generous: any score * 0.01 < 0.99 always passes
                captchaScoreMultiplier: 0.01,
                challengePassThreshold: 0.99
            });
            await server.fastify.ready();

            const payload = await createEvaluatePayload();
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            const { sessionId } = evalResponse.json();

            // Access iframe first
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
            const completeBody = completeResponse.json();
            expect(completeBody.success).toBe(true);
            expect(completeBody.passed).toBe(true);

            // Session should be completed
            const session = server.db.getChallengeSessionBySessionId(sessionId);
            expect(session?.status).toBe("completed");
        });
    });

    describe("Verify route with simplified error messages", () => {
        it("should return 'Challenge not yet completed' for any pending session", async () => {
            server = await createServer({
                port: 0,
                logging: false,
                databasePath: ":memory:",
                baseUrl: "http://localhost:3000",
                turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
                turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY
            });
            await server.fastify.ready();

            // Test with oauth_sufficient tier
            const captchaSession = server.db.insertChallengeSession({
                sessionId: "captcha-only-pending",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000,
                challengeTier: "oauth_sufficient",
                riskScore: 0.3
            });

            const createVerifyPayload = async (sessionId: string) => {
                const timestamp = Math.floor(Date.now() / 1000);
                const propsToSign = { sessionId, timestamp };
                const signature = await createRequestSignature(propsToSign);
                return { ...propsToSign, signature };
            };

            const payload1 = await createVerifyPayload(captchaSession.sessionId);
            const response1 = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload1);
            expect(response1.json().error).toBe("Challenge not yet completed");

            // Test with oauth_plus_more tier
            const combinedSession = server.db.insertChallengeSession({
                sessionId: "combined-pending",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000,
                challengeTier: "oauth_plus_more",
                riskScore: 0.6
            });

            const payload2 = await createVerifyPayload(combinedSession.sessionId);
            const response2 = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload2);
            expect(response2.json().error).toBe("Challenge not yet completed");

            // Test with captcha done but OAuth pending
            server.db.updateChallengeSessionCaptchaCompleted(combinedSession.sessionId);
            const payload3 = await createVerifyPayload(combinedSession.sessionId);
            const response3 = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload3);
            expect(response3.json().error).toBe("Challenge not yet completed");
        });
    });
});

describe("Database OAuth Provider Methods", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        testPublicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
        authorPublicKey = await getPublicKeyFromPrivateKey(authorPrivateKey);
        authorPlebbitAddress = await getPlebbitAddressFromPublicKey(authorPublicKey);
        testSigner = { privateKey: testPrivateKey, publicKey: testPublicKey, type: "ed25519" };
        authorSigner = { privateKey: authorPrivateKey, publicKey: authorPublicKey, type: "ed25519" };

        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));

        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        if (server) {
            await server.stop();
        }
        resetPlebbitLoaderForTest();
    });

    it("should extract provider names from OAuth identities", async () => {
        // Create a session and link it to a publication
        const payload = await createEvaluatePayload();
        const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
        const { sessionId } = response.json();

        // Mark session as completed with OAuth identity
        server.db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), "github:12345");

        // Get providers for the author
        const providers = server.db.getAuthorOAuthProviders(authorSigner.publicKey);
        expect(providers).toContain("github");
    });

    it("should return empty array for author with no OAuth history", async () => {
        const providers = server.db.getAuthorOAuthProviders("unknown-public-key");
        expect(providers).toEqual([]);
    });

    it("should return multiple providers when author has used several", async () => {
        // Create first session with github
        const payload1 = await createEvaluatePayload({ commentOverrides: { content: "test1" } });
        const response1 = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload1);
        const { sessionId: sessionId1 } = response1.json();
        server.db.updateChallengeSessionStatus(sessionId1, "completed", Date.now(), "github:12345");

        // Create second session with google
        const payload2 = await createEvaluatePayload({ commentOverrides: { content: "test2" } });
        const response2 = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload2);
        const { sessionId: sessionId2 } = response2.json();
        server.db.updateChallengeSessionStatus(sessionId2, "completed", Date.now(), "google:67890");

        // Get providers for the author
        const providers = server.db.getAuthorOAuthProviders(authorSigner.publicKey);
        expect(providers).toContain("github");
        expect(providers).toContain("google");
        expect(providers).toHaveLength(2);
    });
});
