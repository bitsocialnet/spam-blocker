import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateSocialVerification } from "../../src/risk-score/factors/social-verification.js";
import { calculateRiskScore } from "../../src/risk-score/index.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);

function createMockSignature(publicKey: string = "pk1") {
    return {
        type: "ed25519",
        signature: "sig",
        publicKey,
        signedPropertyNames: ["author"]
    };
}

function createMockAuthor(address: string = "12D3KooWTestAddress") {
    return {
        address
    };
}

function createMockChallengeRequest(authorPublicKey: string = "pk1"): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        comment: {
            author: createMockAuthor(),
            subplebbitAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: createMockSignature(authorPublicKey),
            content: "Test content"
        }
    } as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

describe("calculateSocialVerification", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);
    });

    afterEach(() => {
        db.close();
    });

    function createContext(authorPublicKey: string = "pk1"): RiskContext {
        return {
            challengeRequest: createMockChallengeRequest(authorPublicKey),
            now: baseTimestamp,
            hasIpInfo: false,
            db,
            combinedData
        };
    }

    function insertOAuthSession(params: {
        sessionId: string;
        oauthIdentity: string;
        authorPublicKey: string;
        status?: "completed" | "pending" | "failed";
    }) {
        const { sessionId, oauthIdentity, authorPublicKey, status = "completed" } = params;

        db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "subpk",
            expiresAt: Date.now() + 3600000
        });

        // Mark session as completed with OAuth identity
        db.updateChallengeSessionStatus(sessionId, status, Date.now(), oauthIdentity);

        // Insert a comment to link the session to the author
        db.insertComment({
            sessionId,
            publication: {
                author: createMockAuthor(),
                subplebbitAddress: "test-sub.eth",
                timestamp: baseTimestamp,
                protocolVersion: "1",
                signature: createMockSignature(authorPublicKey),
                content: "Test content"
            }
        });
    }

    describe("OAuth disabled", () => {
        it("should return weight=0 (skipped) when no OAuth providers are enabled", () => {
            const ctx = createContext();
            const result = calculateSocialVerification(ctx, 0.08, []);

            expect(result.weight).toBe(0);
            expect(result.name).toBe("socialVerification");
            expect(result.explanation).toContain("disabled");
        });
    });

    describe("OAuth enabled, no verification", () => {
        it("should return score=1.0 when OAuth enabled but author has no verification", () => {
            const ctx = createContext();
            const result = calculateSocialVerification(ctx, 0.08, ["google", "github"]);

            expect(result.score).toBe(1.0);
            expect(result.weight).toBe(0.08);
            expect(result.explanation).toContain("No OAuth verification");
        });
    });

    describe("OAuth enabled, single provider verified", () => {
        it("should return score ~0.40 for single strong provider (Google)", () => {
            insertOAuthSession({
                sessionId: "session1",
                oauthIdentity: "google:123456",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google", "github"]);

            // Google credibility = 1.0, score = 1 - 0.75*1 + 0.15*1 = 0.40
            expect(result.score).toBeCloseTo(0.4, 2);
            expect(result.weight).toBe(0.08);
            expect(result.explanation).toContain("google");
        });

        it("should return score ~0.496 for single GitHub provider", () => {
            insertOAuthSession({
                sessionId: "session1",
                oauthIdentity: "github:789",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // GitHub credibility = 0.8, score = 1 - 0.75*0.8 + 0.15*0.64 = 0.496
            expect(result.score).toBeCloseTo(0.496, 2);
            expect(result.explanation).toContain("github");
        });

        it("should return score ~0.66 for single weak provider (Yandex)", () => {
            insertOAuthSession({
                sessionId: "session1",
                oauthIdentity: "yandex:456",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["yandex"]);

            // Yandex credibility = 0.5, score = 1 - 0.75*0.5 + 0.15*0.25 = 0.6625
            expect(result.score).toBeCloseTo(0.66, 2);
        });

        it("should handle unknown provider with default credibility 0.5", () => {
            insertOAuthSession({
                sessionId: "session1",
                oauthIdentity: "unknownprovider:123",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["unknownprovider"]);

            // Unknown credibility = 0.5, same as yandex
            expect(result.score).toBeCloseTo(0.66, 2);
        });
    });

    describe("OAuth enabled, multiple providers verified", () => {
        it("should combine credibility with 70% decay for second provider", () => {
            insertOAuthSession({
                sessionId: "session1",
                oauthIdentity: "google:123",
                authorPublicKey: "pk1"
            });
            insertOAuthSession({
                sessionId: "session2",
                oauthIdentity: "github:456",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google", "github"]);

            // Google: 1.0 * 1.0 = 1.0
            // GitHub: 0.8 * 0.7 = 0.56
            // Combined: 1.56
            // Score: 1 - 0.75*1.56 + 0.15*1.56^2 = 1 - 1.17 + 0.365 = 0.195
            expect(result.score).toBeCloseTo(0.195, 1);
            expect(result.explanation).toContain("2 providers");
        });

        it("should cap combined credibility at 2.5", () => {
            // Add 5 strong providers
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:1", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "github:2", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "twitter:3", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s4", oauthIdentity: "discord:4", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s5", oauthIdentity: "tiktok:5", authorPublicKey: "pk1" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google", "github", "twitter", "discord", "tiktok"]);

            // With cap at 2.5, score = 1 - 0.75*2.5 + 0.15*2.5^2 = 1 - 1.875 + 0.9375 = 0.0625
            expect(result.score).toBeLessThanOrEqual(0.1);
            expect(result.score).toBeGreaterThanOrEqual(0.03);
        });
    });

    describe("Multi-author reuse (1/n² with cap at 3)", () => {
        it("should apply 1/n² reuse factor when same OAuth is used by 2 authors", () => {
            // Same Google account used by pk1 and pk2
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:shared", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "google:shared", authorPublicKey: "pk2" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Google credibility = 1.0, but 2 authors share it
            // Effective credibility = 1.0 * (1/2²) = 0.25
            // Score = 1 - 0.75*0.25 + 0.15*0.25^2 = 1 - 0.1875 + 0.009375 = 0.8219
            expect(result.score).toBeCloseTo(0.822, 2);
            expect(result.explanation).toContain("shared by 2 authors");
        });

        it("should apply 1/n² reuse factor when same OAuth is used by 3 authors", () => {
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:shared3", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "google:shared3", authorPublicKey: "pk2" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "google:shared3", authorPublicKey: "pk3" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Effective credibility = 1.0 * (1/3²) = 0.111
            // Score = 1 - 0.75*0.111 + 0.15*0.111^2 ≈ 0.919
            expect(result.score).toBeCloseTo(0.919, 2);
            expect(result.explanation).toContain("shared by 3 authors");
        });

        it("should completely discard identity when same OAuth is used by 4+ authors", () => {
            // Same Google account used by pk1, pk2, pk3, pk4
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:shared4", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "google:shared4", authorPublicKey: "pk2" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "google:shared4", authorPublicKey: "pk3" });
            insertOAuthSession({ sessionId: "s4", oauthIdentity: "google:shared4", authorPublicKey: "pk4" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Identity is discarded (reuseFactor = 0), effectiveCredibility = 0
            // Combined credibility = 0, score = 1.0 (unverified equivalent)
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("shared by 4 authors");
            expect(result.explanation).toContain("discarded");
        });

        it("should return score=1.0 when all identities are discarded due to 4+ authors", () => {
            // Two identities, both shared by 4+ authors
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:over", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "google:over", authorPublicKey: "pk2" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "google:over", authorPublicKey: "pk3" });
            insertOAuthSession({ sessionId: "s4", oauthIdentity: "google:over", authorPublicKey: "pk4" });
            insertOAuthSession({ sessionId: "s5", oauthIdentity: "google:over", authorPublicKey: "pk5" });

            insertOAuthSession({ sessionId: "s6", oauthIdentity: "github:over", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s7", oauthIdentity: "github:over", authorPublicKey: "pk6" });
            insertOAuthSession({ sessionId: "s8", oauthIdentity: "github:over", authorPublicKey: "pk7" });
            insertOAuthSession({ sessionId: "s9", oauthIdentity: "github:over", authorPublicKey: "pk8" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google", "github"]);

            // Both identities discarded → score = 1.0
            expect(result.score).toBe(1.0);
        });

        it("should not affect score for unique OAuth identity", () => {
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:unique", authorPublicKey: "pk1" });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // 1 author, no diminishing returns
            expect(result.score).toBeCloseTo(0.4, 2);
            expect(result.explanation).not.toContain("shared");
        });
    });

    describe("OAuth account age multiplier", () => {
        function insertOAuthSessionWithAge(params: {
            sessionId: string;
            oauthIdentity: string;
            authorPublicKey: string;
            accountCreatedAt: number | null;
        }) {
            const { sessionId, oauthIdentity, authorPublicKey, accountCreatedAt } = params;

            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "subpk",
                expiresAt: Date.now() + 3600000
            });

            db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), oauthIdentity);

            if (accountCreatedAt !== null) {
                db.updateChallengeSessionOAuthAccountCreatedAt(sessionId, accountCreatedAt);
            }

            db.insertComment({
                sessionId,
                publication: {
                    author: createMockAuthor(),
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    signature: createMockSignature(authorPublicKey),
                    content: "Test content"
                }
            });
        }

        it("should apply 0.3 multiplier for accounts < 7 days old", () => {
            const threeDaysAgo = baseTimestamp - 3 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:newaccount",
                authorPublicKey: "pk1",
                accountCreatedAt: threeDaysAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // GitHub credibility = 0.8 * reuseFactor(1) * ageMultiplier(0.3) = 0.24
            // Score = 1 - 0.75*0.24 + 0.15*0.24^2 = 1 - 0.18 + 0.00864 = 0.82864
            expect(result.score).toBeCloseTo(0.829, 2);
            expect(result.explanation).toContain("age multiplier: 0.3");
        });

        it("should apply 0.5 multiplier for accounts 7-30 days old", () => {
            const fifteenDaysAgo = baseTimestamp - 15 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:recent",
                authorPublicKey: "pk1",
                accountCreatedAt: fifteenDaysAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // Effective credibility = 0.8 * 0.5 = 0.4
            // Score = 1 - 0.75*0.4 + 0.15*0.16 = 0.724
            expect(result.score).toBeCloseTo(0.724, 2);
        });

        it("should apply 0.7 multiplier for accounts 30-90 days old", () => {
            const sixtyDaysAgo = baseTimestamp - 60 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:mid",
                authorPublicKey: "pk1",
                accountCreatedAt: sixtyDaysAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // Effective credibility = 0.8 * 0.7 = 0.56
            // Score = 1 - 0.75*0.56 + 0.15*0.3136 = 1 - 0.42 + 0.04704 = 0.62704
            expect(result.score).toBeCloseTo(0.627, 2);
        });

        it("should apply 0.9 multiplier for accounts 90-365 days old", () => {
            const sixMonthsAgo = baseTimestamp - 180 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:established",
                authorPublicKey: "pk1",
                accountCreatedAt: sixMonthsAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // Effective credibility = 0.8 * 0.9 = 0.72
            // Score = 1 - 0.75*0.72 + 0.15*0.5184 = 1 - 0.54 + 0.07776 = 0.53776
            expect(result.score).toBeCloseTo(0.538, 2);
        });

        it("should apply 1.0 multiplier for accounts > 365 days old", () => {
            const twoYearsAgo = baseTimestamp - 730 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:old",
                authorPublicKey: "pk1",
                accountCreatedAt: twoYearsAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // Effective credibility = 0.8 * 1.0 = 0.8
            // Score = 1 - 0.75*0.8 + 0.15*0.64 = 0.496
            expect(result.score).toBeCloseTo(0.496, 2);
        });

        it("should apply 1.0 multiplier (no penalty) for unknown creation date (null)", () => {
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "google:nulcreated",
                authorPublicKey: "pk1",
                accountCreatedAt: null
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Google credibility = 1.0, accountCreatedAt = null → multiplier = 1.0
            // Score = 0.40 (no penalty)
            expect(result.score).toBeCloseTo(0.4, 2);
            expect(result.explanation).not.toContain("age multiplier");
        });

        it("should stack reuse penalty and account age penalty", () => {
            // GitHub account shared by 2 authors AND only 3 days old
            const threeDaysAgo = baseTimestamp - 3 * 86400;
            insertOAuthSessionWithAge({
                sessionId: "s1",
                oauthIdentity: "github:sybil",
                authorPublicKey: "pk1",
                accountCreatedAt: threeDaysAgo
            });
            insertOAuthSessionWithAge({
                sessionId: "s2",
                oauthIdentity: "github:sybil",
                authorPublicKey: "pk2",
                accountCreatedAt: threeDaysAgo
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]);

            // GitHub credibility = 0.8
            // reuseFactor = 1/2² = 0.25
            // ageMultiplier = 0.3
            // effectiveCredibility = 0.8 * 0.25 * 0.3 = 0.06
            // Score = 1 - 0.75*0.06 + 0.15*0.06^2 ≈ 0.95554
            expect(result.score).toBeCloseTo(0.956, 2);
        });
    });

    describe("Edge cases", () => {
        it("should not count pending OAuth sessions", () => {
            insertOAuthSession({
                sessionId: "s1",
                oauthIdentity: "google:123",
                authorPublicKey: "pk1",
                status: "pending"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Pending session should not count
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("No OAuth verification");
        });

        it("should not count failed OAuth sessions", () => {
            insertOAuthSession({
                sessionId: "s1",
                oauthIdentity: "google:123",
                authorPublicKey: "pk1",
                status: "failed"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Failed session should not count
            expect(result.score).toBe(1.0);
        });

        it("should handle different author making request (no cross-author benefit)", () => {
            // pk1 is verified, but pk2 is not
            insertOAuthSession({
                sessionId: "s1",
                oauthIdentity: "google:123",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk2"); // Different author
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // pk2 has no OAuth links
            expect(result.score).toBe(1.0);
        });

        it("should handle provider with mixed case in identity", () => {
            insertOAuthSession({
                sessionId: "s1",
                oauthIdentity: "GOOGLE:123",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["google"]);

            // Should normalize provider name to lowercase
            expect(result.score).toBeCloseTo(0.4, 2);
        });

        it("should return high risk when author verified with disabled provider", () => {
            // Author verified with Google, but only GitHub is enabled
            insertOAuthSession({
                sessionId: "s1",
                oauthIdentity: "google:123",
                authorPublicKey: "pk1"
            });

            const ctx = createContext("pk1");
            const result = calculateSocialVerification(ctx, 0.08, ["github"]); // Google not in enabled list

            // Still counts because we're checking DB, not restricting by enabled providers
            // The enabled providers list is for determining if factor is skipped, not filtering identities
            expect(result.score).toBeCloseTo(0.4, 2);
        });
    });

    describe("Database query methods — OAuth account age", () => {
        it("updateChallengeSessionOAuthAccountCreatedAt stores and getOAuthAccountCreatedAt retrieves", () => {
            const sessionId = "age-session";
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "subpk",
                expiresAt: Date.now() + 3600000
            });
            db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), "github:age123");

            const createdAt = 1609459200; // 2021-01-01
            db.updateChallengeSessionOAuthAccountCreatedAt(sessionId, createdAt);

            const result = db.getOAuthAccountCreatedAt("github:age123");
            expect(result).toBe(createdAt);
        });

        it("getOAuthAccountCreatedAt returns null when no data stored", () => {
            const sessionId = "no-age-session";
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "subpk",
                expiresAt: Date.now() + 3600000
            });
            db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), "google:noage");

            const result = db.getOAuthAccountCreatedAt("google:noage");
            expect(result).toBeNull();
        });

        it("getOAuthAccountCreatedAt returns null for non-existent identity", () => {
            const result = db.getOAuthAccountCreatedAt("nonexistent:id");
            expect(result).toBeNull();
        });

        it("getOAuthAccountCreatedAt returns most recent session data", () => {
            // First session
            const sessionId1 = "age-session-old";
            db.insertChallengeSession({ sessionId: sessionId1, subplebbitPublicKey: "subpk", expiresAt: Date.now() + 3600000 });
            db.updateChallengeSessionStatus(sessionId1, "completed", Date.now() - 1000, "github:multi");
            db.updateChallengeSessionOAuthAccountCreatedAt(sessionId1, 1609459200);

            // Second session (newer)
            const sessionId2 = "age-session-new";
            db.insertChallengeSession({ sessionId: sessionId2, subplebbitPublicKey: "subpk", expiresAt: Date.now() + 3600000 });
            db.updateChallengeSessionStatus(sessionId2, "completed", Date.now(), "github:multi");
            db.updateChallengeSessionOAuthAccountCreatedAt(sessionId2, 1640995200); // 2022-01-01

            const result = db.getOAuthAccountCreatedAt("github:multi");
            expect(result).toBe(1640995200); // Should return the more recent session's data
        });
    });

    describe("Database query methods", () => {
        it("getAuthorOAuthIdentities returns all linked identities", () => {
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:1", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "github:2", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "twitter:3", authorPublicKey: "pk2" }); // Different author

            const identities = db.getAuthorOAuthIdentities("pk1");

            expect(identities).toHaveLength(2);
            expect(identities).toContain("google:1");
            expect(identities).toContain("github:2");
            expect(identities).not.toContain("twitter:3");
        });

        it("countAuthorsWithOAuthIdentity returns correct count", () => {
            insertOAuthSession({ sessionId: "s1", oauthIdentity: "google:shared", authorPublicKey: "pk1" });
            insertOAuthSession({ sessionId: "s2", oauthIdentity: "google:shared", authorPublicKey: "pk2" });
            insertOAuthSession({ sessionId: "s3", oauthIdentity: "google:shared", authorPublicKey: "pk3" });
            insertOAuthSession({ sessionId: "s4", oauthIdentity: "github:unique", authorPublicKey: "pk4" });

            expect(db.countAuthorsWithOAuthIdentity("google:shared")).toBe(3);
            expect(db.countAuthorsWithOAuthIdentity("github:unique")).toBe(1);
            expect(db.countAuthorsWithOAuthIdentity("nonexistent:id")).toBe(0);
        });

        it("should work with votes table", () => {
            const sessionId = "vote-session";
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "subpk",
                expiresAt: Date.now() + 3600000
            });
            db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), "google:voter");

            db.insertVote({
                sessionId,
                publication: {
                    author: createMockAuthor(),
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    signature: createMockSignature("voter-pk"),
                    commentCid: "QmTest",
                    vote: 1
                }
            });

            const identities = db.getAuthorOAuthIdentities("voter-pk");
            expect(identities).toContain("google:voter");
        });
    });
});

describe("calculateRiskScore integration — socialVerification factor", () => {
    let db: SpamDetectionDatabase;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
    });

    afterEach(() => {
        db.close();
    });

    function insertOAuthSession(params: { sessionId: string; oauthIdentity: string; authorPublicKey: string }) {
        const { sessionId, oauthIdentity, authorPublicKey } = params;

        db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "subpk",
            expiresAt: Date.now() + 3600000
        });

        db.updateChallengeSessionStatus(sessionId, "completed", Date.now(), oauthIdentity);

        db.insertComment({
            sessionId,
            publication: {
                author: { address: "12D3KooWTestAddress" },
                subplebbitAddress: "test-sub.eth",
                timestamp: baseTimestamp,
                protocolVersion: "1",
                signature: { type: "ed25519", signature: "sig", publicKey: authorPublicKey, signedPropertyNames: ["author"] },
                content: "Test content"
            }
        });
    }

    it("should include socialVerification with weight > 0 when enabledOAuthProviders is passed", () => {
        insertOAuthSession({ sessionId: "s1", oauthIdentity: "github:999", authorPublicKey: "pk1" });

        const result = calculateRiskScore({
            challengeRequest: createMockChallengeRequest("pk1"),
            db,
            enabledOAuthProviders: ["github"]
        });

        const svFactor = result.factors.find((f) => f.name === "socialVerification");
        expect(svFactor).toBeDefined();
        expect(svFactor!.weight).toBeGreaterThan(0);
        // GitHub credibility 1.0 → score ~0.40, so less than 1.0
        expect(svFactor!.score).toBeLessThan(1.0);
    });

    it("should skip socialVerification (weight=0) when enabledOAuthProviders is empty", () => {
        insertOAuthSession({ sessionId: "s1", oauthIdentity: "github:999", authorPublicKey: "pk1" });

        const result = calculateRiskScore({
            challengeRequest: createMockChallengeRequest("pk1"),
            db,
            enabledOAuthProviders: []
        });

        const svFactor = result.factors.find((f) => f.name === "socialVerification");
        expect(svFactor).toBeDefined();
        expect(svFactor!.weight).toBe(0);
    });

    it("should skip socialVerification (weight=0) when enabledOAuthProviders is omitted", () => {
        insertOAuthSession({ sessionId: "s1", oauthIdentity: "github:999", authorPublicKey: "pk1" });

        const result = calculateRiskScore({
            challengeRequest: createMockChallengeRequest("pk1"),
            db
            // enabledOAuthProviders deliberately omitted — defaults to []
        });

        const svFactor = result.factors.find((f) => f.name === "socialVerification");
        expect(svFactor).toBeDefined();
        expect(svFactor!.weight).toBe(0);
    });
});
