/**
 * Worker for fetching and storing comments from community pages.
 * Follows the pkc-js loadAllUniquePostsUnderCommunity pattern.
 */

import type { PostsPages, RepliesPages } from "@pkcprotocol/pkc-js/dist/node/pages/pages.js";
import type { PageTypeJson } from "@pkcprotocol/pkc-js/dist/node/pages/types.js";
import type { Database } from "better-sqlite3";
import { IndexerQueries } from "../db/queries.js";
import { getPageQueue } from "../page-queue.js";
import type { PkcInstance } from "../pkc-manager.js";

type RemoteCommunity = Awaited<ReturnType<PkcInstance["getCommunity"]>>;
type Comment = Awaited<ReturnType<PkcInstance["createComment"]>>;

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

export async function loadAllPostsFromCommunity(community: RemoteCommunity): Promise<PageTypeJson["comments"]> {
    if (Object.keys(community.posts.pageCids).length === 0 && Object.keys(community.posts.pages).length === 0) {
        return [];
    }

    const allCommentsInPreloadedPages = Object.keys(community.posts.pageCids).length === 0 && Object.keys(community.posts.pages).length > 0;

    if (allCommentsInPreloadedPages) {
        const preloadedPage = Object.values(community.posts.pages)[0];
        return preloadedPage?.comments || [];
    }

    if (community.posts.pageCids.new) {
        return loadAllPages(community.posts.pageCids.new, community.posts);
    }

    const firstPageCid = Object.values(community.posts.pageCids)[0];
    if (firstPageCid) {
        return loadAllPages(firstPageCid, community.posts);
    }

    return [];
}

export async function loadAllRepliesFromComment(comment: Comment): Promise<PageTypeJson["comments"]> {
    if (Object.keys(comment.replies.pageCids).length === 0 && Object.keys(comment.replies.pages).length === 0) {
        return [];
    }

    const allCommentsInPreloadedPages = Object.keys(comment.replies.pageCids).length === 0 && Object.keys(comment.replies.pages).length > 0;
    if (allCommentsInPreloadedPages) {
        const preloadedPage = comment.replies.pages.best || comment.replies.pages.new || Object.values(comment.replies.pages)[0];
        return preloadedPage?.comments || [];
    }

    if (comment.replies.pageCids.new) {
        return loadAllPages(comment.replies.pageCids.new, comment.replies);
    }

    const firstPageCid = Object.values(comment.replies.pageCids)[0];
    if (firstPageCid) {
        return loadAllPages(firstPageCid, comment.replies);
    }

    return [];
}

export function storeCommentFromPage(
    pageComment: PageTypeJson["comments"][number],
    communityAddress: string,
    queries: IndexerQueries
): void {
    const cid = pageComment.cid;
    if (!cid) {
        console.warn("[CommentFetcher] Skipping comment without CID");
        return;
    }

    const commentIpfs = {
        cid,
        communityAddress,
        author: pageComment.author,
        signature: pageComment.signature,
        parentCid: pageComment.parentCid ?? null,
        content: pageComment.content ?? null,
        title: pageComment.title ?? null,
        link: pageComment.link ?? null,
        timestamp: pageComment.timestamp,
        depth: pageComment.depth ?? 0,
        protocolVersion: pageComment.protocolVersion ?? null,
        pseudonymityMode: pageComment.pseudonymityMode ?? null
    };

    queries.insertIndexedCommentIpfsIfNotExists(commentIpfs as never);

    if (typeof pageComment.updatedAt === "number") {
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

export async function fetchAndStoreCommunityComments(
    community: RemoteCommunity,
    pkc: PkcInstance,
    db: Database,
    options: {
        maxReplyDepth?: number;
        onNewPreviousCid?: (previousCid: string) => void;
    } = {}
): Promise<{ postsCount: number; repliesCount: number; disappearedCount: number; purgedCount: number; removedCount: number }> {
    const queries = new IndexerQueries(db);
    const communityAddress = community.address;
    const crawlTimestamp = community.updatedAt ?? Math.floor(Date.now() / 1000);

    let postsCount = 0;
    let repliesCount = 0;
    const seenCids: string[] = [];

    const posts = await loadAllPostsFromCommunity(community);

    const storeCommentWithReplies = async (
        pageComment: PageTypeJson["comments"][number],
        currentDepth: number
    ): Promise<{ comments: number; replies: number }> => {
        if (!pageComment.cid) return { comments: 0, replies: 0 };

        const storedUpdatedAt = queries.getCommentUpdatedAt(pageComment.cid);
        storeCommentFromPage(pageComment, communityAddress, queries);

        const previousCid = (pageComment.author as { previousCommentCid?: string } | undefined)?.previousCommentCid;
        if (previousCid && options.onNewPreviousCid && !queries.hasIndexedCommentIpfs(previousCid)) {
            options.onNewPreviousCid(previousCid);
        }

        let commentCount = 1;
        let replyCount = 0;

        if (options.maxReplyDepth !== undefined && currentDepth >= options.maxReplyDepth) {
            return { comments: commentCount, replies: replyCount };
        }

        if (storedUpdatedAt !== null && pageComment.updatedAt === storedUpdatedAt) {
            return { comments: commentCount, replies: replyCount };
        }

        const repliesPageCids = pageComment.replies?.pageCids || {};
        const repliesPages = pageComment.replies?.pages || {};
        const currentRepliesPageCid = repliesPageCids.new || Object.values(repliesPageCids)[0];
        const hasPreloadedReplies = Object.keys(repliesPages).length > 0;

        if (currentRepliesPageCid || hasPreloadedReplies) {
            if (currentRepliesPageCid) {
                const lastIndexedPageCid = queries.getLastRepliesPageCid(pageComment.cid);
                if (lastIndexedPageCid === currentRepliesPageCid) {
                    return { comments: commentCount, replies: replyCount };
                }
            }

            let replies: PageTypeJson["comments"] = [];

            if (currentRepliesPageCid) {
                const comment = await pkc.createComment(pageComment);
                replies = await loadAllPages(currentRepliesPageCid, comment.replies);
            } else {
                const preloadedPage = repliesPages.best || repliesPages.new || Object.values(repliesPages)[0];
                replies = preloadedPage?.comments || [];
                if (preloadedPage?.nextCid) {
                    const comment = await pkc.createComment(pageComment);
                    const remainingReplies = await loadAllPages(preloadedPage.nextCid, comment.replies);
                    replies = replies.concat(remainingReplies);
                }
            }

            const oldReplyCids = queries.getDirectReplyCids(pageComment.cid);
            if (oldReplyCids.length > 0) {
                const newReplyCidSet = new Set(replies.map((r) => r.cid).filter(Boolean));
                const disappeared = oldReplyCids.filter((cid) => !newReplyCidSet.has(cid));
                if (disappeared.length > 0) {
                    queries.markAsPurged(disappeared);
                    console.log(`[CommentFetcher] Marked ${disappeared.length} purged replies (+ descendants) under ${pageComment.cid}`);
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

    if (seenCids.length > 0) {
        queries.updateLastSeenInPagesAtBatch({ cids: seenCids, timestamp: crawlTimestamp });
    }

    const disappearedCids = queries.getDisappearedFromPagesCids({ communityAddress, crawlTimestamp });
    for (const cid of disappearedCids) {
        queries.recordCommentUpdateFetchFailure(cid);
    }

    let purgedCount = 0;
    let removedCount = 0;
    const postsAwaitingVerification = queries.getPostsAwaitingVerification(communityAddress);
    for (const { cid } of postsAwaitingVerification) {
        let comment: Awaited<ReturnType<PkcInstance["createComment"]>> | null = null;
        try {
            comment = await pkc.createComment({ cid });
            await comment.update();

            const result = await Promise.race([
                new Promise<"removed" | "accessible">((resolve) => {
                    comment!.on("update", () => {
                        if (comment!.raw?.commentUpdate?.updatedAt !== undefined) {
                            const update = comment!.raw.commentUpdate as { removed?: boolean };
                            resolve(update.removed ? "removed" : "accessible");
                        }
                    });
                }),
                new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30000))
            ]);

            if (result === "removed") {
                queries.markAsRemoved(cid);
                removedCount++;
                console.log(`[CommentFetcher] Post ${cid} confirmed removed via IPFS`);
            } else if (result === "accessible") {
                queries.upsertIndexedCommentUpdate({
                    cid,
                    author: comment!.raw?.commentUpdate?.author ?? null,
                    upvoteCount: (comment!.raw?.commentUpdate as any)?.upvoteCount ?? null,
                    downvoteCount: (comment!.raw?.commentUpdate as any)?.downvoteCount ?? null,
                    replyCount: (comment!.raw?.commentUpdate as any)?.replyCount ?? null,
                    removed: (comment!.raw?.commentUpdate as any)?.removed ?? null,
                    deleted: (comment!.raw?.commentUpdate as any)?.deleted ?? null,
                    locked: (comment!.raw?.commentUpdate as any)?.locked ?? null,
                    pinned: (comment!.raw?.commentUpdate as any)?.pinned ?? null,
                    approved: (comment!.raw?.commentUpdate as any)?.approved ?? null,
                    updatedAt: (comment!.raw?.commentUpdate as any)?.updatedAt ?? null
                });
                console.log(`[CommentFetcher] Post ${cid} still accessible via IPFS, reset failure count`);
            } else {
                queries.recordCommentUpdateFetchFailure(cid);
                const updated = queries.getIndexedCommentUpdate(cid);
                if (updated && updated.fetchFailureCount >= 3) {
                    queries.markAsPurged([cid]);
                    purgedCount++;
                    console.log(`[CommentFetcher] Post ${cid} confirmed purged after 3 fetch failures`);
                }
            }
        } catch {
            queries.recordCommentUpdateFetchFailure(cid);
            const updated = queries.getIndexedCommentUpdate(cid);
            if (updated && updated.fetchFailureCount >= 3) {
                queries.markAsPurged([cid]);
                purgedCount++;
                console.log(`[CommentFetcher] Post ${cid} confirmed purged after 3 fetch failures`);
            }
        } finally {
            if (comment) {
                await comment.stop();
            }
        }
    }

    console.log(
        `[CommentFetcher] Indexed ${postsCount} posts and ${repliesCount} replies from ${communityAddress}` +
            (disappearedCids.length > 0 ? `, ${disappearedCids.length} disappeared` : "") +
            (purgedCount > 0 ? `, ${purgedCount} purged` : "") +
            (removedCount > 0 ? `, ${removedCount} removed` : "")
    );

    return { postsCount, repliesCount, disappearedCount: disappearedCids.length, purgedCount, removedCount };
}

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

    const commentIpfs = raw.comment as {
        communityAddress: string;
        author: unknown;
        signature: unknown;
        parentCid?: string | null;
        content?: string | null;
        title?: string | null;
        link?: string | null;
        timestamp: number;
        depth?: number | null;
        protocolVersion?: string | null;
        pseudonymityMode?: string | null;
    };

    queries.insertIndexedCommentIpfsIfNotExists({
        cid,
        communityAddress: commentIpfs.communityAddress,
        author: commentIpfs.author,
        signature: commentIpfs.signature,
        parentCid: commentIpfs.parentCid ?? null,
        content: commentIpfs.content ?? null,
        title: commentIpfs.title ?? null,
        link: commentIpfs.link ?? null,
        timestamp: commentIpfs.timestamp,
        depth: commentIpfs.depth ?? 0,
        protocolVersion: commentIpfs.protocolVersion ?? null,
        pseudonymityMode: commentIpfs.pseudonymityMode ?? null
    } as never);

    const commentUpdate = raw.commentUpdate;
    if (commentUpdate) {
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
