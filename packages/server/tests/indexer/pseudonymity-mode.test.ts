/**
 * Tests for pseudonymityMode handling in indexed comments.
 * Verifies that pseudonymous comments are stored correctly and
 * excluded from author-keyed queries while remaining in content queries.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../../src/db/schema.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";

const AUTHOR_PUBLIC_KEY = "test-author-pk";
const SUB_ADDRESS = "test-sub.eth";
const MODQUEUE_SUB_ADDRESS = "modqueue-sub.eth";

function makeSignatureJson(publicKey: string) {
    return JSON.stringify({ publicKey, signature: "sig", type: "ed25519" });
}

function makeAuthorJson() {
    return JSON.stringify({ address: "author-addr" });
}

describe("pseudonymityMode", () => {
    let db: InstanceType<typeof Database>;
    let queries: IndexerQueries;

    beforeEach(() => {
        db = new Database(":memory:");
        db.exec(SCHEMA_SQL);
        queries = new IndexerQueries(db);
        queries.upsertIndexedSubplebbit({ address: SUB_ADDRESS, discoveredVia: "manual" });
        queries.upsertIndexedSubplebbit({ address: MODQUEUE_SUB_ADDRESS, discoveredVia: "manual" });
    });

    afterEach(() => {
        db.close();
    });

    describe("storage", () => {
        it("stores pseudonymityMode on indexed_comments_ipfs", () => {
            queries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmNormal",
                subplebbitAddress: SUB_ADDRESS,
                author: { address: "a" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "normal",
                title: null,
                link: null,
                timestamp: 1000,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: null
            });

            queries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmPseudo",
                subplebbitAddress: SUB_ADDRESS,
                author: { address: "pseudo-addr" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "pseudonymous",
                title: null,
                link: null,
                timestamp: 1001,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: "per-post"
            });

            const normal = queries.getIndexedCommentIpfs("QmNormal");
            expect(normal?.pseudonymityMode).toBeNull();

            const pseudo = queries.getIndexedCommentIpfs("QmPseudo");
            expect(pseudo?.pseudonymityMode).toBe("per-post");
        });

        it("stores pseudonymityMode on modqueue_comments_ipfs", () => {
            queries.upsertModQueueCommentIpfs({
                cid: "QmModPseudo",
                subplebbitAddress: MODQUEUE_SUB_ADDRESS,
                author: { address: "a" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "modqueue pseudo",
                title: null,
                link: null,
                timestamp: 1000,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: "per-author"
            });

            const row = db.prepare("SELECT pseudonymityMode FROM modqueue_comments_ipfs WHERE cid = ?").get("QmModPseudo") as {
                pseudonymityMode: string | null;
            };
            expect(row.pseudonymityMode).toBe("per-author");
        });
    });

    describe("author-keyed query exclusion", () => {
        beforeEach(() => {
            const nowMs = Date.now();
            const nowSec = Math.floor(nowMs / 1000);

            // Insert a normal comment
            queries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmNormal1",
                subplebbitAddress: SUB_ADDRESS,
                author: { address: "a" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "normal comment",
                title: "normal title",
                link: null,
                timestamp: nowSec - 100,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: null
            });
            queries.upsertIndexedCommentUpdate({
                cid: "QmNormal1",
                author: { subplebbit: { postScore: 5, replyScore: 2 } },
                upvoteCount: 10,
                downvoteCount: 1,
                replyCount: 0,
                removed: false,
                deleted: false,
                locked: false,
                pinned: false,
                approved: null,
                updatedAt: nowSec - 50
            });

            // Insert a pseudonymous comment with same publicKey
            queries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmPseudo1",
                subplebbitAddress: SUB_ADDRESS,
                author: { address: "pseudo-addr" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "pseudo comment",
                title: "pseudo title",
                link: null,
                timestamp: nowSec - 80,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: "per-post"
            });
            queries.upsertIndexedCommentUpdate({
                cid: "QmPseudo1",
                author: { subplebbit: { postScore: 3, replyScore: 1 } },
                upvoteCount: 5,
                downvoteCount: 0,
                replyCount: 0,
                removed: true,
                deleted: false,
                locked: false,
                pinned: false,
                approved: null,
                updatedAt: nowSec - 40
            });
        });

        it("getAuthorNetworkStats excludes pseudonymous comments", () => {
            const stats = queries.getAuthorNetworkStats(AUTHOR_PUBLIC_KEY);
            // Should only count normal comment (1 total, 0 removed since normal one isn't removed)
            expect(stats.totalIndexedComments).toBe(1);
            expect(stats.removalCount).toBe(0); // pseudo removal excluded
            expect(stats.distinctSubplebbitsPostedTo).toBe(1);
        });

        it("getAuthorFirstIndexedTimestamp excludes pseudonymous comments", () => {
            const ts = queries.getAuthorFirstIndexedTimestamp(AUTHOR_PUBLIC_KEY);
            expect(ts).toBeDefined();
            // Should be based on QmNormal1's fetchedAt, not QmPseudo1's
            const normalRow = queries.getIndexedCommentIpfs("QmNormal1");
            expect(ts).toBe(Math.floor(normalRow!.fetchedAt / 1000));
        });

        it("getAuthorIndexedKarma excludes pseudonymous comments", () => {
            const karma = queries.getAuthorIndexedKarma(AUTHOR_PUBLIC_KEY);
            // Should only include QmNormal1: 10 upvotes, 1 downvote
            expect(karma.upvotes).toBe(10);
            expect(karma.downvotes).toBe(1);
        });

        it("getAuthorKarmaBySubplebbitFromIndexer excludes pseudonymous comments", () => {
            const karmaMap = queries.getAuthorKarmaBySubplebbitFromIndexer(AUTHOR_PUBLIC_KEY);
            // Should have 1 entry from normal comment only
            expect(karmaMap.size).toBe(1);
            const subKarma = karmaMap.get(SUB_ADDRESS);
            expect(subKarma?.postScore).toBe(5);
            expect(subKarma?.replyScore).toBe(2);
        });

        it("getAuthorVelocityFromIndexer excludes pseudonymous comments", () => {
            const velocity = queries.getAuthorVelocityFromIndexer(AUTHOR_PUBLIC_KEY, "post");
            // Only normal comment should count
            expect(velocity.last24Hours).toBe(1);
        });
    });

    describe("content query inclusion", () => {
        beforeEach(() => {
            // Register jaccard_similarity as a dummy function (exact match only)
            db.function("jaccard_similarity", (a: string | null, b: string | null) => {
                if (!a || !b) return 0;
                return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1.0 : 0;
            });

            const nowSec = Math.floor(Date.now() / 1000);

            queries.insertIndexedCommentIpfsIfNotExists({
                cid: "QmContentPseudo",
                subplebbitAddress: SUB_ADDRESS,
                author: { address: "pseudo-addr" },
                signature: { publicKey: "different-pk", signature: "s", type: "ed25519" },
                parentCid: null,
                content: "unique spam content for testing",
                title: "spam title",
                link: null,
                timestamp: nowSec - 100,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: "per-post"
            });
        });

        it("findExactContentFromIndexer includes pseudonymous comments", () => {
            const results = queries.findExactContentFromIndexer({
                content: "unique spam content for testing",
                sinceTimestamp: 0
            });
            expect(results.length).toBe(1);
            expect(results[0].cid).toBe("QmContentPseudo");
        });

        it("findSimilarContentFromIndexer includes pseudonymous comments", () => {
            const results = queries.findSimilarContentFromIndexer({
                content: "unique spam content for testing",
                sinceTimestamp: 0,
                similarityThreshold: 0.5
            });
            expect(results.length).toBe(1);
            expect(results[0].cid).toBe("QmContentPseudo");
        });
    });

    describe("modqueue exclusion", () => {
        it("getAuthorNetworkStats excludes pseudonymous modqueue comments", () => {
            const nowMs = Date.now();
            const nowSec = Math.floor(nowMs / 1000);

            // Insert normal modqueue comment (resolved, rejected)
            queries.upsertModQueueCommentIpfs({
                cid: "QmModNormal",
                subplebbitAddress: MODQUEUE_SUB_ADDRESS,
                author: { address: "a" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "normal mod",
                title: null,
                link: null,
                timestamp: nowSec - 100,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: null
            });
            queries.upsertModQueueCommentUpdate({
                cid: "QmModNormal",
                author: null,
                protocolVersion: "1.0.0",
                number: null,
                postNumber: null
            });
            queries.resolveModQueueItem("QmModNormal", false); // rejected

            // Insert pseudonymous modqueue comment (resolved, rejected)
            queries.upsertModQueueCommentIpfs({
                cid: "QmModPseudo",
                subplebbitAddress: MODQUEUE_SUB_ADDRESS,
                author: { address: "pseudo-addr" },
                signature: { publicKey: AUTHOR_PUBLIC_KEY, signature: "s", type: "ed25519" },
                parentCid: null,
                content: "pseudo mod",
                title: null,
                link: null,
                timestamp: nowSec - 80,
                depth: 0,
                protocolVersion: "1.0.0",
                pseudonymityMode: "per-post"
            });
            queries.upsertModQueueCommentUpdate({
                cid: "QmModPseudo",
                author: null,
                protocolVersion: "1.0.0",
                number: null,
                postNumber: null
            });
            queries.resolveModQueueItem("QmModPseudo", false); // rejected

            const stats = queries.getAuthorNetworkStats(AUTHOR_PUBLIC_KEY);
            // Should only count the normal modqueue rejection
            expect(stats.modqueueRejected).toBe(1);
            expect(stats.modqueueAccepted).toBe(0);
        });
    });
});
