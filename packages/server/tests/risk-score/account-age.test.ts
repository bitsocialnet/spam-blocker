import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateAccountAge } from "../../src/risk-score/factors/account-age.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: "pk",
    signedPropertyNames: ["author"]
};

const SECONDS_PER_DAY = 24 * 60 * 60;

function createMockAuthor(firstCommentTimestamp?: number) {
    return {
        address: "12D3KooWTestAddress",
        subplebbit: firstCommentTimestamp
            ? {
                  postScore: 0,
                  replyScore: 0,
                  firstCommentTimestamp,
                  lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
              }
            : undefined
    };
}

function createMockChallengeRequest(author: ReturnType<typeof createMockAuthor>): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        comment: {
            author,
            subplebbitAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content: "Test content"
        }
    } as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

describe("calculateAccountAge", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;
    let indexerQueries: IndexerQueries;

    // Helper to ensure subplebbit exists for foreign key constraint
    function ensureIndexedSubplebbit(address: string) {
        db.getDb()
            .prepare(
                `INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt)
                 VALUES (?, ?, ?)`
            )
            .run(address, "manual", baseTimestamp);
    }

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);
        indexerQueries = new IndexerQueries(db.getDb());
    });

    afterEach(() => {
        db.close();
    });

    describe("with no history", () => {
        it("should return NO_HISTORY score when author has no subplebbit data and no DB history", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // No history = maximum risk (completely unknown author)
            expect(result.score).toBe(1.0);
            expect(result.weight).toBe(0.17);
            expect(result.explanation).toContain("No account history");
        });
    });

    describe("ignoring author.subplebbit.firstCommentTimestamp (security fix)", () => {
        it("should return NO_HISTORY even when firstCommentTimestamp claims old account", () => {
            // Subplebbit claims account is 400 days old, but we have no DB records
            // We should NOT trust this claim - it could be fabricated
            const firstCommentTimestamp = baseTimestamp - 400 * SECONDS_PER_DAY;
            const author = createMockAuthor(firstCommentTimestamp);
            const challengeRequest = createMockChallengeRequest(author);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should return NO_HISTORY because we don't trust firstCommentTimestamp
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("No account history");
        });

        it("should return NO_HISTORY even when firstCommentTimestamp claims recent account", () => {
            // Even if subplebbit provides a firstCommentTimestamp, we ignore it
            const firstCommentTimestamp = baseTimestamp - 3 * SECONDS_PER_DAY;
            const author = createMockAuthor(firstCommentTimestamp);
            const challengeRequest = createMockChallengeRequest(author);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should return NO_HISTORY because we don't trust firstCommentTimestamp
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("No account history");
        });
    });

    describe("using only indexed (accepted) comments", () => {
        it("should use indexer timestamp for account age", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            // Insert an indexed comment from 100 days ago
            const indexedTime = baseTimestamp - 100 * SECONDS_PER_DAY;
            ensureIndexedSubplebbit("test-sub.eth");
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "Qm100DaysOld",
                subplebbitAddress: "test-sub.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Old indexed comment",
                title: undefined,
                link: undefined,
                timestamp: indexedTime,
                depth: 0,
                protocolVersion: "1"
            });

            // Manually set fetchedAt to simulate old record
            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(indexedTime * 1000, "Qm100DaysOld");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // 100 days is between 90 and 365, so should be OLD score (0.2)
            expect(result.score).toBe(0.2);
            expect(result.explanation).toContain("100 days old");
            expect(result.explanation).toContain("established");
        });
    });

    describe("engine-only records should NOT affect account age", () => {
        it("should return NO_HISTORY even when engine has old records (spam blocker rejections)", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            // Insert a comment in ENGINE tables from 200 days ago
            // This simulates a spammer who keeps submitting but gets rejected
            const engineTime = baseTimestamp - 200 * SECONDS_PER_DAY;
            const sessionId = "rejected-spam";
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });

            db.insertComment({
                sessionId,
                publication: {
                    author: { address: author.address },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: engineTime,
                    protocolVersion: "1",
                    signature: baseSignature,
                    content: "Rejected spam comment"
                }
            });

            // Manually update receivedAt on the comment to simulate old record
            db.getDb()
                .prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?")
                .run(engineTime * 1000, sessionId);

            // NO indexer records - the comment was never accepted by the subplebbit

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should return NO_HISTORY because engine records are ignored
            // A spammer should not get "old account" credit for rejected submissions
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("No account history");
        });
    });

    describe("indexer-only scoring (ignoring subplebbit claims)", () => {
        it("should use only indexer timestamp even when subplebbit claims different age", () => {
            // Subplebbit says first comment was 30 days ago, but we ignore this
            const subplebbitFirstComment = baseTimestamp - 30 * SECONDS_PER_DAY;
            const author = createMockAuthor(subplebbitFirstComment);
            const challengeRequest = createMockChallengeRequest(author);

            // Our indexer shows they have an indexed comment from 200 days ago
            const indexedTime = baseTimestamp - 200 * SECONDS_PER_DAY;
            ensureIndexedSubplebbit("test-sub.eth");
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "Qm200DaysOld",
                subplebbitAddress: "test-sub.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Very old indexed comment",
                title: undefined,
                link: undefined,
                timestamp: indexedTime,
                depth: 0,
                protocolVersion: "1"
            });

            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(indexedTime * 1000, "Qm200DaysOld");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should use indexer's 200 days -> OLD score (0.2)
            expect(result.score).toBe(0.2);
            expect(result.explanation).toContain("200 days old");
        });

        it("should NOT use subplebbit timestamp even when it claims older than indexed data", () => {
            // Subplebbit claims 500 days old - could be fabricated by malicious sub owner
            const subplebbitFirstComment = baseTimestamp - 500 * SECONDS_PER_DAY;
            const author = createMockAuthor(subplebbitFirstComment);
            const challengeRequest = createMockChallengeRequest(author);

            // Our indexer only shows them from 10 days ago - this is what we trust
            const indexedTime = baseTimestamp - 10 * SECONDS_PER_DAY;
            ensureIndexedSubplebbit("test-sub.eth");
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "Qm10DaysOld",
                subplebbitAddress: "test-sub.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Recent indexed comment",
                title: undefined,
                link: undefined,
                timestamp: indexedTime,
                depth: 0,
                protocolVersion: "1"
            });

            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(indexedTime * 1000, "Qm10DaysOld");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should use indexer's 10 days (ignoring subplebbit's 500 claim) -> MODERATE score (0.5)
            expect(result.score).toBe(0.5);
            expect(result.explanation).toContain("10 days old");
        });
    });

    describe("indexed comments - oldest timestamp wins", () => {
        it("should use oldest indexed comment when multiple exist", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            // Insert two indexed comments at different times
            const oldTime = baseTimestamp - 400 * SECONDS_PER_DAY;
            const recentTime = baseTimestamp - 20 * SECONDS_PER_DAY;

            ensureIndexedSubplebbit("test-sub.eth");

            // Old indexed comment
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmVeryOld",
                subplebbitAddress: "test-sub.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Very old indexed comment",
                title: undefined,
                link: undefined,
                timestamp: oldTime,
                depth: 0,
                protocolVersion: "1"
            });
            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(oldTime * 1000, "QmVeryOld");

            // Recent indexed comment
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmRecent",
                subplebbitAddress: "test-sub.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Recent indexed comment",
                title: undefined,
                link: undefined,
                timestamp: recentTime,
                depth: 0,
                protocolVersion: "1"
            });
            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(recentTime * 1000, "QmRecent");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should use the oldest indexed comment (400 days) -> VERY_OLD (0.1)
            expect(result.score).toBe(0.1);
            expect(result.explanation).toContain("400 days old");
            expect(result.explanation).toContain("very established");
        });

        it("should use oldest indexed comment across different subplebbits", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            ensureIndexedSubplebbit("sub-a.eth");
            ensureIndexedSubplebbit("sub-b.eth");

            // Indexed comment in sub A from 150 days ago
            const subATime = baseTimestamp - 150 * SECONDS_PER_DAY;
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmSubA",
                subplebbitAddress: "sub-a.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Comment in sub A",
                title: undefined,
                link: undefined,
                timestamp: subATime,
                depth: 0,
                protocolVersion: "1"
            });
            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(subATime * 1000, "QmSubA");

            // Indexed comment in sub B from 50 days ago
            const subBTime = baseTimestamp - 50 * SECONDS_PER_DAY;
            indexerQueries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmSubB",
                subplebbitAddress: "sub-b.eth",
                author: { address: author.address },
                signature: baseSignature,
                parentCid: undefined,
                content: "Comment in sub B",
                title: undefined,
                link: undefined,
                timestamp: subBTime,
                depth: 0,
                protocolVersion: "1"
            });
            db.getDb()
                .prepare("UPDATE indexed_comments_ipfs SET fetchedAt = ? WHERE cid = ?")
                .run(subBTime * 1000, "QmSubB");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should use sub A's 150 days (oldest) -> OLD score (0.2)
            expect(result.score).toBe(0.2);
            expect(result.explanation).toContain("150 days old");
        });
    });

    describe("engine records (votes, edits) should NOT affect account age", () => {
        it("should ignore engine votes when calculating account age", () => {
            const author = createMockAuthor(undefined);
            const challengeRequest = createMockChallengeRequest(author);

            // Insert a vote from 150 days ago in ENGINE
            const voteTime = baseTimestamp - 150 * SECONDS_PER_DAY;
            const sessionId = "old-vote";
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });

            db.insertVote({
                sessionId,
                publication: {
                    author: { address: author.address },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: voteTime,
                    protocolVersion: "1",
                    signature: baseSignature,
                    commentCid: "QmComment",
                    vote: 1
                }
            });

            db.getDb()
                .prepare("UPDATE votes SET receivedAt = ? WHERE sessionId = ?")
                .run(voteTime * 1000, sessionId);

            // NO indexed records - votes are not indexed

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateAccountAge(ctx, 0.17);

            // Should return NO_HISTORY because only indexed comments count
            // Engine votes are ignored for account age calculation
            expect(result.score).toBe(1.0);
            expect(result.explanation).toContain("No account history");
        });
    });
});
