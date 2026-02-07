/**
 * Worker for fetching and storing comments from subplebbit pages.
 * Follows the plebbit-js loadAllUniquePostsUnderSubplebbit pattern.
 */

import type { PostsPages, RepliesPages } from "@plebbit/plebbit-js/dist/node/pages/pages.js";
import type { PageTypeJson } from "@plebbit/plebbit-js/dist/node/pages/types.js";
import { getPageQueue } from "../page-queue.js";
import { IndexerQueries } from "../db/queries.js";
import type { Database } from "better-sqlite3";
import type { PlebbitInstance } from "../plebbit-manager.js";

// Derive types from Plebbit instance methods
type RemoteSubplebbit = Awaited<ReturnType<PlebbitInstance["getSubplebbit"]>>;
type Comment = Awaited<ReturnType<PlebbitInstance["createComment"]>>;

/**
 * Load all pages from a pageCid, following nextCid links.
 */
async function loadAllPages(pageCid: string, pagesInstance: PostsPages | RepliesPages): Promise<PageTypeJson["comments"]> {
    if (!pageCid) throw new Error("Can't load all pages with undefined pageCid");

    const pageQueue = getPageQueue();
    let page = await pageQueue.add(() => pagesInstance.getPage({ cid: pageCid }));
    let allComments: PageTypeJson["comments"] = [...page.comments];

    while (page.nextCid) {
        const nextCid = page.nextCid;
        page = await pageQueue.add(() => pagesInstance.getPage({ cid: nextCid }));
        allComments = allComments.concat(page.comments);
    }

    return allComments;
}

/**
 * Load all unique posts from a subplebbit.
 * Handles edge case where pageCids = {} but pages has preloaded data.
 */
export async function loadAllPostsFromSubplebbit(subplebbit: RemoteSubplebbit): Promise<PageTypeJson["comments"]> {
    // No posts at all
    if (Object.keys(subplebbit.posts.pageCids).length === 0 && Object.keys(subplebbit.posts.pages).length === 0) {
        return [];
    }

    // Edge case: all comments in preloaded pages (small sub)
    const allCommentsInPreloadedPages =
        Object.keys(subplebbit.posts.pageCids).length === 0 && Object.keys(subplebbit.posts.pages).length > 0;

    if (allCommentsInPreloadedPages) {
        // Use preloaded pages - try hot first, then any available
        const preloadedPage = Object.values(subplebbit.posts.pages)[0];
        return preloadedPage?.comments || [];
    }

    // Use pageCids.new to traverse (single sort is enough)
    if (subplebbit.posts.pageCids.new) {
        return loadAllPages(subplebbit.posts.pageCids.new, subplebbit.posts);
    }

    // Fallback to any available pageCid
    const firstPageCid = Object.values(subplebbit.posts.pageCids)[0];
    if (firstPageCid) {
        return loadAllPages(firstPageCid, subplebbit.posts);
    }

    return [];
}

/**
 * Load all replies from a comment.
 */
export async function loadAllRepliesFromComment(comment: Comment): Promise<PageTypeJson["comments"]> {
    // No replies at all
    if (Object.keys(comment.replies.pageCids).length === 0 && Object.keys(comment.replies.pages).length === 0) {
        return [];
    }

    // Edge case: all comments in preloaded pages
    const allCommentsInPreloadedPages = Object.keys(comment.replies.pageCids).length === 0 && Object.keys(comment.replies.pages).length > 0;

    if (allCommentsInPreloadedPages) {
        const preloadedPage = comment.replies.pages.best || comment.replies.pages.new || Object.values(comment.replies.pages)[0];
        return preloadedPage?.comments || [];
    }

    // Use pageCids.new to traverse
    if (comment.replies.pageCids.new) {
        return loadAllPages(comment.replies.pageCids.new, comment.replies);
    }

    // Fallback to any available pageCid
    const firstPageCid = Object.values(comment.replies.pageCids)[0];
    if (firstPageCid) {
        return loadAllPages(firstPageCid, comment.replies);
    }

    return [];
}

/**
 * Store a comment from page data into the database.
 * Handles both CommentIpfs and CommentUpdate storage.
 */
export function storeCommentFromPage(
    pageComment: PageTypeJson["comments"][number],
    subplebbitAddress: string,
    queries: IndexerQueries
): void {
    const cid = pageComment.cid;
    if (!cid) {
        console.warn("[CommentFetcher] Skipping comment without CID");
        return;
    }

    // Store CommentIpfs (from comment.comment or directly from pageComment for simple cases)
    // In page data, the comment fields are mixed with update fields at the top level
    // We need to extract the IPFS fields
    const commentIpfs = {
        cid,
        subplebbitAddress,
        author: pageComment.author,
        signature: pageComment.signature,
        parentCid: pageComment.parentCid ?? null,
        content: pageComment.content ?? null,
        title: pageComment.title ?? null,
        link: pageComment.link ?? null,
        timestamp: pageComment.timestamp,
        depth: pageComment.depth ?? 0,
        protocolVersion: pageComment.protocolVersion ?? null
    };

    queries.insertIndexedCommentIpfsIfNotExists(commentIpfs);

    // Store CommentUpdate if we have update data
    // Page comments include update data like upvoteCount, removed, etc.
    const hasUpdateData = typeof pageComment.updatedAt === "number";

    if (hasUpdateData) {
        // Note: In page comments, author.subplebbit contains the CommentUpdate author data
        // We need to extract just the subplebbit data

        queries.upsertIndexedCommentUpdate({
            cid,
            author: pageComment.author,
            upvoteCount: pageComment.upvoteCount ?? null,
            downvoteCount: pageComment.downvoteCount ?? null,
            replyCount: pageComment.replyCount ?? null,
            removed: pageComment.removed ?? null,
            deleted: pageComment.deleted ?? null,
            locked: pageComment.locked ?? null,
            pinned: pageComment.pinned ?? null,
            approved: pageComment.approved ?? null,
            updatedAt: pageComment.updatedAt ?? null
        });
    }
}

/**
 * Fetch and store all posts and their replies from a subplebbit.
 *
 * @param subplebbit - The subplebbit to fetch from
 * @param plebbit - Plebbit instance for creating comments with getPage access
 * @param db - Database instance
 * @param options - Options for fetching
 */
export async function fetchAndStoreSubplebbitComments(
    subplebbit: RemoteSubplebbit,
    plebbit: PlebbitInstance,
    db: Database,
    options: {
        /** Maximum depth for reply traversal (default: unlimited) */
        maxReplyDepth?: number;
        /** Called when a previousCommentCid is found that we haven't indexed yet */
        onNewPreviousCid?: (previousCid: string) => void;
    } = {}
): Promise<{ postsCount: number; repliesCount: number; disappearedCount: number }> {
    const queries = new IndexerQueries(db);
    const subAddress = subplebbit.address;
    // Use subplebbit.updatedAt (seconds, from protocol) as the timestamp for when these pages were current
    const crawlTimestamp = subplebbit.updatedAt ?? Math.floor(Date.now() / 1000);

    let postsCount = 0;
    let repliesCount = 0;
    const seenCids: string[] = [];

    // Load all posts
    const posts = await loadAllPostsFromSubplebbit(subplebbit);

    // Helper to recursively store a comment and its replies
    const storeCommentWithReplies = async (
        pageComment: PageTypeJson["comments"][number],
        currentDepth: number
    ): Promise<{ comments: number; replies: number }> => {
        if (!pageComment.cid) return { comments: 0, replies: 0 };

        // Read stored updatedAt BEFORE upserting (for primary change detection)
        const storedUpdatedAt = queries.getCommentUpdatedAt(pageComment.cid);

        // Store this comment
        storeCommentFromPage(pageComment, subAddress, queries);

        // Queue previousCommentCid for crawling if we haven't indexed it yet
        const previousCid = pageComment.author?.previousCommentCid;
        if (previousCid && options.onNewPreviousCid && !queries.hasIndexedCommentIpfs(previousCid)) {
            options.onNewPreviousCid(previousCid);
        }

        let commentCount = 1;
        let replyCount = 0;

        // Check depth limit
        if (options.maxReplyDepth !== undefined && currentDepth >= options.maxReplyDepth) {
            return { comments: commentCount, replies: replyCount };
        }

        // Primary check: if updatedAt hasn't changed, replies are the same
        if (storedUpdatedAt !== null && pageComment.updatedAt === storedUpdatedAt) {
            return { comments: commentCount, replies: replyCount };
        }

        // Load and store replies from pageCids or preloaded pages
        const repliesPageCids = pageComment.replies?.pageCids || {};
        const repliesPages = pageComment.replies?.pages || {};
        const currentRepliesPageCid = repliesPageCids.new || Object.values(repliesPageCids)[0];
        const hasPreloadedReplies = Object.keys(repliesPages).length > 0;

        if (currentRepliesPageCid || hasPreloadedReplies) {
            // Secondary optimization: skip if pageCid unchanged
            if (currentRepliesPageCid) {
                const lastIndexedPageCid = queries.getLastRepliesPageCid(pageComment.cid);
                if (lastIndexedPageCid === currentRepliesPageCid) {
                    // Replies haven't changed, skip fetching
                    return { comments: commentCount, replies: replyCount };
                }
            }

            let replies: PageTypeJson["comments"] = [];

            if (currentRepliesPageCid) {
                // Fetch replies via pageCid - use loadAllPages directly to bypass
                // the early-return check in loadAllRepliesFromComment (which checks
                // the Comment instance's replies, not the raw page data)
                const comment = await plebbit.createComment(pageComment);
                replies = await loadAllPages(currentRepliesPageCid, comment.replies);
            } else {
                // Edge case: all replies in preloaded pages (small sub)
                const preloadedPage = repliesPages.best || repliesPages.new || Object.values(repliesPages)[0];
                replies = preloadedPage?.comments || [];

                // Follow nextCid pagination if the preloaded page has more pages
                if (preloadedPage?.nextCid) {
                    const comment = await plebbit.createComment(pageComment);
                    const remainingReplies = await loadAllPages(preloadedPage.nextCid, comment.replies);
                    replies = replies.concat(remainingReplies);
                }
            }

            for (const reply of replies) {
                const result = await storeCommentWithReplies(reply, currentDepth + 1);
                replyCount += result.comments + result.replies;
            }

            if (currentRepliesPageCid) {
                queries.updateLastRepliesPageCid(pageComment.cid, currentRepliesPageCid);
            }
        }

        return { comments: commentCount, replies: replyCount };
    };

    for (const post of posts) {
        if (post.cid) {
            seenCids.push(post.cid);
        }
        const result = await storeCommentWithReplies(post, 0);
        postsCount += result.comments;
        repliesCount += result.replies;
    }

    // Batch-update seenAtSubplebbitUpdatedAt for all posts seen in this crawl
    if (seenCids.length > 0) {
        queries.updateLastSeenInPagesAtBatch({ cids: seenCids, timestamp: crawlTimestamp });
    }

    // Detect posts that disappeared from pages since last crawl
    const disappearedCids = queries.getDisappearedFromPagesCids({ subplebbitAddress: subAddress, crawlTimestamp });
    for (const cid of disappearedCids) {
        queries.recordCommentUpdateFetchFailure(cid);
    }

    console.log(
        `[CommentFetcher] Indexed ${postsCount} posts and ${repliesCount} replies from ${subAddress}` +
            (disappearedCids.length > 0 ? `, ${disappearedCids.length} disappeared` : "")
    );

    return { postsCount, repliesCount, disappearedCount: disappearedCids.length };
}

/**
 * Store a raw comment (from createComment/getComment) into the database.
 * Uses comment.raw.comment and comment.raw.commentUpdate.
 */
export function storeRawComment(comment: Comment, queries: IndexerQueries): { hasUpdate: boolean } {
    const raw = comment.raw;
    if (!raw?.comment) {
        console.warn("[CommentFetcher] Comment has no raw.comment data");
        return { hasUpdate: false };
    }

    const cid = comment.cid;
    if (!cid) {
        console.warn("[CommentFetcher] Comment has no CID");
        return { hasUpdate: false };
    }

    const commentIpfs = raw.comment;

    // Store CommentIpfs (only inserts if not exists, since CommentIpfs is immutable)
    queries.insertIndexedCommentIpfsIfNotExists({
        cid,
        subplebbitAddress: commentIpfs.subplebbitAddress,
        author: commentIpfs.author,
        signature: commentIpfs.signature,
        parentCid: commentIpfs.parentCid ?? null,
        content: commentIpfs.content ?? null,
        title: commentIpfs.title ?? null,
        link: commentIpfs.link ?? null,
        timestamp: commentIpfs.timestamp,
        depth: commentIpfs.depth ?? 0,
        protocolVersion: commentIpfs.protocolVersion ?? null
    });

    // Store CommentUpdate if available
    const commentUpdate = raw.commentUpdate;
    if (commentUpdate) {
        // Use type assertion to access optional fields that may not be in the base type
        const update = commentUpdate as {
            author?: unknown;
            upvoteCount?: number;
            downvoteCount?: number;
            replyCount?: number;
            removed?: boolean;
            deleted?: boolean;
            locked?: boolean;
            pinned?: boolean;
            approved?: boolean;
            updatedAt?: number;
        };
        queries.upsertIndexedCommentUpdate({
            cid,
            author: update.author ?? null,
            upvoteCount: update.upvoteCount ?? null,
            downvoteCount: update.downvoteCount ?? null,
            replyCount: update.replyCount ?? null,
            removed: update.removed ?? null,
            deleted: update.deleted ?? null,
            locked: update.locked ?? null,
            pinned: update.pinned ?? null,
            approved: update.approved ?? null,
            updatedAt: update.updatedAt ?? null
        });
        return { hasUpdate: true };
    }

    return { hasUpdate: false };
}
