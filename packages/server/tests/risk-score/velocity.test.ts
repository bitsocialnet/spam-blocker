import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateVelocity } from "../../src/risk-score/factors/velocity.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);

function createSignature(publicKey: string) {
    return {
        type: "ed25519",
        signature: "sig",
        publicKey,
        signedPropertyNames: ["author"]
    };
}

function createMockAuthor() {
    return {
        address: "12D3KooWTestAddress",
        subplebbit: {
            postScore: 0,
            replyScore: 0,
            firstCommentTimestamp: baseTimestamp - 86400,
            lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
        }
    };
}

function createMockChallengeRequest(
    pubType: "comment" | "vote",
    publicKey: string,
    isPost = true
): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    const base = {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never
    };

    const author = createMockAuthor();
    const signature = createSignature(publicKey);

    if (pubType === "comment") {
        return {
            ...base,
            comment: {
                author,
                subplebbitAddress: "test-sub.eth",
                timestamp: baseTimestamp,
                protocolVersion: "1",
                signature,
                content: "Test content",
                parentCid: isPost ? undefined : "QmParentCid"
            }
        } as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
    }
    // vote
    return {
        ...base,
        vote: {
            author,
            subplebbitAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature,
            commentCid: "QmCommentCid",
            vote: 1
        }
    } as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

describe("calculateVelocity", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;
    const testPublicKey = "testAuthorPublicKey123";

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);
    });

    afterEach(() => {
        db.close();
    });

    describe("per-type velocity (existing behavior)", () => {
        it("should return low score for author with no prior activity", () => {
            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            expect(result.score).toBe(0.1); // NORMAL score
            expect(result.weight).toBe(0.1);
            expect(result.explanation).toContain("post");
            expect(result.explanation).toContain("0/hr");
        });

        it("should return high score for excessive posts", () => {
            // Insert 15 posts from this author (above BOT_LIKE threshold of 12)
            for (let i = 0; i < 15; i++) {
                const sessionId = `challenge-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey)
                        // No parentCid = post
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            expect(result.score).toBe(0.95); // BOT_LIKE score
            expect(result.explanation).toContain("15/hr");
            expect(result.explanation).toContain("likely automated");
        });

        it("should have higher thresholds for votes", () => {
            // Insert 25 votes - above NORMAL (20) but below ELEVATED (40)
            for (let i = 0; i < 25; i++) {
                const sessionId = `vote-challenge-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest("vote", testPublicKey);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            expect(result.score).toBe(0.4); // ELEVATED score (25 is between 20 and 40)
            expect(result.explanation).toContain("25/hr");
        });
    });

    describe("aggregate velocity", () => {
        it("should flag when aggregate across types exceeds thresholds even if individual types are normal", () => {
            // Insert activities that are normal for each type but excessive in aggregate:
            // 2 posts (NORMAL for posts)
            // 5 replies (NORMAL for replies)
            // 19 votes (NORMAL for votes)
            // 3 edits (NORMAL for edits)
            // 5 moderations (NORMAL for moderations)
            // Total: 34 publications/hour - above aggregate NORMAL (25) but below ELEVATED (50)

            // But let's push it higher: make aggregate clearly suspicious
            // 5 posts + 10 replies + 40 votes + 5 edits + 5 mods = 65 total (SUSPICIOUS aggregate)

            // Posts
            for (let i = 0; i < 5; i++) {
                const sessionId = `post-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey)
                    }
                });
            }

            // Replies
            for (let i = 0; i < 10; i++) {
                const sessionId = `reply-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        parentCid: "QmParent"
                    }
                });
            }

            // Votes
            for (let i = 0; i < 40; i++) {
                const sessionId = `vote-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            // Total: 55 publications, aggregate SUSPICIOUS (50-80)
            // Individual: 5 posts (elevated), 10 replies (elevated), 40 votes (elevated)

            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Should flag as SUSPICIOUS from aggregate (55 > 50)
            expect(result.score).toBe(0.7); // SUSPICIOUS score
            expect(result.explanation).toContain("aggregate");
            expect(result.explanation).toContain("55/hr");
        });

        it("should flag BOT_LIKE when aggregate exceeds 150/hour", () => {
            // Insert 160 votes (each one normal for votes at 20/hr threshold but massive aggregate)
            for (let i = 0; i < 160; i++) {
                const sessionId = `vote-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            // For a new post, vote velocity wouldn't flag it directly
            // But aggregate (160) exceeds BOT_LIKE (150)
            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Should flag as BOT_LIKE from aggregate
            expect(result.score).toBe(0.95);
            expect(result.explanation).toContain("aggregate");
        });
    });

    describe("cross-type velocity penalty", () => {
        it("should apply 50% penalty to posts when vote velocity is high", () => {
            // Insert 150 votes (BOT_LIKE for votes: > 100)
            for (let i = 0; i < 150; i++) {
                const sessionId = `vote-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            // Insert 1 post (NORMAL for posts)
            db.insertChallengeSession({ sessionId: "post-1", subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
            db.insertComment({
                sessionId: "post-1",
                publication: {
                    author: createMockAuthor(),
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    signature: createSignature(testPublicKey)
                }
            });

            // Now submit a new post
            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Per-type post velocity: 1/hr = NORMAL (0.1)
            // Vote velocity: 150/hr = BOT_LIKE (0.95)
            // Cross-type penalty: 0.1 + (0.95 - 0.1) * 0.5 = 0.525
            // Aggregate: 151/hr = BOT_LIKE (0.95) - this will be highest
            // Final score: max(0.1, 0.95, 0.525) = 0.95

            expect(result.score).toBe(0.95);
            // Should mention cross-type penalty in explanation
            expect(result.explanation).toContain("cross-type penalty");
            expect(result.explanation).toContain("vote");
        });

        it("should apply cross-type penalty when evaluating votes with high reply velocity", () => {
            // Insert 30 replies (BOT_LIKE for replies: > 25)
            for (let i = 0; i < 30; i++) {
                const sessionId = `reply-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        parentCid: "QmParent"
                    }
                });
            }

            // Submit a vote (0 prior votes = NORMAL)
            const challengeRequest = createMockChallengeRequest("vote", testPublicKey);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Per-type vote velocity: 0/hr = NORMAL (0.1)
            // Reply velocity: 30/hr = BOT_LIKE (0.95)
            // Cross-type penalty: 0.1 + (0.95 - 0.1) * 0.5 = 0.525
            // Aggregate: 30/hr = ELEVATED (0.4) - between 25 and 50

            // Final score should be 0.525 (cross-type penalty)
            expect(result.score).toBe(0.525);
            expect(result.explanation).toContain("cross-type penalty");
            expect(result.explanation).toContain("reply");
        });

        it("should not apply cross-type penalty when other types have lower velocity", () => {
            // Insert 15 posts (BOT_LIKE for posts: > 12)
            for (let i = 0; i < 15; i++) {
                const sessionId = `post-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey)
                    }
                });
            }

            // Submit another post (current type already has high velocity)
            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Per-type: 15/hr = BOT_LIKE (0.95)
            // Other types: 0/hr = NORMAL (0.1) - lower than current
            // No cross-type penalty should be applied

            expect(result.score).toBe(0.95);
            expect(result.explanation).not.toContain("cross-type penalty");
        });
    });

    describe("combined scenarios", () => {
        it("should handle author with 1 comment and 150 votes correctly", () => {
            // This is the exact scenario from the user's question

            // Insert 1 comment
            db.insertChallengeSession({ sessionId: "comment-1", subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
            db.insertComment({
                sessionId: "comment-1",
                publication: {
                    author: createMockAuthor(),
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    signature: createSignature(testPublicKey)
                }
            });

            // Insert 150 votes
            for (let i = 0; i < 150; i++) {
                const sessionId = `vote-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            // Now when they submit a new comment, it should be flagged
            const challengeRequest = createMockChallengeRequest("comment", testPublicKey, true);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Per-type post: 1/hr = NORMAL (0.1)
            // Vote velocity: 150/hr = BOT_LIKE (0.95)
            // Cross-type penalty: 0.1 + (0.95 - 0.1) * 0.5 = 0.525
            // Aggregate: 151/hr = BOT_LIKE (0.95)

            expect(result.score).toBe(0.95); // BOT_LIKE from aggregate
            expect(result.explanation).toContain("aggregate");
        });

        it("should also flag when evaluating a new vote with the same history", () => {
            // Same setup: 1 comment + 150 votes

            db.insertChallengeSession({ sessionId: "comment-1", subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
            db.insertComment({
                sessionId: "comment-1",
                publication: {
                    author: createMockAuthor(),
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    signature: createSignature(testPublicKey)
                }
            });

            for (let i = 0; i < 150; i++) {
                const sessionId = `vote-${i}`;
                db.insertChallengeSession({ sessionId, subplebbitPublicKey: "pk", expiresAt: baseTimestamp + 3600 });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: createMockAuthor(),
                        subplebbitAddress: "test-sub.eth",
                        timestamp: baseTimestamp,
                        protocolVersion: "1",
                        signature: createSignature(testPublicKey),
                        commentCid: `QmComment${i}`,
                        vote: 1
                    }
                });
            }

            // Submit a new vote
            const challengeRequest = createMockChallengeRequest("vote", testPublicKey);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateVelocity(ctx, 0.1);

            // Per-type vote: 150/hr = BOT_LIKE (0.95)
            expect(result.score).toBe(0.95);
        });
    });
});
