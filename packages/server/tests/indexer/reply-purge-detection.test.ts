/**
 * Tests for reply purge detection:
 * - Reply disappearance → marked purged
 * - Cascading purge marks descendants
 * - No false positives on first indexing
 * - Self-healing: purged reply reappears → flags cleared
 * - purgedCount in getAuthorNetworkStats
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../../src/db/schema.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";

const SUB_ADDRESS = "test-sub.eth";
const AUTHOR_PK = "test-author-pk";
const T1 = 1700000000;

function setup() {
    const db = new Database(":memory:");
    db.exec(SCHEMA_SQL);
    const queries = new IndexerQueries(db);
    queries.upsertIndexedSubplebbit({ address: SUB_ADDRESS, discoveredVia: "manual" });
    return { db, queries };
}

function seedComment(
    db: InstanceType<typeof Database>,
    {
        cid,
        parentCid = null,
        authorPublicKey = AUTHOR_PK,
        subplebbitAddress = SUB_ADDRESS
    }: {
        cid: string;
        parentCid?: string | null;
        authorPublicKey?: string;
        subplebbitAddress?: string;
    }
) {
    const nowMs = Date.now() - 60_000;
    db.prepare(
        `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, parentCid, timestamp, fetchedAt, protocolVersion)
         VALUES (?, ?, ?, ?, ?, ?, ?, '1')`
    ).run(
        cid,
        subplebbitAddress,
        JSON.stringify({ address: "addr" }),
        JSON.stringify({ publicKey: authorPublicKey, signature: "sig", type: "ed25519" }),
        parentCid,
        T1 - 100,
        nowMs
    );

    db.prepare(
        `INSERT INTO indexed_comments_update (cid, updatedAt, fetchedAt)
         VALUES (?, ?, ?)`
    ).run(cid, T1 - 100, nowMs);
}

describe("reply purge detection", () => {
    let db: InstanceType<typeof Database>;
    let queries: IndexerQueries;

    beforeEach(() => {
        const s = setup();
        db = s.db;
        queries = s.queries;
    });

    afterEach(() => {
        db.close();
    });

    describe("getDirectReplyCids", () => {
        it("should return all direct reply CIDs for a parent", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply1", parentCid: "QmPost" });
            seedComment(db, { cid: "QmReply2", parentCid: "QmPost" });
            seedComment(db, { cid: "QmNestedReply", parentCid: "QmReply1" });

            const directReplies = queries.getDirectReplyCids("QmPost");
            expect(directReplies.sort()).toEqual(["QmReply1", "QmReply2"]);
        });

        it("should return empty array for a comment with no replies", () => {
            seedComment(db, { cid: "QmPost" });
            expect(queries.getDirectReplyCids("QmPost")).toEqual([]);
        });

        it("should return empty array for unknown parentCid", () => {
            expect(queries.getDirectReplyCids("QmNonexistent")).toEqual([]);
        });
    });

    describe("markAsPurged", () => {
        it("should mark specified CIDs as purged", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply1", parentCid: "QmPost" });

            queries.markAsPurged(["QmReply1"]);

            const update = queries.getIndexedCommentUpdate("QmReply1");
            expect(update!.purged).toBe(1);

            // Post should NOT be purged
            const postUpdate = queries.getIndexedCommentUpdate("QmPost");
            expect(postUpdate!.purged).toBe(0);
        });

        it("should cascade to descendants", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply1", parentCid: "QmPost" });
            seedComment(db, { cid: "QmNested1", parentCid: "QmReply1" });
            seedComment(db, { cid: "QmNested2", parentCid: "QmNested1" });

            queries.markAsPurged(["QmReply1"]);

            expect(queries.getIndexedCommentUpdate("QmReply1")!.purged).toBe(1);
            expect(queries.getIndexedCommentUpdate("QmNested1")!.purged).toBe(1);
            expect(queries.getIndexedCommentUpdate("QmNested2")!.purged).toBe(1);
            // Post should NOT be purged
            expect(queries.getIndexedCommentUpdate("QmPost")!.purged).toBe(0);
        });

        it("should handle multiple purged CIDs at once", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply1", parentCid: "QmPost" });
            seedComment(db, { cid: "QmReply2", parentCid: "QmPost" });
            seedComment(db, { cid: "QmNested", parentCid: "QmReply2" });

            queries.markAsPurged(["QmReply1", "QmReply2"]);

            expect(queries.getIndexedCommentUpdate("QmReply1")!.purged).toBe(1);
            expect(queries.getIndexedCommentUpdate("QmReply2")!.purged).toBe(1);
            expect(queries.getIndexedCommentUpdate("QmNested")!.purged).toBe(1);
        });

        it("should handle empty array without error", () => {
            expect(() => queries.markAsPurged([])).not.toThrow();
        });
    });

    describe("self-healing on reappearance", () => {
        it("should clear purged flag when comment reappears via upsertIndexedCommentUpdate", () => {
            seedComment(db, { cid: "QmReply" });
            queries.markAsPurged(["QmReply"]);
            expect(queries.getIndexedCommentUpdate("QmReply")!.purged).toBe(1);

            // Reappears in pages
            queries.upsertIndexedCommentUpdate({
                cid: "QmReply",
                author: { address: "addr" },
                upvoteCount: 1,
                downvoteCount: 0,
                replyCount: 0,
                removed: false,
                deleted: false,
                locked: false,
                pinned: false,
                approved: null,
                updatedAt: T1 + 100
            });

            const update = queries.getIndexedCommentUpdate("QmReply");
            expect(update!.purged).toBe(0);
            expect(update!.lastFetchFailedAt).toBeNull();
            expect(update!.fetchFailureCount).toBe(0);
        });
    });

    describe("purgedCount in getAuthorNetworkStats", () => {
        it("should count purged comments separately from unfetchable", () => {
            seedComment(db, { cid: "QmPurged1" });
            seedComment(db, { cid: "QmPurged2" });
            seedComment(db, { cid: "QmUnfetchable" });
            seedComment(db, { cid: "QmNormal" });

            queries.markAsPurged(["QmPurged1", "QmPurged2"]);
            queries.recordCommentUpdateFetchFailure("QmUnfetchable");

            const stats = queries.getAuthorNetworkStats(AUTHOR_PK);
            expect(stats.purgedCount).toBe(2);
            expect(stats.unfetchableCount).toBe(1);
            expect(stats.totalIndexedComments).toBe(4);
        });

        it("should exclude purged comments from unfetchableCount", () => {
            seedComment(db, { cid: "QmComment" });

            // First record failures, then mark as purged
            queries.recordCommentUpdateFetchFailure("QmComment");
            queries.recordCommentUpdateFetchFailure("QmComment");
            queries.recordCommentUpdateFetchFailure("QmComment");
            queries.markAsPurged(["QmComment"]);

            const stats = queries.getAuthorNetworkStats(AUTHOR_PK);
            expect(stats.purgedCount).toBe(1);
            // Should NOT also count as unfetchable
            expect(stats.unfetchableCount).toBe(0);
        });
    });

    describe("getPostsAwaitingVerification", () => {
        it("should return posts with 1-2 failures that are not purged or removed", () => {
            seedComment(db, { cid: "QmPost1" });
            seedComment(db, { cid: "QmPost2" });
            seedComment(db, { cid: "QmPost3" });

            queries.recordCommentUpdateFetchFailure("QmPost1"); // 1 failure
            queries.recordCommentUpdateFetchFailure("QmPost2"); // 1 failure
            queries.recordCommentUpdateFetchFailure("QmPost2"); // 2 failures

            const awaiting = queries.getPostsAwaitingVerification(SUB_ADDRESS);
            const cids = awaiting.map((r) => r.cid).sort();
            expect(cids).toEqual(["QmPost1", "QmPost2"]);
        });

        it("should exclude posts with 3+ failures", () => {
            seedComment(db, { cid: "QmPost" });
            queries.recordCommentUpdateFetchFailure("QmPost");
            queries.recordCommentUpdateFetchFailure("QmPost");
            queries.recordCommentUpdateFetchFailure("QmPost");

            const awaiting = queries.getPostsAwaitingVerification(SUB_ADDRESS);
            expect(awaiting).toEqual([]);
        });

        it("should exclude purged posts", () => {
            seedComment(db, { cid: "QmPost" });
            queries.recordCommentUpdateFetchFailure("QmPost");
            queries.markAsPurged(["QmPost"]);

            const awaiting = queries.getPostsAwaitingVerification(SUB_ADDRESS);
            expect(awaiting).toEqual([]);
        });

        it("should exclude removed posts", () => {
            seedComment(db, { cid: "QmPost" });
            queries.recordCommentUpdateFetchFailure("QmPost");
            queries.markAsRemoved("QmPost");

            const awaiting = queries.getPostsAwaitingVerification(SUB_ADDRESS);
            expect(awaiting).toEqual([]);
        });

        it("should exclude replies", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply", parentCid: "QmPost" });
            queries.recordCommentUpdateFetchFailure("QmReply");

            const awaiting = queries.getPostsAwaitingVerification(SUB_ADDRESS);
            expect(awaiting).toEqual([]);
        });
    });

    describe("markAsRemoved", () => {
        it("should set removed=1 and fetchFailureCount=0", () => {
            seedComment(db, { cid: "QmPost" });
            queries.recordCommentUpdateFetchFailure("QmPost");
            queries.recordCommentUpdateFetchFailure("QmPost");

            queries.markAsRemoved("QmPost");

            const update = queries.getIndexedCommentUpdate("QmPost");
            expect(update!.removed).toBe(1);
            expect(update!.fetchFailureCount).toBe(0);
        });
    });
});
