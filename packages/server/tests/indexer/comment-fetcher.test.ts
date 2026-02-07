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
    replies?: { pageCids: Record<string, string>; pages: Record<string, any> };
}) {
    const cid = overrides.cid;
    const depth = overrides.depth ?? 0;
    const parentCid = overrides.parentCid ?? null;
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
        updatedAt: 1000000 + depth,
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
                updatedAt: 1000000 + depth,
                upvoteCount: 0,
                downvoteCount: 0,
                replyCount: overrides.replyCount ?? 0
            }
        }
    };
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
        // Create replies
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

        // Create a post with replies ONLY in preloaded pages (empty pageCids)
        const postWithReplies = createMockPageComment({
            cid: "QmPost1",
            depth: 0,
            title: "Post with replies",
            replyCount: 2,
            replies: {
                pageCids: {}, // empty! replies are preloaded in pages
                pages: {
                    new: {
                        comments: [reply1, reply2],
                        nextCid: undefined
                    }
                }
            }
        });

        // Mock subplebbit with the post in preloaded pages
        const mockSubplebbit = {
            address: "test-sub-address",
            signature: { publicKey: "sub-pk" },
            posts: {
                pageCids: { new: "QmPostsPageCid" },
                pages: {},
                getPage: async () => ({
                    comments: [postWithReplies],
                    nextCid: undefined
                })
            }
        } as any;

        // Mock plebbit - createComment shouldn't be needed for preloaded case
        const mockPlebbit = {
            createComment: async () => {
                throw new Error("createComment should not be called for preloaded replies");
            }
        } as any;

        const result = await fetchAndStoreSubplebbitComments(mockSubplebbit, mockPlebbit, db);

        // Verify return counts
        expect(result.postsCount).toBe(1);
        expect(result.repliesCount).toBe(2);

        // Verify database state
        expect(queries.hasIndexedCommentIpfs("QmPost1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply1")).toBe(true);
        expect(queries.hasIndexedCommentIpfs("QmReply2")).toBe(true);

        // Verify reply data is correct
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

        // Post has replies via pageCids (not preloaded)
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

        const mockSubplebbit = {
            address: "test-sub-address",
            signature: { publicKey: "sub-pk" },
            posts: {
                pageCids: { new: "QmPostsPageCid" },
                pages: {},
                getPage: async () => ({
                    comments: [postWithReplies],
                    nextCid: undefined
                })
            }
        } as any;

        // Mock plebbit.createComment to return a Comment-like object
        // that has a replies.getPage method
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

        const mockSubplebbit = {
            address: "test-sub-address",
            signature: { publicKey: "sub-pk" },
            posts: {
                pageCids: { new: "QmPostsPageCid" },
                pages: {},
                getPage: async () => ({
                    comments: [post],
                    nextCid: undefined
                })
            }
        } as any;

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

        // Post has reply1 preloaded with a nextCid pointing to more replies
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
                        nextCid: "QmRepliesPage2" // more replies on next page
                    }
                }
            }
        });

        const mockSubplebbit = {
            address: "test-sub-address",
            signature: { publicKey: "sub-pk" },
            posts: {
                pageCids: { new: "QmPostsPageCid" },
                pages: {},
                getPage: async () => ({
                    comments: [postWithReplies],
                    nextCid: undefined
                })
            }
        } as any;

        // createComment is needed to follow nextCid
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
});
