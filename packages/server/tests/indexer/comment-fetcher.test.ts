/**
 * Tests for comment-fetcher: verifies that replies are properly indexed
 * from subplebbit page data, including preloaded replies.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "../../src/db/schema.js";
import { fetchAndStoreSubplebbitComments } from "../../src/indexer/workers/comment-fetcher.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";

// Helper to create a mock page comment (post or reply)
function createMockPageComment(overrides: {
    cid: string;
    parentCid?: string | null;
    depth?: number;
    content?: string;
    title?: string | null;
    replyCount?: number;
    updatedAt?: number;
    replies?: { pageCids: Record<string, string>; pages: Record<string, any> };
}) {
    const cid = overrides.cid;
    const depth = overrides.depth ?? 0;
    const parentCid = overrides.parentCid ?? null;
    const updatedAt = overrides.updatedAt ?? 1000000 + depth;
    return {
        cid,
        subplebbitAddress: "test-sub-address",
        author: { address: `author-of-${cid}`, previousCommentCid: null },
        signature: { publicKey: `pk-${cid}`, type: "ed25519", signature: "sig" },
        parentCid,
        content: overrides.content ?? `content of ${cid}`,
        title: overrides.title ?? (depth === 0 ? `title of ${cid}` : null),
        link: null,
        timestamp: 1000000 + depth,
        depth,
        protocolVersion: "1.0.0",
        shortCid: cid.slice(0, 6),
        shortSubplebbitAddress: "test",
        original: {},
        updatedAt,
        upvoteCount: 0,
        downvoteCount: 0,
        replyCount: overrides.replyCount ?? 0,
        replies: overrides.replies ?? { pageCids: {}, pages: {} },
        raw: {
            comment: {
                subplebbitAddress: "test-sub-address",
                author: { address: `author-of-${cid}`, previousCommentCid: null },
                signature: { publicKey: `pk-${cid}`, type: "ed25519", signature: "sig" },
                parentCid,
                content: overrides.content ?? `content of ${cid}`,
                title: overrides.title ?? (depth === 0 ? `title of ${cid}` : null),
                link: null,
                timestamp: 1000000 + depth,
                depth,
                protocolVersion: "1.0.0"
            },
            commentUpdate: {
                cid,
                updatedAt,
                upvoteCount: 0,
                downvoteCount: 0,
                replyCount: overrides.replyCount ?? 0
            }
        }
    };
}

// Helper to create a mock subplebbit
function createMockSubplebbit(posts: ReturnType<typeof createMockPageComment>[]) {
    return {
        address: "test-sub-address",
        updatedAt: 2000000,
        signature: { publicKey: "sub-pk" },
        posts: {
            pageCids: { new: "QmPostsPageCid" },
            pages: {},
            getPage: async () => ({
                comments: posts,
                nextCid: undefined
            })
        }
    } as any;
}

describe("fetchAndStoreSubplebbitComments", () => {
    let db: InstanceType<typeof Database>;
    let queries: IndexerQueries;

    beforeEach(() => {
        db = new Database(":memory:");
        db.exec(SCHEMA_SQL);
        queries = new IndexerQueries(db);
        // Insert the subplebbit so FK constraints don't cause issues
        queries.upsertIndexedSubplebbit({ address: "test-sub-address", discoveredVia: "manual" });
    });

    afterEach(() => {
        db.close();
    });

    it("should index replies that are preloaded in pages with empty pageCids", async () => {
        const reply1 = createMockPageComment({
            cid: "QmReply1",
            parentCid: "QmPost1",
            depth: 1,
            content: "first reply"
        });
        const reply2 = createMockPageComment({
            cid: "QmReply2",
            parentCid: "QmPost1",
            depth: 1,
            content: "second reply"
        });

        const postWithReplies = createMockPageComment({
            cid: "QmPost1",
            depth: 0,
            title: "Post with replies",
            replyCount: 2,
            replies: {
                pageCids: {},
                pages: {
                    new: {
                        comments: [reply1, reply2],
                        nextCid: undefined
                    }
                }
            }
        });

        const mockSubplebbit = createMockSubplebbit([postWithReplies]);

        const mockPlebbit = {
            createComment: async () => {
                throw new Error("createComment should not be called for preloaded replies");
            }
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(2);

        expect(queries.hasIndexedCommentIpfs("QmPost1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply2")).toBe(true);

        const reply1Data = queries.getIndexedCommentIpfs("QmReply1");
        expect(reply1Data).toBeDefined();
        expect(reply1Data!.parentCid).toBe("QmPost1");
        expect(reply1Data!.depth).toBe(1);

        const reply2Data = queries.getIndexedCommentIpfs("QmReply2");
        expect(reply2Data).toBeDefined();
        expect(reply2Data!.parentCid).toBe("QmPost1");
    });

    it("should index replies when pageCids exist", async () => {
        const reply1 = createMockPageComment({
            cid: "QmReply1",
            parentCid: "QmPost1",
            depth: 1,
            content: "first reply"
        });

        const postWithReplies = createMockPageComment({
            cid: "QmPost1",
            depth: 0,
            title: "Post with replies",
            replyCount: 1,
            replies: {
                pageCids: { new: "QmRepliesPageCid" },
                pages: {}
            }
        });

        const mockSubplebbit = createMockSubplebbit([postWithReplies]);

        const mockPlebbit = {
            createComment: async (pageComment: any) => ({
                ...pageComment,
                cid: pageComment.cid,
                subplebbitAddress: pageComment.subplebbitAddress,
                replies: {
                    pageCids: pageComment.raw?.commentUpdate?.replies?.pageCids ?? {},
                    pages: {},
                    getPage: async () => ({
                        comments: [reply1],
                        nextCid: undefined
                    }),
                    _subplebbit: { address: "test-sub-address" }
                }
            })
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(1);
        expect(queries.hasIndexedCommentIpfs("QmPost1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply1")).toBe(true);
    });

    it("should index posts without replies correctly", async () => {
        const post = createMockPageComment({
            cid: "QmPostNoReplies",
            depth: 0,
            title: "Post without replies"
        });

        const mockSubplebbit = createMockSubplebbit([post]);

        const mockPlebbit = {
            createComment: async () => {
                throw new Error("Should not be called");
            }
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(0);
        expect(queries.hasIndexedCommentIpfs("QmPostNoReplies")).toBe(true);
    });

    it("should follow nextCid in preloaded reply pages", async () => {
        const reply1 = createMockPageComment({
            cid: "QmReply1",
            parentCid: "QmPost1",
            depth: 1,
            content: "first reply (preloaded)"
        });
        const reply2 = createMockPageComment({
            cid: "QmReply2",
            parentCid: "QmPost1",
            depth: 1,
            content: "second reply (from nextCid page)"
        });

        const postWithReplies = createMockPageComment({
            cid: "QmPost1",
            depth: 0,
            title: "Post with paginated preloaded replies",
            replyCount: 2,
            replies: {
                pageCids: {},
                pages: {
                    new: {
                        comments: [reply1],
                        nextCid: "QmRepliesPage2"
                    }
                }
            }
        });

        const mockSubplebbit = createMockSubplebbit([postWithReplies]);

        const mockPlebbit = {
            createComment: async (pageComment: any) => ({
                ...pageComment,
                cid: pageComment.cid,
                subplebbitAddress: pageComment.subplebbitAddress,
                replies: {
                    pageCids: {},
                    pages: {},
                    getPage: async () => ({
                        comments: [reply2],
                        nextCid: undefined
                    }),
                    _subplebbit: { address: "test-sub-address" }
                }
            })
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(2);
        expect(queries.hasIndexedCommentIpfs("QmReply1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply2")).toBe(true);
    });

    it("should index deeply nested replies (depth 2, 3, 4)", async () => {
        // Build a chain: post -> reply(d1) -> reply(d2) -> reply(d3) -> reply(d4)
        // Each comment has its child as a preloaded reply

        const depth4Reply = createMockPageComment({
            cid: "QmDepth4",
            parentCid: "QmDepth3",
            depth: 4,
            content: "depth 4 reply"
        });

        const depth3Reply = createMockPageComment({
            cid: "QmDepth3",
            parentCid: "QmDepth2",
            depth: 3,
            content: "depth 3 reply",
            replyCount: 1,
            replies: {
                pageCids: {},
                pages: {
                    new: { comments: [depth4Reply], nextCid: undefined }
                }
            }
        });

        const depth2Reply = createMockPageComment({
            cid: "QmDepth2",
            parentCid: "QmDepth1",
            depth: 2,
            content: "depth 2 reply",
            replyCount: 1,
            replies: {
                pageCids: {},
                pages: {
                    new: { comments: [depth3Reply], nextCid: undefined }
                }
            }
        });

        const depth1Reply = createMockPageComment({
            cid: "QmDepth1",
            parentCid: "QmPost1",
            depth: 1,
            content: "depth 1 reply",
            replyCount: 1,
            replies: {
                pageCids: {},
                pages: {
                    new: { comments: [depth2Reply], nextCid: undefined }
                }
            }
        });

        const post = createMockPageComment({
            cid: "QmPost1",
            depth: 0,
            title: "Post with deep thread",
            replyCount: 1,
            replies: {
                pageCids: {},
                pages: {
                    new: { comments: [depth1Reply], nextCid: undefined }
                }
            }
        });

        const mockSubplebbit = createMockSubplebbit([post]);

        const mockPlebbit = {
            createComment: async () => {
                throw new Error("createComment should not be called for preloaded replies");
            }
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        // 1 post + 4 replies at depths 1-4
        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(4);

        // All comments should be in the database
        expect(queries.hasIndexedCommentIpfs("QmPost1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmDepth1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmDepth2")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmDepth3")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmDepth4")).toBe(true);

        // Verify parent-child relationships and depths
        const d1 = queries.getIndexedCommentIpfs("QmDepth1")!;
        expect(d1.parentCid).toBe("QmPost1");
        expect(d1.depth).toBe(1);

        const d2 = queries.getIndexedCommentIpfs("QmDepth2")!;
        expect(d2.parentCid).toBe("QmDepth1");
        expect(d2.depth).toBe(2);

        const d3 = queries.getIndexedCommentIpfs("QmDepth3")!;
        expect(d3.parentCid).toBe("QmDepth2");
        expect(d3.depth).toBe(3);

        const d4 = queries.getIndexedCommentIpfs("QmDepth4")!;
        expect(d4.parentCid).toBe("QmDepth3");
        expect(d4.depth).toBe(4);
    });
});
