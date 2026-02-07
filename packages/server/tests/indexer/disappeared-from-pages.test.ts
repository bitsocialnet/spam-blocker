/**
 * Tests for disappeared-from-pages detection:
 * - updateLastSeenInPagesAtBatch sets timestamps correctly
 * - getDisappearedFromPagesCids detects disappeared posts
 * - Crawler-discovered comments (NULL seenAtSubplebbitUpdatedAt) are excluded
 * - Cross-subplebbit isolation
 * - Replies are excluded (only posts detected)
 * - Integration with unfetchableCount via recordCommentUpdateFetchFailure
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../../src/db/schema.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";

const SUB_ADDRESS = "test-sub.eth";
const AUTHOR_PK = "test-author-pk";
const T1 = 1700000000; // initial crawl timestamp (seconds)
const T2 = 1700001000; // later crawl timestamp (seconds)

function setup() {
    const db = new Database(":memory:");
    db.exec(SCHEMA_SQL);
    const queries = new IndexerQueries(db);

    // Insert the subplebbit
    queries.upsertIndexedSubplebbit({ address: SUB_ADDRESS, discoveredVia: "manual" });

    return { db, queries };
}

/** Seed a comment (post or reply) into the DB. */
function seedComment(
    db: InstanceType<typeof Database>,
    {
        cid,
        subplebbitAddress = SUB_ADDRESS,
        parentCid = null,
        authorPublicKey = AUTHOR_PK
    }: {
        cid: string;
        subplebbitAddress?: string;
        parentCid?: string | null;
        authorPublicKey?: string;
    }
) {
    // Use a past timestamp so recordCommentUpdateFetchFailure's Date.now() will always be greater
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

describe("disappeared-from-pages detection", () => {
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

    describe("updateLastSeenInPagesAtBatch", () => {
        it("should set seenAtSubplebbitUpdatedAt for specified CIDs only", () => {
            seedComment(db, { cid: "QmA" });
            seedComment(db, { cid: "QmB" });
            seedComment(db, { cid: "QmC" });

            queries.updateLastSeenInPagesAtBatch({ cids: ["QmA", "QmB"], timestamp: T1 });

            const a = queries.getIndexedCommentUpdate("QmA");
            const b = queries.getIndexedCommentUpdate("QmB");
            const c = queries.getIndexedCommentUpdate("QmC");

            expect(a!.seenAtSubplebbitUpdatedAt).toBe(T1);
            expect(b!.seenAtSubplebbitUpdatedAt).toBe(T1);
            expect(c!.seenAtSubplebbitUpdatedAt).toBeNull();
        });

        it("should handle empty cids array without error", () => {
            expect(() => queries.updateLastSeenInPagesAtBatch({ cids: [], timestamp: T1 })).not.toThrow();
        });
    });

    describe("getDisappearedFromPagesCids", () => {
        it("should detect posts that disappeared between crawls", () => {
            // Seed 5 posts, all seen at T1
            for (let i = 0; i < 5; i++) {
                seedComment(db, { cid: `QmPost${i}` });
            }
            queries.updateLastSeenInPagesAtBatch({ cids: ["QmPost0", "QmPost1", "QmPost2", "QmPost3", "QmPost4"], timestamp: T1 });

            // Simulate second crawl: only 3 posts still present
            queries.updateLastSeenInPagesAtBatch({ cids: ["QmPost0", "QmPost1", "QmPost2"], timestamp: T2 });

            // QmPost3 and QmPost4 should be detected as disappeared
            const disappeared = queries.getDisappearedFromPagesCids({ subplebbitAddress: SUB_ADDRESS, crawlTimestamp: T2 });
            expect(disappeared.sort()).toEqual(["QmPost3", "QmPost4"]);
        });

        it("should not return posts that were seen in the current crawl", () => {
            seedComment(db, { cid: "QmStillHere" });
            queries.updateLastSeenInPagesAtBatch({ cids: ["QmStillHere"], timestamp: T2 });

            const disappeared = queries.getDisappearedFromPagesCids({ subplebbitAddress: SUB_ADDRESS, crawlTimestamp: T2 });
            expect(disappeared).toEqual([]);
        });

        it("should exclude comments with NULL seenAtSubplebbitUpdatedAt (crawler-discovered)", () => {
            seedComment(db, { cid: "QmCrawled" });
            // Don't call updateLastSeenInPagesAtBatch — seenAtSubplebbitUpdatedAt stays NULL

            const disappeared = queries.getDisappearedFromPagesCids({ subplebbitAddress: SUB_ADDRESS, crawlTimestamp: T2 });
            expect(disappeared).toEqual([]);
        });

        it("should isolate by subplebbit address", () => {
            // Insert another subplebbit
            queries.upsertIndexedSubplebbit({ address: "other-sub.eth", discoveredVia: "manual" });

            seedComment(db, { cid: "QmSub1Post", subplebbitAddress: SUB_ADDRESS });
            seedComment(db, { cid: "QmSub2Post", subplebbitAddress: "other-sub.eth" });

            queries.updateLastSeenInPagesAtBatch({ cids: ["QmSub1Post", "QmSub2Post"], timestamp: T1 });

            // Only query for SUB_ADDRESS — QmSub2Post should not appear
            const disappeared = queries.getDisappearedFromPagesCids({ subplebbitAddress: SUB_ADDRESS, crawlTimestamp: T2 });
            expect(disappeared).toEqual(["QmSub1Post"]);

            const disappeared2 = queries.getDisappearedFromPagesCids({ subplebbitAddress: "other-sub.eth", crawlTimestamp: T2 });
            expect(disappeared2).toEqual(["QmSub2Post"]);
        });

        it("should exclude replies (parentCid IS NOT NULL)", () => {
            seedComment(db, { cid: "QmPost" });
            seedComment(db, { cid: "QmReply", parentCid: "QmPost" });

            queries.updateLastSeenInPagesAtBatch({ cids: ["QmPost", "QmReply"], timestamp: T1 });

            // Both are stale, but only the post should show up
            const disappeared = queries.getDisappearedFromPagesCids({ subplebbitAddress: SUB_ADDRESS, crawlTimestamp: T2 });
            expect(disappeared).toEqual(["QmPost"]);
        });
    });

    describe("integration with unfetchableCount", () => {
        it("should increment unfetchableCount for disappeared comments via recordCommentUpdateFetchFailure", () => {
            seedComment(db, { cid: "QmDisappeared" });
            queries.updateLastSeenInPagesAtBatch({ cids: ["QmDisappeared"], timestamp: T1 });

            // Simulate disappearance detection
            queries.recordCommentUpdateFetchFailure("QmDisappeared");

            const stats = queries.getAuthorNetworkStats(AUTHOR_PK);
            expect(stats.unfetchableCount).toBe(1);
        });

        it("should reset unfetchableCount when comment reappears via upsertIndexedCommentUpdate", () => {
            seedComment(db, { cid: "QmFlaky" });
            queries.updateLastSeenInPagesAtBatch({ cids: ["QmFlaky"], timestamp: T1 });

            // Disappeared → failure recorded
            queries.recordCommentUpdateFetchFailure("QmFlaky");
            expect(queries.getAuthorNetworkStats(AUTHOR_PK).unfetchableCount).toBe(1);

            // Reappears in pages → upsertIndexedCommentUpdate resets fetchFailureCount to 0
            queries.upsertIndexedCommentUpdate({
                cid: "QmFlaky",
                author: { address: "addr" },
                upvoteCount: 1,
                downvoteCount: 0,
                replyCount: 0,
                removed: false,
                deleted: false,
                locked: false,
                pinned: false,
                approved: null,
                updatedAt: T2
            });

            expect(queries.getAuthorNetworkStats(AUTHOR_PK).unfetchableCount).toBe(0);
        });
    });
});
