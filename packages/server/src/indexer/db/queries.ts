/**
 * Database queries for the indexer module.
 * Provides methods for managing indexed subplebbits, comments, and modqueue.
 */

import type { Database } from "better-sqlite3";
import type {
    AuthorNetworkStats,
    CommentIpfsInsertParams,
    CommentUpdateInsertParams,
    DiscoverySource,
    IndexedCommentIpfs,
    IndexedCommentUpdate,
    IndexedSubplebbit,
    ModQueueCommentUpdate,
    ModQueueCommentUpdateInsertParams
} from "../types.js";

/**
 * Indexer database operations.
 */
export class IndexerQueries {
    constructor(private db: Database) {}

    // ============================================
    // Indexed Subplebbits
    // ============================================

    /**
     * Insert or update an indexed subplebbit.
     */
    upsertIndexedSubplebbit(params: { address: string; publicKey?: string; discoveredVia: DiscoverySource }): void {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO indexed_subplebbits (address, publicKey, discoveredVia, discoveredAt)
                 VALUES (@address, @publicKey, @discoveredVia, @discoveredAt)
                 ON CONFLICT(address) DO UPDATE SET
                     publicKey = COALESCE(@publicKey, publicKey)`
            )
            .run({
                address: params.address,
                publicKey: params.publicKey ?? null,
                discoveredVia: params.discoveredVia,
                discoveredAt: now
            });
    }

    /**
     * Get all indexed subplebbits that are enabled for indexing.
     */
    getEnabledSubplebbits(): IndexedSubplebbit[] {
        return this.db.prepare(`SELECT * FROM indexed_subplebbits WHERE indexingEnabled = 1`).all() as IndexedSubplebbit[];
    }

    /**
     * Get an indexed subplebbit by address.
     */
    getIndexedSubplebbit(address: string): IndexedSubplebbit | undefined {
        return this.db.prepare(`SELECT * FROM indexed_subplebbits WHERE address = ?`).get(address) as IndexedSubplebbit | undefined;
    }

    /**
     * Update subplebbit cache markers (for change detection).
     */
    updateSubplebbitCacheMarkers(params: {
        address: string;
        lastPostsPageCidNew: string | null;
        lastSubplebbitUpdatedAt: number | null;
        lastUpdateCid: string;
        lastModQueuePendingApprovalPageCid?: string | null;
    }): void {
        this.db
            .prepare(
                `UPDATE indexed_subplebbits
                 SET lastPostsPageCidNew = @lastPostsPageCidNew,
                     lastSubplebbitUpdatedAt = @lastSubplebbitUpdatedAt,
                     lastUpdateCid = @lastUpdateCid,
                     lastModQueuePendingApprovalPageCid = @lastModQueuePendingApprovalPageCid,
                     consecutiveErrors = 0,
                     lastError = NULL
                 WHERE address = @address`
            )
            .run({
                address: params.address,
                lastPostsPageCidNew: params.lastPostsPageCidNew,
                lastSubplebbitUpdatedAt: params.lastSubplebbitUpdatedAt,
                lastUpdateCid: params.lastUpdateCid,
                lastModQueuePendingApprovalPageCid: params.lastModQueuePendingApprovalPageCid ?? null
            });
    }

    /**
     * Record an error for a subplebbit and increment error count.
     */
    recordSubplebbitError(address: string, error: string): void {
        this.db
            .prepare(
                `UPDATE indexed_subplebbits
                 SET consecutiveErrors = consecutiveErrors + 1,
                     lastError = @error
                 WHERE address = @address`
            )
            .run({ address, error });
    }

    /**
     * Disable indexing for a subplebbit.
     */
    disableSubplebbitIndexing(address: string): void {
        this.db.prepare(`UPDATE indexed_subplebbits SET indexingEnabled = 0 WHERE address = ?`).run(address);
    }

    // ============================================
    // Indexed Comments (IPFS)
    // ============================================

    /**
     * Insert an indexed comment IPFS record if it doesn't exist.
     * CommentIpfs is immutable, so we only insert once and never update.
     */
    insertIndexedCommentIpfsIfNotExists(params: CommentIpfsInsertParams): void {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO indexed_comments_ipfs (
                    cid, subplebbitAddress, author, signature, parentCid, content, title, link,
                    timestamp, depth, protocolVersion, pseudonymityMode, fetchedAt
                 ) VALUES (
                    @cid, @subplebbitAddress, @author, @signature, @parentCid, @content, @title, @link,
                    @timestamp, @depth, @protocolVersion, @pseudonymityMode, @fetchedAt
                 ) ON CONFLICT(cid) DO NOTHING`
            )
            .run({
                cid: params.cid,
                subplebbitAddress: params.subplebbitAddress,
                author: JSON.stringify(params.author),
                signature: JSON.stringify(params.signature),
                parentCid: params.parentCid,
                content: params.content,
                title: params.title,
                link: params.link,
                timestamp: params.timestamp,
                depth: params.depth,
                protocolVersion: params.protocolVersion,
                pseudonymityMode: params.pseudonymityMode,
                fetchedAt: now
            });
    }

    /**
     * Check if a comment IPFS record exists.
     */
    hasIndexedCommentIpfs(cid: string): boolean {
        const result = this.db.prepare(`SELECT 1 FROM indexed_comments_ipfs WHERE cid = ?`).get(cid);
        return result !== undefined;
    }

    /**
     * Get an indexed comment IPFS record.
     */
    getIndexedCommentIpfs(cid: string): IndexedCommentIpfs | undefined {
        return this.db.prepare(`SELECT * FROM indexed_comments_ipfs WHERE cid = ?`).get(cid) as IndexedCommentIpfs | undefined;
    }

    /**
     * Get author's previousCommentCid from a comment.
     */
    getAuthorPreviousCommentCid(cid: string): string | null {
        const result = this.db
            .prepare(`SELECT json_extract(author, '$.previousCommentCid') as previousCid FROM indexed_comments_ipfs WHERE cid = ?`)
            .get(cid) as { previousCid: string | null } | undefined;
        return result?.previousCid ?? null;
    }

    // ============================================
    // Indexed Comments (Update)
    // ============================================

    /**
     * Insert or update an indexed comment update record.
     */
    upsertIndexedCommentUpdate(params: CommentUpdateInsertParams): void {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO indexed_comments_update (
                    cid, author, upvoteCount, downvoteCount, replyCount, removed, deleted, locked,
                    pinned, approved, updatedAt, lastRepliesPageCid, fetchedAt, fetchFailureCount
                 ) VALUES (
                    @cid, @author, @upvoteCount, @downvoteCount, @replyCount, @removed, @deleted, @locked,
                    @pinned, @approved, @updatedAt, @lastRepliesPageCid, @fetchedAt, 0
                 ) ON CONFLICT(cid) DO UPDATE SET
                    author = @author,
                    upvoteCount = @upvoteCount,
                    downvoteCount = @downvoteCount,
                    replyCount = @replyCount,
                    removed = @removed,
                    deleted = @deleted,
                    locked = @locked,
                    pinned = @pinned,
                    approved = @approved,
                    updatedAt = @updatedAt,
                    lastRepliesPageCid = COALESCE(@lastRepliesPageCid, lastRepliesPageCid),
                    fetchedAt = @fetchedAt,
                    fetchFailureCount = 0,
                    purged = 0,
                    lastFetchFailedAt = NULL`
            )
            .run({
                cid: params.cid,
                author: params.author ? JSON.stringify(params.author) : null,
                upvoteCount: params.upvoteCount,
                downvoteCount: params.downvoteCount,
                replyCount: params.replyCount,
                removed: params.removed === null ? null : params.removed ? 1 : 0,
                deleted: params.deleted === null ? null : params.deleted ? 1 : 0,
                locked: params.locked === null ? null : params.locked ? 1 : 0,
                pinned: params.pinned === null ? null : params.pinned ? 1 : 0,
                approved: params.approved === null ? null : params.approved ? 1 : 0,
                updatedAt: params.updatedAt,
                lastRepliesPageCid: params.lastRepliesPageCid ?? null,
                fetchedAt: now
            });
    }

    /**
     * Get the stored updatedAt for a comment.
     * Used as primary change detection for reply fetching.
     */
    getCommentUpdatedAt(cid: string): number | null {
        const result = this.db.prepare(`SELECT updatedAt FROM indexed_comments_update WHERE cid = ?`).get(cid) as
            | { updatedAt: number | null }
            | undefined;
        return result?.updatedAt ?? null;
    }

    /**
     * Get the last indexed replies page CID for a comment.
     * Used to skip re-fetching replies if unchanged.
     */
    getLastRepliesPageCid(cid: string): string | null {
        const result = this.db.prepare(`SELECT lastRepliesPageCid FROM indexed_comments_update WHERE cid = ?`).get(cid) as
            | { lastRepliesPageCid: string | null }
            | undefined;
        return result?.lastRepliesPageCid ?? null;
    }

    /**
     * Update only the lastRepliesPageCid for a comment.
     * Called after successfully fetching replies.
     */
    updateLastRepliesPageCid(cid: string, lastRepliesPageCid: string): void {
        this.db
            .prepare(`UPDATE indexed_comments_update SET lastRepliesPageCid = @lastRepliesPageCid WHERE cid = @cid`)
            .run({ cid, lastRepliesPageCid });
    }

    /**
     * Record a failed CommentUpdate fetch.
     */
    recordCommentUpdateFetchFailure(cid: string): void {
        const now = Date.now();
        // First ensure there's a row to update
        this.db
            .prepare(
                `INSERT INTO indexed_comments_update (cid, fetchFailureCount, lastFetchFailedAt)
                 VALUES (@cid, 1, @now)
                 ON CONFLICT(cid) DO UPDATE SET
                    fetchFailureCount = fetchFailureCount + 1,
                    lastFetchFailedAt = @now`
            )
            .run({ cid, now });
    }

    /**
     * Get an indexed comment update record.
     */
    getIndexedCommentUpdate(cid: string): IndexedCommentUpdate | undefined {
        return this.db.prepare(`SELECT * FROM indexed_comments_update WHERE cid = ?`).get(cid) as IndexedCommentUpdate | undefined;
    }

    /**
     * Bulk-update seenAtSubplebbitUpdatedAt for a batch of CIDs.
     * Sets the timestamp for all specified CIDs in a single transaction.
     */
    updateLastSeenInPagesAtBatch({ cids, timestamp }: { cids: string[]; timestamp: number }): void {
        if (cids.length === 0) return;

        const stmt = this.db.prepare(`UPDATE indexed_comments_update SET seenAtSubplebbitUpdatedAt = @timestamp WHERE cid = @cid`);
        const runBatch = this.db.transaction((cids: string[]) => {
            for (const cid of cids) {
                stmt.run({ cid, timestamp });
            }
        });
        runBatch(cids);
    }

    /**
     * Find CIDs that have disappeared from subplebbit pages.
     * Returns posts (parentCid IS NULL) where seenAtSubplebbitUpdatedAt < crawlTimestamp,
     * meaning they were previously seen but not present in the latest crawl.
     * Replies are excluded because reply pages are truncated and skipped when unchanged.
     */
    getDisappearedFromPagesCids({ subplebbitAddress, crawlTimestamp }: { subplebbitAddress: string; crawlTimestamp: number }): string[] {
        const rows = this.db
            .prepare(
                `SELECT u.cid FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE i.subplebbitAddress = @subplebbitAddress
                   AND i.parentCid IS NULL
                   AND u.seenAtSubplebbitUpdatedAt IS NOT NULL
                   AND u.seenAtSubplebbitUpdatedAt < @crawlTimestamp`
            )
            .all({ subplebbitAddress, crawlTimestamp }) as Array<{ cid: string }>;
        return rows.map((r) => r.cid);
    }

    /**
     * Get all known direct reply CIDs for a parent comment.
     * Used for per-parent comparison to detect purged replies.
     */
    getDirectReplyCids(parentCid: string): string[] {
        const rows = this.db.prepare(`SELECT cid FROM indexed_comments_ipfs WHERE parentCid = ?`).all(parentCid) as Array<{ cid: string }>;
        return rows.map((r) => r.cid);
    }

    /**
     * Mark CIDs as purged, recursively cascading to all known descendants.
     * Handles plebbit's recursive purge behavior — when a reply is purged,
     * all its sub-replies are also gone.
     */
    markAsPurged(cids: string[]): void {
        if (cids.length === 0) return;

        const placeholders = cids.map(() => "?").join(", ");

        this.db
            .prepare(
                `WITH RECURSIVE descendants AS (
                    SELECT cid FROM indexed_comments_ipfs WHERE parentCid IN (${placeholders})
                    UNION ALL
                    SELECT i.cid FROM indexed_comments_ipfs i JOIN descendants d ON i.parentCid = d.cid
                )
                UPDATE indexed_comments_update SET purged = 1
                WHERE cid IN (SELECT cid FROM descendants) OR cid IN (${placeholders})`
            )
            .run(...cids, ...cids);
    }

    /**
     * Get posts awaiting IPFS verification (disappeared but not yet confirmed purged/removed).
     * Returns posts with 1-2 fetch failures that haven't been marked as purged or removed.
     */
    getPostsAwaitingVerification(subplebbitAddress: string): Array<{ cid: string }> {
        return this.db
            .prepare(
                `SELECT u.cid FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE i.subplebbitAddress = @subplebbitAddress
                   AND i.parentCid IS NULL
                   AND u.fetchFailureCount > 0
                   AND u.fetchFailureCount < 3
                   AND (u.purged IS NULL OR u.purged = 0)
                   AND (u.removed IS NULL OR u.removed = 0)`
            )
            .all({ subplebbitAddress }) as Array<{ cid: string }>;
    }

    /**
     * Mark a post as removed (confirmed soft-delete via IPFS verification).
     */
    markAsRemoved(cid: string): void {
        this.db.prepare(`UPDATE indexed_comments_update SET removed = 1, fetchFailureCount = 0 WHERE cid = ?`).run(cid);
    }

    // ============================================
    // ModQueue Comments (IPFS)
    // ============================================

    /**
     * Insert or update a modqueue comment IPFS record.
     */
    upsertModQueueCommentIpfs(params: CommentIpfsInsertParams): void {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO modqueue_comments_ipfs (
                    cid, subplebbitAddress, author, signature, parentCid, content, title, link,
                    timestamp, depth, protocolVersion, pseudonymityMode, firstSeenAt
                 ) VALUES (
                    @cid, @subplebbitAddress, @author, @signature, @parentCid, @content, @title, @link,
                    @timestamp, @depth, @protocolVersion, @pseudonymityMode, @firstSeenAt
                 ) ON CONFLICT(cid) DO NOTHING`
            )
            .run({
                cid: params.cid,
                subplebbitAddress: params.subplebbitAddress,
                author: JSON.stringify(params.author),
                signature: JSON.stringify(params.signature),
                parentCid: params.parentCid,
                content: params.content,
                title: params.title,
                link: params.link,
                timestamp: params.timestamp,
                depth: params.depth,
                protocolVersion: params.protocolVersion,
                pseudonymityMode: params.pseudonymityMode,
                firstSeenAt: now
            });
    }

    // ============================================
    // ModQueue Comments (Update)
    // ============================================

    /**
     * Insert or update a modqueue comment update record.
     */
    upsertModQueueCommentUpdate(params: ModQueueCommentUpdateInsertParams): void {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO modqueue_comments_update (
                    cid, author, protocolVersion, number, postNumber, pendingApproval, lastSeenAt
                 ) VALUES (
                    @cid, @author, @protocolVersion, @number, @postNumber, 1, @lastSeenAt
                 ) ON CONFLICT(cid) DO UPDATE SET
                    lastSeenAt = @lastSeenAt`
            )
            .run({
                cid: params.cid,
                author: params.author ? JSON.stringify(params.author) : null,
                protocolVersion: params.protocolVersion,
                number: params.number,
                postNumber: params.postNumber,
                lastSeenAt: now
            });
    }

    /**
     * Get all unresolved modqueue items for a subplebbit.
     */
    getUnresolvedModQueueItems(subplebbitAddress: string): ModQueueCommentUpdate[] {
        return this.db
            .prepare(
                `SELECT u.* FROM modqueue_comments_update u
                 JOIN modqueue_comments_ipfs i ON u.cid = i.cid
                 WHERE i.subplebbitAddress = ? AND u.resolved = 0`
            )
            .all(subplebbitAddress) as ModQueueCommentUpdate[];
    }

    /**
     * Mark a modqueue item as resolved.
     */
    resolveModQueueItem(cid: string, accepted: boolean): void {
        const now = Date.now();
        this.db
            .prepare(
                `UPDATE modqueue_comments_update
                 SET resolved = 1, resolvedAt = @resolvedAt, accepted = @accepted
                 WHERE cid = @cid`
            )
            .run({
                cid,
                resolvedAt: now,
                accepted: accepted ? 1 : 0
            });
    }

    // ============================================
    // Author Network Stats (for risk scoring)
    // ============================================

    /**
     * Get network-wide stats for an author by their public key.
     * Used for risk scoring based on indexed data.
     */
    getAuthorNetworkStats(authorPublicKey: string): AuthorNetworkStats {
        const nowSeconds = Math.floor(Date.now() / 1000);

        // Count active bans across subs (only where banExpiresAt >= current time)
        const banResult = this.db
            .prepare(
                `SELECT COUNT(DISTINCT i.subplebbitAddress) as banCount
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND i.pseudonymityMode IS NULL
                   AND json_extract(u.author, '$.subplebbit.banExpiresAt') IS NOT NULL
                   AND json_extract(u.author, '$.subplebbit.banExpiresAt') >= ?`
            )
            .get(authorPublicKey, nowSeconds) as { banCount: number };

        // Count removals
        const removalResult = this.db
            .prepare(
                `SELECT COUNT(*) as removalCount
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND i.pseudonymityMode IS NULL
                   AND u.removed = 1`
            )
            .get(authorPublicKey) as { removalCount: number };

        // Count disapprovals
        const disapprovalResult = this.db
            .prepare(
                `SELECT COUNT(*) as disapprovalCount
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND i.pseudonymityMode IS NULL
                   AND u.approved = 0`
            )
            .get(authorPublicKey) as { disapprovalCount: number };

        // Count unfetchable updates (pending verification, excludes confirmed purged)
        const unfetchableResult = this.db
            .prepare(
                `SELECT COUNT(*) as unfetchableCount
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND u.fetchFailureCount > 0
                   AND (u.fetchedAt IS NULL OR u.lastFetchFailedAt > u.fetchedAt)
                   AND (u.purged IS NULL OR u.purged = 0)`
            )
            .get(authorPublicKey) as { unfetchableCount: number };

        // Count confirmed purged comments
        const purgedResult = this.db
            .prepare(
                `SELECT COUNT(*) as purgedCount
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND u.purged = 1`
            )
            .get(authorPublicKey) as { purgedCount: number };

        // ModQueue resolution stats
        const modqueueResult = this.db
            .prepare(
                `SELECT
                    COUNT(CASE WHEN u.accepted = 0 THEN 1 END) as rejected,
                    COUNT(CASE WHEN u.accepted = 1 THEN 1 END) as accepted
                 FROM modqueue_comments_update u
                 JOIN modqueue_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND u.resolved = 1`
            )
            .get(authorPublicKey) as { rejected: number; accepted: number };

        // Total indexed comments
        const totalResult = this.db
            .prepare(
                `SELECT COUNT(*) as total
                 FROM indexed_comments_ipfs
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { total: number };

        // Count distinct subplebbits the author has posted to
        const distinctSubsResult = this.db
            .prepare(
                `SELECT COUNT(DISTINCT subplebbitAddress) as distinctSubs
                 FROM indexed_comments_ipfs
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { distinctSubs: number };

        return {
            banCount: banResult.banCount,
            removalCount: removalResult.removalCount,
            disapprovalCount: disapprovalResult.disapprovalCount,
            unfetchableCount: unfetchableResult.unfetchableCount,
            purgedCount: purgedResult.purgedCount,
            modqueueRejected: modqueueResult.rejected,
            modqueueAccepted: modqueueResult.accepted,
            totalIndexedComments: totalResult.total,
            distinctSubplebbitsPostedTo: distinctSubsResult.distinctSubs
        };
    }

    /**
     * Get the earliest timestamp for an author across indexed comments.
     * Uses fetchedAt (server-generated) instead of timestamp (user-provided) for security.
     * This prevents manipulation by subplebbit owners who could backdate comment.timestamp.
     *
     * @returns The earliest fetchedAt timestamp in seconds, or undefined if no records
     */
    getAuthorFirstIndexedTimestamp(authorPublicKey: string): number | undefined {
        const result = this.db
            .prepare(
                `SELECT MIN(fetchedAt) as minTime
                 FROM indexed_comments_ipfs
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { minTime: number | null };

        // fetchedAt is stored in milliseconds, convert to seconds for consistency with other timestamps
        return result.minTime ? Math.floor(result.minTime / 1000) : undefined;
    }

    /**
     * Get total indexed karma for an author across all subs.
     * Uses the latest CommentUpdate for each comment.
     */
    getAuthorIndexedKarma(authorPublicKey: string): { upvotes: number; downvotes: number } {
        const result = this.db
            .prepare(
                `SELECT
                    COALESCE(SUM(u.upvoteCount), 0) as upvotes,
                    COALESCE(SUM(u.downvoteCount), 0) as downvotes
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { upvotes: number; downvotes: number };

        return result;
    }

    // ============================================
    // Risk Factor Query Methods (for CombinedDataService)
    // ============================================

    /**
     * Get karma per subplebbit from indexed comments.
     * Returns author.subplebbit data (TRUSTED, from CommentUpdate).
     * Only returns the most recent entry per subplebbit based on updatedAt.
     */
    getAuthorKarmaBySubplebbitFromIndexer(
        authorPublicKey: string
    ): Map<string, { postScore: number; replyScore: number; updatedAt: number }> {
        const karmaMap = new Map<string, { postScore: number; replyScore: number; updatedAt: number }>();

        // Query indexed_comments_update joined with indexed_comments_ipfs
        // The author field in indexed_comments_update contains author.subplebbit (TRUSTED)
        // Use updatedAt (when subplebbit last updated the comment) for recency comparison
        const rows = this.db
            .prepare(
                `SELECT
                    i.subplebbitAddress,
                    COALESCE(json_extract(u.author, '$.subplebbit.postScore'), 0) as postScore,
                    COALESCE(json_extract(u.author, '$.subplebbit.replyScore'), 0) as replyScore,
                    COALESCE(u.updatedAt, u.fetchedAt) as updatedAt
                 FROM indexed_comments_update u
                 JOIN indexed_comments_ipfs i ON u.cid = i.cid
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND u.author IS NOT NULL
                 ORDER BY COALESCE(u.updatedAt, u.fetchedAt) DESC`
            )
            .all(authorPublicKey) as Array<{
            subplebbitAddress: string;
            postScore: number;
            replyScore: number;
            updatedAt: number;
        }>;

        // Keep only the most recent entry per subplebbit
        for (const row of rows) {
            if (!karmaMap.has(row.subplebbitAddress)) {
                karmaMap.set(row.subplebbitAddress, {
                    postScore: row.postScore,
                    replyScore: row.replyScore,
                    updatedAt: row.updatedAt
                });
            }
        }

        return karmaMap;
    }

    /**
     * Get velocity stats from indexed comments.
     * Returns counts in the last hour and last 24 hours.
     * Only tracks posts and replies (comments) - votes/edits/moderations are not indexed.
     */
    getAuthorVelocityFromIndexer(authorPublicKey: string, publicationType: "post" | "reply"): { lastHour: number; last24Hours: number } {
        const now = Math.floor(Date.now() / 1000);
        const oneHourAgo = now - 3600;
        const oneDayAgo = now - 86400;

        // Posts have depth=0 (or parentCid IS NULL), replies have depth>0 (or parentCid IS NOT NULL)
        const depthCondition = publicationType === "post" ? "i.parentCid IS NULL" : "i.parentCid IS NOT NULL";

        const lastHourResult = this.db
            .prepare(
                `SELECT COUNT(*) as count
                 FROM indexed_comments_ipfs i
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND ${depthCondition}
                   AND i.timestamp >= ?`
            )
            .get(authorPublicKey, oneHourAgo) as { count: number };

        const last24HoursResult = this.db
            .prepare(
                `SELECT COUNT(*) as count
                 FROM indexed_comments_ipfs i
                 WHERE json_extract(i.signature, '$.publicKey') = ?
                   AND ${depthCondition}
                   AND i.timestamp >= ?`
            )
            .get(authorPublicKey, oneDayAgo) as { count: number };

        return {
            lastHour: lastHourResult.count,
            last24Hours: last24HoursResult.count
        };
    }

    /**
     * Find similar content from indexed comments.
     * Used for cross-subplebbit spam detection.
     *
     * Note: This method requires the jaccard_similarity function to be registered.
     * The function should be registered on the database before calling this method.
     */
    findSimilarContentFromIndexer(params: {
        content?: string;
        title?: string;
        sinceTimestamp: number;
        authorPublicKey?: string;
        excludeAuthorPublicKey?: string;
        similarityThreshold?: number;
        limit?: number;
    }): Array<{
        cid: string;
        authorPublicKey: string;
        content: string | null;
        title: string | null;
        subplebbitAddress: string;
        timestamp: number;
        contentSimilarity: number;
        titleSimilarity: number;
    }> {
        const { content, title, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey, similarityThreshold = 0.6, limit = 100 } = params;

        // Need at least content or title to search
        if ((!content || content.trim().length <= 10) && (!title || title.trim().length <= 5)) {
            return [];
        }

        const conditions: string[] = ["i.timestamp >= @sinceTimestamp"];
        const queryParams: Record<string, unknown> = {
            sinceTimestamp,
            limit,
            similarityThreshold,
            content: content || null,
            title: title || null
        };

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        if (excludeAuthorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') != @excludeAuthorPublicKey");
            queryParams.excludeAuthorPublicKey = excludeAuthorPublicKey;
        }

        // Build similarity conditions
        const similarityConditions: string[] = [];

        if (content && content.trim().length > 10) {
            similarityConditions.push("jaccard_similarity(i.content, @content) >= @similarityThreshold");
        }

        if (title && title.trim().length > 5) {
            similarityConditions.push("jaccard_similarity(i.title, @title) >= @similarityThreshold");
        }

        if (similarityConditions.length > 0) {
            conditions.push(`(${similarityConditions.join(" OR ")})`);
        }

        const query = `
            SELECT
                i.cid,
                json_extract(i.signature, '$.publicKey') as authorPublicKey,
                i.content,
                i.title,
                i.subplebbitAddress,
                i.timestamp,
                jaccard_similarity(i.content, @content) as contentSimilarity,
                jaccard_similarity(i.title, @title) as titleSimilarity
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
            ORDER BY i.timestamp DESC
            LIMIT @limit
        `;

        return this.db.prepare(query).all(queryParams) as Array<{
            cid: string;
            authorPublicKey: string;
            content: string | null;
            title: string | null;
            subplebbitAddress: string;
            timestamp: number;
            contentSimilarity: number;
            titleSimilarity: number;
        }>;
    }

    /**
     * Find exact matching content from indexed comments.
     * Faster than similarity search - used for exact duplicate detection.
     */
    findExactContentFromIndexer(params: {
        content?: string;
        title?: string;
        sinceTimestamp: number;
        authorPublicKey?: string;
        excludeAuthorPublicKey?: string;
        limit?: number;
    }): Array<{
        cid: string;
        authorPublicKey: string;
        content: string | null;
        title: string | null;
        subplebbitAddress: string;
        timestamp: number;
    }> {
        const { content, title, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey, limit = 100 } = params;

        const conditions: string[] = ["i.timestamp >= @sinceTimestamp"];
        const queryParams: Record<string, unknown> = {
            sinceTimestamp,
            limit
        };

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        if (excludeAuthorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') != @excludeAuthorPublicKey");
            queryParams.excludeAuthorPublicKey = excludeAuthorPublicKey;
        }

        // Build content/title matching conditions
        const contentConditions: string[] = [];

        if (content && content.trim().length > 0) {
            contentConditions.push("LOWER(TRIM(i.content)) = LOWER(TRIM(@content))");
            queryParams.content = content;
        }

        if (title && title.trim().length > 0) {
            contentConditions.push("LOWER(TRIM(i.title)) = LOWER(TRIM(@title))");
            queryParams.title = title;
        }

        if (contentConditions.length === 0) {
            return [];
        }

        conditions.push(`(${contentConditions.join(" OR ")})`);

        const query = `
            SELECT
                i.cid,
                json_extract(i.signature, '$.publicKey') as authorPublicKey,
                i.content,
                i.title,
                i.subplebbitAddress,
                i.timestamp
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
            ORDER BY i.timestamp DESC
            LIMIT @limit
        `;

        return this.db.prepare(query).all(queryParams) as Array<{
            cid: string;
            authorPublicKey: string;
            content: string | null;
            title: string | null;
            subplebbitAddress: string;
            timestamp: number;
        }>;
    }

    /**
     * Find links from indexed comments.
     * Used for cross-subplebbit link spam detection.
     */
    findLinksFromIndexer(params: { link: string; sinceTimestamp?: number; authorPublicKey?: string; excludeAuthorPublicKey?: string }): {
        count: number;
        uniqueAuthors: number;
    } {
        const { link, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey } = params;

        const conditions: string[] = ["i.link IS NOT NULL", "LOWER(i.link) = LOWER(@link)"];
        const queryParams: Record<string, unknown> = {
            link
        };

        if (sinceTimestamp !== undefined) {
            conditions.push("i.timestamp >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        if (excludeAuthorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') != @excludeAuthorPublicKey");
            queryParams.excludeAuthorPublicKey = excludeAuthorPublicKey;
        }

        const query = `
            SELECT
                COUNT(*) as count,
                COUNT(DISTINCT json_extract(i.signature, '$.publicKey')) as uniqueAuthors
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
        `;

        const result = this.db.prepare(query).get(queryParams) as { count: number; uniqueAuthors: number };
        return result;
    }

    /**
     * Find similar URLs (matching prefix) from indexed comments.
     * Used for cross-subplebbit similar link spam detection.
     *
     * @param params.urlPrefix - The URL prefix to match (e.g., "spam.com/promo/deal")
     * @param params.sinceTimestamp - Only count links posted after this timestamp (seconds, protocol format)
     * @param params.authorPublicKey - If set, only count links from this author
     * @param params.excludeAuthorPublicKey - If set, exclude this author from results
     */
    findSimilarUrlsFromIndexer(params: {
        urlPrefix: string;
        sinceTimestamp?: number;
        authorPublicKey?: string;
        excludeAuthorPublicKey?: string;
    }): {
        count: number;
        uniqueAuthors: number;
    } {
        const { urlPrefix, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey } = params;

        // Escape special LIKE characters in the prefix
        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        const conditions: string[] = ["i.link IS NOT NULL", "LOWER(i.link) LIKE LOWER(@likePattern) ESCAPE '\\'"];
        const queryParams: Record<string, unknown> = {
            likePattern
        };

        if (sinceTimestamp !== undefined) {
            conditions.push("i.timestamp >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        if (excludeAuthorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') != @excludeAuthorPublicKey");
            queryParams.excludeAuthorPublicKey = excludeAuthorPublicKey;
        }

        const query = `
            SELECT
                COUNT(*) as count,
                COUNT(DISTINCT json_extract(i.signature, '$.publicKey')) as uniqueAuthors
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
        `;

        const result = this.db.prepare(query).get(queryParams) as { count: number; uniqueAuthors: number };
        return result;
    }

    /**
     * Count links to a specific domain from indexed comments.
     */
    countLinkDomainFromIndexer(params: { domain: string; sinceTimestamp?: number; authorPublicKey?: string }): number {
        const { domain, sinceTimestamp, authorPublicKey } = params;

        const conditions: string[] = [
            "i.link IS NOT NULL",
            `(
                LOWER(i.link) LIKE '%://' || LOWER(@domain) || '/%'
                OR LOWER(i.link) LIKE '%://' || LOWER(@domain) || '?%'
                OR LOWER(i.link) LIKE '%://' || LOWER(@domain) || '#%'
                OR LOWER(i.link) LIKE '%://www.' || LOWER(@domain) || '/%'
                OR LOWER(i.link) LIKE '%://www.' || LOWER(@domain) || '?%'
                OR LOWER(i.link) LIKE '%://www.' || LOWER(@domain) || '#%'
                OR LOWER(i.link) = '%://' || LOWER(@domain)
                OR LOWER(i.link) = '%://www.' || LOWER(@domain)
            )`
        ];
        const queryParams: Record<string, unknown> = {
            domain
        };

        if (sinceTimestamp !== undefined) {
            conditions.push("i.timestamp >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        const query = `
            SELECT COUNT(*) as count
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
        `;

        const result = this.db.prepare(query).get(queryParams) as { count: number };
        return result.count;
    }

    /**
     * Find similar URLs from indexed comments and return their publication timestamps.
     * Used for time clustering analysis to detect coordinated spam campaigns.
     *
     * @param params.urlPrefix - The URL prefix to match
     * @param params.sinceTimestamp - Only include posts after this timestamp (seconds, protocol time)
     * @param params.excludeAuthorPublicKey - Optional author to exclude
     * @returns Array of publication timestamps (in seconds, from the protocol)
     */
    findSimilarUrlTimestampsFromIndexer(params: {
        urlPrefix: string;
        sinceTimestamp?: number;
        authorPublicKey?: string;
        excludeAuthorPublicKey?: string;
    }): number[] {
        const { urlPrefix, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey } = params;

        // Escape special LIKE characters in the prefix
        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        const conditions: string[] = ["i.link IS NOT NULL", "LOWER(i.link) LIKE LOWER(@likePattern) ESCAPE '\\'"];
        const queryParams: Record<string, unknown> = {
            likePattern
        };

        if (sinceTimestamp !== undefined) {
            conditions.push("i.timestamp >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        if (authorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') = @authorPublicKey");
            queryParams.authorPublicKey = authorPublicKey;
        }

        if (excludeAuthorPublicKey) {
            conditions.push("json_extract(i.signature, '$.publicKey') != @excludeAuthorPublicKey");
            queryParams.excludeAuthorPublicKey = excludeAuthorPublicKey;
        }

        const query = `
            SELECT i.timestamp
            FROM indexed_comments_ipfs i
            WHERE ${conditions.join(" AND ")}
            ORDER BY i.timestamp
            LIMIT 100
        `;

        const rows = this.db.prepare(query).all(queryParams) as Array<{ timestamp: number }>;
        return rows.map((row) => row.timestamp);
    }
}
