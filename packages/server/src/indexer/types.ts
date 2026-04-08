/**
 * Types for the community indexer module.
 */

import type { CommentIpfsType, CommentUpdateType, CommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/publications/comment/types.js";
import type { AuthorTypeWithCommentUpdate } from "@pkcprotocol/pkc-js/dist/node/types.js";
import type { CommunityIpfsType } from "@pkcprotocol/pkc-js/dist/node/community/types.js";

export type { CommentIpfsType, CommentUpdateType, CommunityAuthor, AuthorTypeWithCommentUpdate, CommunityIpfsType };

export type DiscoverySource = "evaluate_api" | "previous_comment_cid" | "manual";

export interface IndexedCommunity {
    address: string;
    publicKey: CommunityIpfsType["signature"]["publicKey"] | null;
    discoveredVia: DiscoverySource;
    discoveredAt: number;
    indexingEnabled: number;
    lastPostsPageCidNew: string | null;
    lastCommunityUpdatedAt: CommunityIpfsType["updatedAt"] | null;
    lastUpdateCid: string | null;
    lastModQueuePendingApprovalPageCid: string | null;
    consecutiveErrors: number;
    lastError: string | null;
}

export interface IndexedCommentIpfs {
    cid: string;
    communityAddress: string;
    author: string;
    signature: string;
    parentCid: CommentIpfsType["parentCid"] | null;
    content: CommentIpfsType["content"] | null;
    title: CommentIpfsType["title"] | null;
    link: CommentIpfsType["link"] | null;
    timestamp: CommentIpfsType["timestamp"];
    depth: CommentIpfsType["depth"] | null;
    protocolVersion: CommentIpfsType["protocolVersion"] | null;
    pseudonymityMode: CommentIpfsType["pseudonymityMode"] | null;
    fetchedAt: number;
}

export interface IndexedCommentUpdate {
    cid: string;
    author: string | null;
    upvoteCount: CommentUpdateType["upvoteCount"] | null;
    downvoteCount: CommentUpdateType["downvoteCount"] | null;
    replyCount: CommentUpdateType["replyCount"] | null;
    removed: number | null;
    deleted: number | null;
    locked: number | null;
    pinned: number | null;
    approved: number | null;
    updatedAt: CommentUpdateType["updatedAt"] | null;
    lastRepliesPageCid: string | null;
    fetchedAt: number | null;
    lastFetchFailedAt: number | null;
    fetchFailureCount: number;
    purged: number | null;
    seenAtCommunityUpdatedAt: number | null;
}

export interface ModQueueCommentIpfs {
    cid: string;
    communityAddress: string;
    author: string;
    signature: string;
    parentCid: CommentIpfsType["parentCid"] | null;
    content: CommentIpfsType["content"] | null;
    title: CommentIpfsType["title"] | null;
    link: CommentIpfsType["link"] | null;
    timestamp: CommentIpfsType["timestamp"];
    depth: CommentIpfsType["depth"] | null;
    protocolVersion: CommentIpfsType["protocolVersion"] | null;
    pseudonymityMode: CommentIpfsType["pseudonymityMode"] | null;
    firstSeenAt: number;
}

export interface ModQueueCommentUpdate {
    cid: string;
    author: string | null;
    protocolVersion: CommentUpdateType["protocolVersion"] | null;
    number: number | null;
    postNumber: number | null;
    pendingApproval: number;
    lastSeenAt: number;
    resolved: number;
    resolvedAt: number | null;
    accepted: number | null;
}

export type CommentIpfsWithCid = CommentIpfsType & { cid: string };
export type CommentUpdateWithCid = CommentUpdateType & { cid: string };

export type CommentIpfsInsertParams = Omit<IndexedCommentIpfs, "author" | "signature" | "fetchedAt"> & {
    author: unknown;
    signature: unknown;
};

export type CommentUpdateInsertParams = Omit<
    IndexedCommentUpdate,
    | "author"
    | "removed"
    | "deleted"
    | "locked"
    | "pinned"
    | "approved"
    | "lastRepliesPageCid"
    | "fetchedAt"
    | "lastFetchFailedAt"
    | "fetchFailureCount"
    | "purged"
    | "seenAtCommunityUpdatedAt"
> & {
    author: unknown | null;
    removed: boolean | null;
    deleted: boolean | null;
    locked: boolean | null;
    pinned: boolean | null;
    approved: boolean | null;
    lastRepliesPageCid?: string | null;
};

export type ModQueueCommentUpdateInsertParams = Pick<ModQueueCommentUpdate, "cid" | "protocolVersion" | "number" | "postNumber"> & {
    author: unknown | null;
};

export interface AuthorNetworkStats {
    banCount: number;
    removalCount: number;
    disapprovalCount: number;
    unfetchableCount: number;
    purgedCount: number;
    modqueueRejected: number;
    modqueueAccepted: number;
    totalIndexedComments: number;
    distinctCommunitiesPostedTo: number;
}

export interface IndexerConfig {
    maxConcurrentPageFetches: number;
    previousCidCrawlTimeout: number;
    maxPreviousCidDepth: number;
    maxConsecutiveErrors: number;
    enablePreviousCidCrawler: boolean;
}

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
    maxConcurrentPageFetches: 10,
    previousCidCrawlTimeout: 60000,
    maxPreviousCidDepth: 10,
    maxConsecutiveErrors: 5,
    enablePreviousCidCrawler: false
};
