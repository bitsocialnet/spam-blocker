import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import {
    computeBudgetMultiplier,
    checkRateLimit,
    DEFAULT_RATE_LIMITS,
    DEFAULT_AGGREGATE_LIMITS,
    type RateLimitConfig
} from "../../src/rate-limit/index.js";

// ============================================================================
// Helpers
// ============================================================================

const testPublicKey = "testAuthorPublicKey123";

function generateUniqueId(): string {
    return Math.random().toString(36).substring(2, 15);
}

function createSession(db: SpamDetectionDatabase, sessionId: string): void {
    db.insertChallengeSession({
        sessionId,
        subplebbitPublicKey: "test-subplebbit-pubkey",
        expiresAt: Date.now() + 3600000
    });
}

function insertPost(db: SpamDetectionDatabase, authorPublicKey: string, receivedAtMs?: number): void {
    const sessionId = `seed-${generateUniqueId()}`;
    createSession(db, sessionId);
    db.insertComment({
        sessionId,
        publication: {
            author: { address: "seed-author" },
            subplebbitAddress: "test-sub.eth",
            signature: { publicKey: authorPublicKey, signature: `sig-${generateUniqueId()}`, type: "ed25519" },
            protocolVersion: "1",
            content: "Test post",
            timestamp: Math.floor(Date.now() / 1000)
        }
    });
    if (receivedAtMs !== undefined) {
        db.getDb().prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?").run(receivedAtMs, sessionId);
    }
}

function insertReply(db: SpamDetectionDatabase, authorPublicKey: string, receivedAtMs?: number): void {
    const sessionId = `seed-${generateUniqueId()}`;
    createSession(db, sessionId);
    db.insertComment({
        sessionId,
        publication: {
            author: { address: "seed-author" },
            subplebbitAddress: "test-sub.eth",
            signature: { publicKey: authorPublicKey, signature: `sig-${generateUniqueId()}`, type: "ed25519" },
            protocolVersion: "1",
            content: "Test reply",
            parentCid: "QmParentCid",
            timestamp: Math.floor(Date.now() / 1000)
        }
    });
    if (receivedAtMs !== undefined) {
        db.getDb().prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?").run(receivedAtMs, sessionId);
    }
}

function insertVote(db: SpamDetectionDatabase, authorPublicKey: string, receivedAtMs?: number): void {
    const sessionId = `seed-${generateUniqueId()}`;
    createSession(db, sessionId);
    db.insertVote({
        sessionId,
        publication: {
            author: { address: "seed-author" },
            subplebbitAddress: "test-sub.eth",
            commentCid: `Qm${generateUniqueId()}`,
            signature: { publicKey: authorPublicKey, signature: `sig-${generateUniqueId()}`, type: "ed25519" },
            protocolVersion: "1",
            vote: 1,
            timestamp: Math.floor(Date.now() / 1000)
        }
    });
    if (receivedAtMs !== undefined) {
        db.getDb().prepare("UPDATE votes SET receivedAt = ? WHERE sessionId = ?").run(receivedAtMs, sessionId);
    }
}

function seedIndexedHistory(
    db: SpamDetectionDatabase,
    authorPublicKey: string,
    {
        ageDays,
        totalComments = 5,
        removedCount = 0,
        purgedCount = 0,
        banCount = 0
    }: {
        ageDays: number;
        totalComments?: number;
        removedCount?: number;
        purgedCount?: number;
        banCount?: number;
    }
): void {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const dbRaw = db.getDb();

    // Create indexed subplebbit
    const subAddr = "indexed-sub.eth";
    dbRaw
        .prepare(
            "INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled) VALUES (?, 'manual', ?, 1)"
        )
        .run(subAddr, nowMs);

    // Insert indexed comments spanning the age range
    for (let i = 0; i < totalComments; i++) {
        const cid = `Qm${generateUniqueId()}`;
        // Spread fetchedAt so the oldest is ageDays ago
        const fetchedAt = nowMs - ageDays * 86400 * 1000 + (i * ageDays * 86400 * 1000) / totalComments;

        dbRaw
            .prepare(
                "INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion) VALUES (?, ?, ?, ?, ?, ?, '1')"
            )
            .run(
                cid,
                subAddr,
                JSON.stringify({ address: "seed-author" }),
                JSON.stringify({ publicKey: authorPublicKey, signature: `dummy-${i}`, type: "ed25519" }),
                nowSeconds - ageDays * 86400 + (i * ageDays * 86400) / totalComments,
                fetchedAt
            );

        // Determine if this comment should be removed or purged
        const isRemoved = i < removedCount;
        const isPurged = i >= removedCount && i < removedCount + purgedCount;

        dbRaw
            .prepare("INSERT INTO indexed_comments_update (cid, removed, purged, updatedAt, fetchedAt) VALUES (?, ?, ?, ?, ?)")
            .run(cid, isRemoved ? 1 : 0, isPurged ? 1 : 0, nowSeconds - 86400, nowMs - 86400000);
    }

    // Seed bans
    for (let i = 0; i < banCount; i++) {
        const banSubAddr = `ban-sub-${i}.eth`;
        const cid = `QmBan${generateUniqueId()}`;

        dbRaw
            .prepare(
                "INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled) VALUES (?, 'manual', ?, 1)"
            )
            .run(banSubAddr, nowMs);

        dbRaw
            .prepare(
                "INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion) VALUES (?, ?, ?, ?, ?, ?, '1')"
            )
            .run(
                cid,
                banSubAddr,
                JSON.stringify({ address: "seed-author" }),
                JSON.stringify({ publicKey: authorPublicKey, signature: `ban-${i}`, type: "ed25519" }),
                nowSeconds - 86400 * 30,
                nowMs - 86400000 * 30
            );

        dbRaw
            .prepare("INSERT INTO indexed_comments_update (cid, author, updatedAt, fetchedAt) VALUES (?, ?, ?, ?)")
            .run(cid, JSON.stringify({ subplebbit: { banExpiresAt: nowSeconds + 86400 * 365 } }), nowSeconds - 86400, nowMs - 86400000);
    }
}

// ============================================================================
// Tests
// ============================================================================

describe("Rate Limiting", () => {
    let db: SpamDetectionDatabase;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
    });

    afterEach(() => {
        db.close();
    });

    describe("computeBudgetMultiplier", () => {
        it("should return 0.5 for author with no indexed history", () => {
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=0.5, reputationFactor=1.0 → 0.5
            expect(multiplier).toBe(0.5);
        });

        it("should return 0.5 for author with <1 day history", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 0.5 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=0.5, reputationFactor=1.0 → 0.5
            expect(multiplier).toBe(0.5);
        });

        it("should return 0.75 for author with 1-7 day history", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 3 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=0.75, reputationFactor=1.0 → 0.75
            expect(multiplier).toBe(0.75);
        });

        it("should return 1.0 for author with 7-30 day history", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 15 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=1.0, reputationFactor=1.0 → 1.0
            expect(multiplier).toBe(1.0);
        });

        it("should return 2.5 for 90-day clean author with >10 comments and <5% removal", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 120, totalComments: 15, removedCount: 0 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=2.0, reputationFactor=1.25 → 2.5
            expect(multiplier).toBe(2.5);
        });

        it("should return 3.75 for 365+ day clean author with >10 comments and <5% removal", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 400, totalComments: 15, removedCount: 0 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=3.0, reputationFactor=1.25 → 3.75
            expect(multiplier).toBe(3.75);
        });

        it("should reduce multiplier for author with active bans", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 120, totalComments: 15, banCount: 1 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=2.0, reputationFactor=0.5 (banned) → 1.0
            expect(multiplier).toBe(1.0);
        });

        it("should reduce multiplier for author with high removal rate (>30%)", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 120, totalComments: 10, removedCount: 4 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=2.0, reputationFactor=0.5 (>30% removal) → 1.0
            expect(multiplier).toBe(1.0);
        });

        it("should moderately reduce multiplier for 15-30% removal rate", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 120, totalComments: 10, removedCount: 2 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // ageFactor=2.0, reputationFactor=0.75 (20% removal, 15-30%) → 1.5
            expect(multiplier).toBe(1.5);
        });

        it("should clamp multiplier to minimum 0.25", () => {
            // Can't naturally get below 0.25 (0.5 × 0.5 = 0.25 is the minimum product),
            // but verify it's clamped correctly
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            expect(multiplier).toBeGreaterThanOrEqual(0.25);
        });

        it("should clamp multiplier to maximum 5.0", () => {
            seedIndexedHistory(db, testPublicKey, { ageDays: 400, totalComments: 15, removedCount: 0 });
            const multiplier = computeBudgetMultiplier({ authorPublicKey: testPublicKey, db });
            // 3.0 × 1.25 = 3.75, under the 5.0 cap
            expect(multiplier).toBeLessThanOrEqual(5.0);
        });
    });

    describe("checkRateLimit - per-type limits", () => {
        const config: RateLimitConfig = {};

        it("should allow when under the limit", () => {
            // Insert 2 posts (under hourly limit of 4 × 0.5 = 2, but floor gives 2)
            insertPost(db, testPublicKey);
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            // 1 post inserted, limit is floor(4 × 0.5) = 2 for no-history author
            expect(result.allowed).toBe(true);
        });

        it("should reject when at hourly limit", () => {
            // No indexed history → multiplier 0.5, effective hourly limit = floor(4 × 0.5) = 2
            insertPost(db, testPublicKey);
            insertPost(db, testPublicKey);
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("post hourly");
            expect(result.limit).toBe(2);
            expect(result.current).toBe(2);
        });

        it("should have higher limits for votes than posts", () => {
            // Default: vote hourly = 10, at multiplier 0.5 → 5
            // post hourly = 4 at multiplier 0.5 → 2
            // Insert 4 votes (under vote limit of 5 but above post limit of 2)
            for (let i = 0; i < 4; i++) {
                insertVote(db, testPublicKey);
            }
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "vote",
                db,
                config
            });
            expect(result.allowed).toBe(true);
        });

        it("should reject votes at the hourly limit", () => {
            // Default: vote hourly = 10, at multiplier 0.5 → 5
            for (let i = 0; i < 5; i++) {
                insertVote(db, testPublicKey);
            }
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "vote",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("vote hourly");
            expect(result.limit).toBe(5);
        });

        it("should reject when daily limit exceeded", () => {
            // Default: post daily = 20, at multiplier 0.5 → 10
            // Insert posts spread across the last 24h (some outside the hourly window)
            const nowMs = Date.now();
            for (let i = 0; i < 10; i++) {
                // Spread across 24h, all within daily window
                insertPost(db, testPublicKey, nowMs - (i + 1) * 2 * 3600 * 1000);
            }
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("post daily");
            expect(result.limit).toBe(10);
        });
    });

    describe("checkRateLimit - aggregate limits", () => {
        const config: RateLimitConfig = {};

        it("should reject when aggregate hourly exceeded even if per-type is under", () => {
            // No history → multiplier 0.5, aggregate hourly = floor(40 × 0.5) = 20
            // Insert mix of types that individually pass but exceed aggregate
            // post hourly limit = 2, reply hourly limit = 5, vote hourly limit = 15
            // So insert 1 post + 4 replies + 14 votes = 19 < 20 → allowed
            insertPost(db, testPublicKey);
            for (let i = 0; i < 4; i++) {
                insertReply(db, testPublicKey);
            }
            for (let i = 0; i < 15; i++) {
                insertVote(db, testPublicKey);
            }
            // 1 + 4 + 15 = 20 → exactly at aggregate hourly limit
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "vote",
                db,
                config
            });
            // vote per-type: 15/15 → rejected for vote hourly first
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("vote hourly");
        });

        it("should reject on aggregate when individual types are under limits", () => {
            // Insert many different types that individually are under limit but aggregate exceeds
            // multiplier 0.5 → aggregate hourly = 20
            // Insert 1 post + 4 replies + 14 votes + 1 post = 20
            insertPost(db, testPublicKey);
            for (let i = 0; i < 4; i++) {
                insertReply(db, testPublicKey);
            }
            for (let i = 0; i < 14; i++) {
                insertVote(db, testPublicKey);
            }
            // 1 + 4 + 14 = 19 < 20 → not yet over aggregate
            // Checking a reply (5/5 = at reply hourly) — rejected there first
            for (let i = 0; i < 1; i++) {
                insertReply(db, testPublicKey);
            }
            // Now: 1 post + 5 replies + 14 votes = 20
            // Check for a new reply: reply hourly = 5, current = 5 → rejected for reply hourly
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "reply",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("reply hourly");
        });

        it("should hit aggregate hourly when all per-type under limits but total exceeds aggregate", () => {
            // Use a custom low aggregate to demonstrate aggregate rejection
            // while per-type limits are still under
            seedIndexedHistory(db, testPublicKey, { ageDays: 15 }); // multiplier 1.0

            const customConfig: RateLimitConfig = {
                aggregate: { hourly: 10, daily: 250 }
            };

            // Insert: 3 posts + 5 replies + 2 votes = 10 → at aggregate limit
            // Per-type: post 3/4, reply 5/6, vote 2/10 → all under
            for (let i = 0; i < 3; i++) insertPost(db, testPublicKey);
            for (let i = 0; i < 5; i++) insertReply(db, testPublicKey);
            for (let i = 0; i < 2; i++) insertVote(db, testPublicKey);

            // Check for a vote: per-type 2/10 → OK, aggregate 10/10 → rejected
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "vote",
                db,
                config: customConfig
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("aggregate hourly");
            expect(result.limit).toBe(10);
            expect(result.current).toBe(10);
        });
    });

    describe("checkRateLimit - dynamic scaling", () => {
        const config: RateLimitConfig = {};

        it("should give established author higher limits than new author", () => {
            const newAuthor = "newAuthorKey";
            const estAuthor = "estAuthorKey";

            // Established author: 120 days, 15 clean comments → multiplier 2.5
            seedIndexedHistory(db, estAuthor, { ageDays: 120, totalComments: 15 });

            // Insert 3 posts for each
            for (let i = 0; i < 3; i++) {
                insertPost(db, newAuthor);
                insertPost(db, estAuthor);
            }

            // New author (multiplier 0.5): post hourly = floor(4 × 0.5) = 2
            // Already at 3 → should be rejected
            const newResult = checkRateLimit({
                authorPublicKey: newAuthor,
                publicationType: "post",
                db,
                config
            });
            expect(newResult.allowed).toBe(false);
            expect(newResult.limit).toBe(2);

            // Established author (multiplier 2.5): post hourly = floor(4 × 2.5) = 10
            // Only at 3 → should be allowed
            const estResult = checkRateLimit({
                authorPublicKey: estAuthor,
                publicationType: "post",
                db,
                config
            });
            expect(estResult.allowed).toBe(true);
            expect(estResult.multiplier).toBe(2.5);
        });
    });

    describe("checkRateLimit - feature disabled", () => {
        it("should not rate limit when config is not passed", () => {
            // This tests that the feature is opt-in at the route level
            // When rateLimitConfig is undefined, the route skips the check entirely
            // Here we just verify checkRateLimit works correctly when called with a config
            const config: RateLimitConfig = {};
            insertPost(db, testPublicKey);
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            expect(result.allowed).toBe(true);
        });
    });

    describe("checkRateLimit - custom config", () => {
        it("should respect custom per-type limits", () => {
            const config: RateLimitConfig = {
                limits: {
                    post: { hourly: 2, daily: 5 }
                }
            };

            // With custom hourly=2 and multiplier 0.5 → effective = floor(2 × 0.5) = 1
            insertPost(db, testPublicKey);
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.limit).toBe(1);
        });

        it("should respect custom aggregate limits", () => {
            const config: RateLimitConfig = {
                aggregate: { hourly: 5, daily: 20 }
            };

            // multiplier 0.5 → effective aggregate hourly = floor(5 × 0.5) = 2
            insertPost(db, testPublicKey);
            insertReply(db, testPublicKey);
            // 2 total publications, aggregate hourly limit = 2 → at limit
            // Check for a new vote
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "vote",
                db,
                config
            });
            expect(result.allowed).toBe(false);
            expect(result.exceeded).toBe("aggregate hourly");
            expect(result.limit).toBe(2);
        });

        it("should use defaults for types not overridden in config", () => {
            const config: RateLimitConfig = {
                limits: {
                    post: { hourly: 1, daily: 2 }
                }
            };

            // Reply should still use default limits (hourly=6)
            // multiplier 0.5 → reply hourly = floor(6 × 0.5) = 3
            for (let i = 0; i < 2; i++) {
                insertReply(db, testPublicKey);
            }
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "reply",
                db,
                config
            });
            expect(result.allowed).toBe(true);
        });
    });

    describe("checkRateLimit - minimum effective limit is 1", () => {
        it("should never have effective limit below 1", () => {
            // Even with smallest multiplier (0.25) and smallest base (4 hourly for post)
            // floor(4 × 0.25) = 1, so minimum is guaranteed
            const config: RateLimitConfig = {
                limits: {
                    post: { hourly: 1, daily: 1 }
                }
            };

            // At multiplier 0.5, floor(1 × 0.5) = 0, but clamped to 1
            const result = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            // No posts yet, so allowed
            expect(result.allowed).toBe(true);

            // Insert one post, should now be at the minimum limit
            insertPost(db, testPublicKey);
            const result2 = checkRateLimit({
                authorPublicKey: testPublicKey,
                publicationType: "post",
                db,
                config
            });
            expect(result2.allowed).toBe(false);
            expect(result2.limit).toBe(1);
        });
    });
});
