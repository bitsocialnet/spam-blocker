/**
 * Types for the subplebbit indexer module.
 */

import type { CommentIpfsType, CommentUpdateType, SubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/publications/comment/types.js";
import type { AuthorTypeWithCommentUpdate } from "@plebbit/plebbit-js/dist/node/types.js";
import type { SubplebbitIpfsType } from "@plebbit/plebbit-js/dist/node/subplebbit/types.js";

/**
 * Re-export plebbit-js types for convenience.
 */
export type { CommentIpfsType, CommentUpdateType, SubplebbitAuthor, AuthorTypeWithCommentUpdate, SubplebbitIpfsType };

/**
 * How the subplebbit was discovered for indexing.
 */
export type DiscoverySource = "evaluate_api" | "previous_comment_cid" | "manual";

/**
 * Database row for indexed_subplebbits table.
 * Uses SubplebbitIpfsType from plebbit-js for address, signature.publicKey, and updatedAt fields.
 */
export interface IndexedSubplebbit {
    address: SubplebbitIpfsType["address"];
    publicKey: SubplebbitIpfsType["signature"]["publicKey"] | null;
    discoveredVia: DiscoverySource;
    discoveredAt: number;
    indexingEnabled: number; // 1 or 0
    lastPostsPageCidNew: string | null;
    lastSubplebbitUpdatedAt: SubplebbitIpfsType["updatedAt"] | null;
    consecutiveErrors: number;
    lastError: string | null; // Plain text error message, not JSON
}

/**
 * Database row for indexed_comments_ipfs table.
 * Uses CommentIpfsType from plebbit-js for field types.
 */
export interface IndexedCommentIpfs {
    cid: string;
    subplebbitAddress: CommentIpfsType["subplebbitAddress"];
    author: string; // JSON string of CommentIpfsType["author"]
    signature: string; // JSON string of CommentIpfsType["signature"]
    parentCid: CommentIpfsType["parentCid"] | null;
    content: CommentIpfsType["content"] | null;
    title: CommentIpfsType["title"] | null;
    link: CommentIpfsType["link"] | null;
    timestamp: CommentIpfsType["timestamp"];
    depth: CommentIpfsType["depth"] | null;
    protocolVersion: CommentIpfsType["protocolVersion"] | null;
    fetchedAt: number;
}

/**
 * Database row for indexed_comments_update table.
 * Uses CommentUpdateType from plebbit-js for field types.
 */
export interface IndexedCommentUpdate {
    cid: string;
    author: string | null; // JSON string of { subplebbit: SubplebbitAuthor }
    upvoteCount: CommentUpdateType["upvoteCount"] | null;
    downvoteCount: CommentUpdateType["downvoteCount"] | null;
    replyCount: CommentUpdateType["replyCount"] | null;
    removed: number | null; // 1 or 0 (SQLite boolean)
    deleted: number | null; // 1 or 0 (SQLite boolean)
    locked: number | null; // 1 or 0 (SQLite boolean)
    pinned: number | null; // 1 or 0 (SQLite boolean)
    approved: number | null; // 1, 0, or null (SQLite boolean)
    updatedAt: CommentUpdateType["updatedAt"] | null;
    lastRepliesPageCid: string | null; // replies.pageCids.new - skip re-fetching if unchanged
    fetchedAt: number | null;
    lastFetchFailedAt: number | null;
    fetchFailureCount: number;
    seenAtSubplebbitUpdatedAt: number | null;
}

/**
 * Database row for modqueue_comments_ipfs table.
 * Uses CommentIpfsType from plebbit-js for field types.
 */
export interface ModQueueCommentIpfs {
    cid: string;
    subplebbitAddress: CommentIpfsType["subplebbitAddress"];
    author: string; // JSON string of CommentIpfsType["author"]
    signature: string; // JSON string of CommentIpfsType["signature"]
    parentCid: CommentIpfsType["parentCid"] | null;
    content: CommentIpfsType["content"] | null;
    title: CommentIpfsType["title"] | null;
    link: CommentIpfsType["link"] | null;
    timestamp: CommentIpfsType["timestamp"];
    depth: CommentIpfsType["depth"] | null;
    protocolVersion: CommentIpfsType["protocolVersion"] | null;
    firstSeenAt: number;
}

/**
 * Database row for modqueue_comments_update table.
 * Uses CommentUpdateType from plebbit-js for field types where applicable.
 */
export interface ModQueueCommentUpdate {
    cid: string;
    author: string | null; // JSON string of { subplebbit: SubplebbitAuthor }
    protocolVersion: CommentUpdateType["protocolVersion"] | null;
    number: number | null; // From CommentUpdateForChallengeVerification
    postNumber: number | null; // From CommentUpdateForChallengeVerification
    pendingApproval: number; // always 1 while in modQueue (SQLite boolean)
    lastSeenAt: number;
    resolved: number; // 1 or 0 (SQLite boolean)
    resolvedAt: number | null;
    accepted: number | null; // 1, 0, or null (SQLite boolean)
}

/**
 * CommentIpfs with CID - use CommentIpfsType from plebbit-js and add cid.
 * For parsed data, use CommentIpfsType directly.
 */
export type CommentIpfsWithCid = CommentIpfsType & { cid: string };

/**
 * CommentUpdate with CID - use CommentUpdateType from plebbit-js and add cid.
 * For parsed data, use CommentUpdateType directly.
 */
export type CommentUpdateWithCid = CommentUpdateType & { cid: string };

/**
 * Input params for inserting a comment IPFS record.
 * Uses the row type but with `unknown` for author/signature (pre-JSON serialization).
 */
export type CommentIpfsInsertParams = Omit<IndexedCommentIpfs, "author" | "signature" | "fetchedAt"> & {
    author: unknown;
    signature: unknown;
};

/**
 * Input params for upserting a comment update record.
 * Converts SQLite number booleans to JS booleans, uses unknown for author (pre-JSON serialization),
 * and omits auto-generated fields.
 */
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
    | "seenAtSubplebbitUpdatedAt"
> & {
    author: unknown | null;
    removed: boolean | null;
    deleted: boolean | null;
    locked: boolean | null;
    pinned: boolean | null;
    approved: boolean | null;
    lastRepliesPageCid?: string | null;
};

/**
 * Input params for upserting a modqueue comment update record.
 * Uses unknown for author (pre-JSON serialization), omits auto-generated fields.
 */
export type ModQueueCommentUpdateInsertParams = Pick<ModQueueCommentUpdate, "cid" | "protocolVersion" | "number" | "postNumber"> & {
    author: unknown | null;
};

/**
 * Author stats calculated from indexed data.
 */
export interface AuthorNetworkStats {
    /** Number of unique subs where author has an active ban (banExpiresAt >= now) */
    banCount: number;
    /** Number of comments that have been removed by mods */
    removalCount: number;
    /** Number of comments that have been disapproved */
    disapprovalCount: number;
    /** Number of comments where CommentUpdate couldn't be fetched (likely purged) */
    unfetchableCount: number;
    /** Number of modqueue submissions that were rejected */
    modqueueRejected: number;
    /** Number of modqueue submissions that were accepted */
    modqueueAccepted: number;
    /** Total number of indexed comments by this author */
    totalIndexedComments: number;
    /** Number of distinct subplebbits the author has posted to */
    distinctSubplebbitsPostedTo: number;
}

/**
 * Configuration for the indexer.
 */
export interface IndexerConfig {
    /** Maximum concurrent page fetches (default: 10) */
    maxConcurrentPageFetches: number;
    /** Timeout for previous CID crawling in milliseconds (default: 60000) */
    previousCidCrawlTimeout: number;
    /** Maximum depth when following previousCommentCid chains (default: 10) */
    maxPreviousCidDepth: number;
    /** Number of consecutive errors before disabling indexing for a sub (default: 5) */
    maxConsecutiveErrors: number;
    /** Enable the previousCommentCid crawler (default: false) */
    enablePreviousCidCrawler: boolean;
}

/**
 * Default indexer configuration.
 */
export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
    maxConcurrentPageFetches: 10,
    previousCidCrawlTimeout: 60000,
    maxPreviousCidDepth: 10,
    maxConsecutiveErrors: 5,
    enablePreviousCidCrawler: false
};
