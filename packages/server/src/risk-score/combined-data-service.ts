/**
 * CombinedDataService - Queries both engine and indexer tables for risk factor calculations.
 *
 * Each factor has its own combination strategy:
 * - Account Age: Use ONLY indexer's fetchedAt (only counts accepted publications)
 * - Karma: Per-subplebbit, use the LATEST entry from either source
 * - Velocity: Combine counts from both sources (SUM)
 * - Content/Link Similarity: Query both sources (UNION)
 */

import type { SpamDetectionDatabase } from "../db/index.js";
import { IndexerQueries } from "../indexer/db/queries.js";

/**
 * Karma record with timestamp for recency comparison.
 */
export interface KarmaRecord {
    postScore: number;
    replyScore: number;
}

/**
 * Similar content match from either source.
 */
export interface SimilarContentMatch {
    /** Unique identifier - sessionId for engine, cid for indexer */
    id: string;
    /** Source of this match */
    source: "engine" | "indexer";
    authorPublicKey: string;
    content: string | null;
    title: string | null;
    subplebbitAddress: string;
    timestamp: number;
    contentSimilarity: number;
    titleSimilarity: number;
}

/**
 * Service that queries both engine and indexer databases for risk factor calculations.
 * Implements factor-specific combination strategies.
 */
export class CombinedDataService {
    private indexerQueries: IndexerQueries;

    constructor(private db: SpamDetectionDatabase) {
        this.indexerQueries = new IndexerQueries(db.getDb());
    }

    // ============================================
    // Account Age: Use the OLDEST timestamp (MIN)
    // ============================================

    /**
     * Get the earliest timestamp for an author from the indexer.
     * Returns the timestamp in **seconds** for compatibility with protocol timestamps.
     *
     * SECURITY: Only uses indexer's fetchedAt, NOT engine's receivedAt.
     * This ensures we only count comments that the subplebbit actually included in its pages.
     * A spammer who keeps submitting rejected spam should not get "old account" credit
     * just because our engine saw their failed attempts.
     */
    getAuthorEarliestTimestamp(authorPublicKey: string): number | undefined {
        return this.indexerQueries.getAuthorFirstIndexedTimestamp(authorPublicKey);
    }

    // ============================================
    // Karma: Per-subplebbit, use the LATEST entry
    // ============================================

    /**
     * Get karma per subplebbit, using the most recent data from either source.
     * For each subplebbit, if both sources have data, use the one with the more recent timestamp.
     */
    getAuthorKarmaBySubplebbit(authorPublicKey: string): Map<string, KarmaRecord> {
        const engineKarma = this.db.getAuthorKarmaBySubplebbit(authorPublicKey);
        const indexerKarma = this.indexerQueries.getAuthorKarmaBySubplebbitFromIndexer(authorPublicKey);

        const result = new Map<string, KarmaRecord>();

        // Collect all subplebbit addresses from both sources
        const allSubs = new Set([...engineKarma.keys(), ...indexerKarma.keys()]);

        for (const sub of allSubs) {
            const engine = engineKarma.get(sub);
            const indexer = indexerKarma.get(sub);

            if (engine && indexer) {
                // Both sources have data - use the one with higher updatedAt
                // Engine uses receivedAt (milliseconds), indexer uses updatedAt (seconds)
                // Convert engine receivedAt from milliseconds to seconds for comparison
                const engineReceivedAtSec = Math.floor(engine.receivedAt / 1000);
                if (engineReceivedAtSec >= indexer.updatedAt) {
                    result.set(sub, { postScore: engine.postScore, replyScore: engine.replyScore });
                } else {
                    result.set(sub, { postScore: indexer.postScore, replyScore: indexer.replyScore });
                }
            } else if (engine) {
                result.set(sub, { postScore: engine.postScore, replyScore: engine.replyScore });
            } else if (indexer) {
                result.set(sub, { postScore: indexer.postScore, replyScore: indexer.replyScore });
            }
        }

        return result;
    }

    // ============================================
    // Velocity: Combine counts from both sources (SUM)
    // ============================================

    /**
     * Get velocity stats combining both engine and indexer data.
     * The total posting rate across both sources indicates overall activity.
     *
     * Note: Indexer only tracks posts and replies. Votes, edits, and moderations
     * are only available from engine data.
     */
    getAuthorVelocityStats(
        authorPublicKey: string,
        publicationType: "post" | "reply" | "vote" | "commentEdit" | "commentModeration"
    ): { lastHour: number; last24Hours: number } {
        const engineStats = this.db.getAuthorVelocityStats(authorPublicKey, publicationType);

        // Indexer only tracks posts and replies (comments)
        if (publicationType === "post" || publicationType === "reply") {
            const indexerStats = this.indexerQueries.getAuthorVelocityFromIndexer(authorPublicKey, publicationType);
            return {
                lastHour: engineStats.lastHour + indexerStats.lastHour,
                last24Hours: engineStats.last24Hours + indexerStats.last24Hours
            };
        }

        // For votes, edits, moderations - indexer doesn't track these
        return engineStats;
    }

    /**
     * Get aggregate velocity stats across ALL publication types from both sources.
     */
    getAuthorAggregateVelocityStats(authorPublicKey: string): { lastHour: number; last24Hours: number } {
        const types: Array<"post" | "reply" | "vote" | "commentEdit" | "commentModeration"> = [
            "post",
            "reply",
            "vote",
            "commentEdit",
            "commentModeration"
        ];

        let lastHour = 0;
        let last24Hours = 0;

        for (const type of types) {
            const stats = this.getAuthorVelocityStats(authorPublicKey, type);
            lastHour += stats.lastHour;
            last24Hours += stats.last24Hours;
        }

        return { lastHour, last24Hours };
    }

    // ============================================
    // Content Similarity: Query both sources (UNION)
    // ============================================

    /**
     * Find exact matching content from both sources.
     * Used for detecting duplicate spam.
     *
     * @param params.sinceTimestamp - Time window in seconds (for protocol compatibility)
     */
    findExactContent(params: {
        content?: string;
        title?: string;
        sinceTimestamp: number;
        authorPublicKey?: string;
        excludeAuthorPublicKey?: string;
        limit?: number;
    }): Array<SimilarContentMatch> {
        const { content, title, sinceTimestamp, authorPublicKey, excludeAuthorPublicKey, limit = 50 } = params;

        const results: SimilarContentMatch[] = [];

        // Convert sinceTimestamp from seconds to milliseconds for engine queries
        const sinceTimestampMs = sinceTimestamp * 1000;

        // Query engine (uses sessionId as identifier)
        if (authorPublicKey) {
            // Same author - exact matches
            const engineMatches = this.db.findSimilarComments({
                content,
                title,
                sinceTimestamp: sinceTimestampMs,
                limit
            });
            // Filter to same author
            for (const match of engineMatches) {
                if (match.authorPublicKey === authorPublicKey) {
                    results.push({
                        id: match.sessionId,
                        source: "engine",
                        authorPublicKey: match.authorPublicKey,
                        content: match.content,
                        title: match.title,
                        subplebbitAddress: match.subplebbitAddress,
                        timestamp: Math.floor(match.receivedAt / 1000), // Convert to seconds for consistency
                        contentSimilarity: 1.0,
                        titleSimilarity: 1.0
                    });
                }
            }
        } else if (excludeAuthorPublicKey) {
            // Other authors - exact matches
            const engineMatches = this.db.findSimilarComments({
                content,
                title,
                sinceTimestamp: sinceTimestampMs,
                limit
            });
            // Filter to other authors
            for (const match of engineMatches) {
                if (match.authorPublicKey !== excludeAuthorPublicKey) {
                    results.push({
                        id: match.sessionId,
                        source: "engine",
                        authorPublicKey: match.authorPublicKey,
                        content: match.content,
                        title: match.title,
                        subplebbitAddress: match.subplebbitAddress,
                        timestamp: Math.floor(match.receivedAt / 1000), // Convert to seconds for consistency
                        contentSimilarity: 1.0,
                        titleSimilarity: 1.0
                    });
                }
            }
        }

        // Query indexer (uses cid as identifier) - sinceTimestamp is in seconds (protocol)
        const indexerMatches = this.indexerQueries.findExactContentFromIndexer({
            content,
            title,
            sinceTimestamp,
            authorPublicKey,
            excludeAuthorPublicKey,
            limit
        });

        for (const match of indexerMatches) {
            results.push({
                id: match.cid,
                source: "indexer",
                authorPublicKey: match.authorPublicKey,
                content: match.content,
                title: match.title,
                subplebbitAddress: match.subplebbitAddress,
                timestamp: match.timestamp,
                contentSimilarity: 1.0,
                titleSimilarity: 1.0
            });
        }

        // Sort by timestamp descending and limit
        results.sort((a, b) => b.timestamp - a.timestamp);
        return results.slice(0, limit);
    }

    /**
     * Find similar content by the same author from both sources.
     * Used for detecting self-spamming with variations.
     *
     * @param params.sinceTimestamp - Time window in seconds (for protocol compatibility)
     */
    findSimilarContentByAuthor(params: {
        authorPublicKey: string;
        content?: string;
        title?: string;
        sinceTimestamp: number;
        similarityThreshold?: number;
        limit?: number;
    }): Array<SimilarContentMatch> {
        const { authorPublicKey, content, title, sinceTimestamp, similarityThreshold = 0.6, limit = 100 } = params;

        const results: SimilarContentMatch[] = [];

        // Convert sinceTimestamp from seconds to milliseconds for engine queries
        const sinceTimestampMs = sinceTimestamp * 1000;

        // Query engine
        const engineMatches = this.db.findSimilarContentByAuthor({
            authorPublicKey,
            content,
            title,
            sinceTimestamp: sinceTimestampMs,
            similarityThreshold,
            limit
        });

        for (const match of engineMatches) {
            results.push({
                id: match.sessionId,
                source: "engine",
                authorPublicKey,
                content: match.content,
                title: match.title,
                subplebbitAddress: match.subplebbitAddress,
                timestamp: Math.floor(match.receivedAt / 1000), // Convert to seconds for consistency
                contentSimilarity: match.contentSimilarity,
                titleSimilarity: match.titleSimilarity
            });
        }

        // Query indexer - sinceTimestamp is in seconds (protocol)
        const indexerMatches = this.indexerQueries.findSimilarContentFromIndexer({
            authorPublicKey,
            content,
            title,
            sinceTimestamp,
            similarityThreshold,
            limit
        });

        for (const match of indexerMatches) {
            results.push({
                id: match.cid,
                source: "indexer",
                authorPublicKey: match.authorPublicKey,
                content: match.content,
                title: match.title,
                subplebbitAddress: match.subplebbitAddress,
                timestamp: match.timestamp,
                contentSimilarity: match.contentSimilarity,
                titleSimilarity: match.titleSimilarity
            });
        }

        // Sort by timestamp descending and limit
        results.sort((a, b) => b.timestamp - a.timestamp);
        return results.slice(0, limit);
    }

    /**
     * Find similar content by other authors from both sources.
     * Used for detecting coordinated spam campaigns.
     *
     * @param params.sinceTimestamp - Time window in seconds (for protocol compatibility)
     */
    findSimilarContentByOthers(params: {
        excludeAuthorPublicKey: string;
        content?: string;
        title?: string;
        sinceTimestamp: number;
        similarityThreshold?: number;
        limit?: number;
    }): Array<SimilarContentMatch> {
        const { excludeAuthorPublicKey, content, title, sinceTimestamp, similarityThreshold = 0.6, limit = 100 } = params;

        const results: SimilarContentMatch[] = [];

        // Convert sinceTimestamp from seconds to milliseconds for engine queries
        const sinceTimestampMs = sinceTimestamp * 1000;

        // Query engine
        const engineMatches = this.db.findSimilarContentByOthers({
            authorPublicKey: excludeAuthorPublicKey,
            content,
            title,
            sinceTimestamp: sinceTimestampMs,
            similarityThreshold,
            limit
        });

        for (const match of engineMatches) {
            results.push({
                id: match.sessionId,
                source: "engine",
                authorPublicKey: match.authorPublicKey,
                content: match.content,
                title: match.title,
                subplebbitAddress: match.subplebbitAddress,
                timestamp: Math.floor(match.receivedAt / 1000), // Convert to seconds for consistency
                contentSimilarity: match.contentSimilarity,
                titleSimilarity: match.titleSimilarity
            });
        }

        // Query indexer - sinceTimestamp is in seconds (protocol)
        const indexerMatches = this.indexerQueries.findSimilarContentFromIndexer({
            excludeAuthorPublicKey,
            content,
            title,
            sinceTimestamp,
            similarityThreshold,
            limit
        });

        for (const match of indexerMatches) {
            results.push({
                id: match.cid,
                source: "indexer",
                authorPublicKey: match.authorPublicKey,
                content: match.content,
                title: match.title,
                subplebbitAddress: match.subplebbitAddress,
                timestamp: match.timestamp,
                contentSimilarity: match.contentSimilarity,
                titleSimilarity: match.titleSimilarity
            });
        }

        // Sort by timestamp descending and limit
        results.sort((a, b) => b.timestamp - a.timestamp);
        return results.slice(0, limit);
    }

    // ============================================
    // Link Detection: Query both sources (UNION)
    // ============================================

    /**
     * Find links posted by a specific author from both sources.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    findLinksByAuthor(params: { authorPublicKey: string; link: string; sinceTimestamp?: number }): number {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineCount = this.db.findLinksByAuthor({
            authorPublicKey: params.authorPublicKey,
            link: params.link,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });
        // Indexer uses seconds (protocol timestamp)
        const indexerResult = this.indexerQueries.findLinksFromIndexer({
            link: params.link,
            sinceTimestamp: params.sinceTimestamp,
            authorPublicKey: params.authorPublicKey
        });

        return engineCount + indexerResult.count;
    }

    /**
     * Find links posted by other authors from both sources.
     * Returns total count and unique authors across both sources.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    findLinksByOthers(params: { excludeAuthorPublicKey: string; link: string; sinceTimestamp?: number }): {
        count: number;
        uniqueAuthors: number;
    } {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineResult = this.db.findLinksByOthers({
            authorPublicKey: params.excludeAuthorPublicKey,
            link: params.link,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });
        // Indexer uses seconds (protocol timestamp)
        const indexerResult = this.indexerQueries.findLinksFromIndexer({
            link: params.link,
            sinceTimestamp: params.sinceTimestamp,
            excludeAuthorPublicKey: params.excludeAuthorPublicKey
        });

        // Note: uniqueAuthors might be slightly inaccurate if the same author
        // appears in both sources. For a more accurate count, we'd need to
        // query and deduplicate, but this approximation is good enough for risk scoring.
        return {
            count: engineResult.count + indexerResult.count,
            uniqueAuthors: engineResult.uniqueAuthors + indexerResult.uniqueAuthors
        };
    }

    /**
     * Count links to a specific domain by an author from both sources.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    countLinkDomainByAuthor(params: { authorPublicKey: string; domain: string; sinceTimestamp?: number }): number {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineCount = this.db.countLinkDomainByAuthor({
            authorPublicKey: params.authorPublicKey,
            domain: params.domain,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });
        // Indexer uses seconds (protocol timestamp)
        const indexerCount = this.indexerQueries.countLinkDomainFromIndexer({
            domain: params.domain,
            sinceTimestamp: params.sinceTimestamp,
            authorPublicKey: params.authorPublicKey
        });

        return engineCount + indexerCount;
    }

    // ============================================
    // Similar URL Detection: Query both sources (UNION)
    // ============================================

    /**
     * Find similar URLs (matching prefix) from the same author across both sources.
     * Used to detect link spam with URL variations.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    findSimilarUrlsByAuthor(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineCount = this.db.findSimilarUrlsByAuthor({
            authorPublicKey: params.authorPublicKey,
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });
        // Indexer uses seconds (protocol timestamp)
        const indexerResult = this.indexerQueries.findSimilarUrlsFromIndexer({
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp,
            authorPublicKey: params.authorPublicKey
        });

        return engineCount + indexerResult.count;
    }

    /**
     * Find similar URLs (matching prefix) from other authors across both sources.
     * Used to detect coordinated link spam with URL variations.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    findSimilarUrlsByOthers(params: { excludeAuthorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): {
        count: number;
        uniqueAuthors: number;
    } {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineResult = this.db.findSimilarUrlsByOthers({
            authorPublicKey: params.excludeAuthorPublicKey,
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });
        // Indexer uses seconds (protocol timestamp)
        const indexerResult = this.indexerQueries.findSimilarUrlsFromIndexer({
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp,
            excludeAuthorPublicKey: params.excludeAuthorPublicKey
        });

        // Note: uniqueAuthors might be slightly inaccurate if the same author
        // appears in both sources. For a more accurate count, we'd need to
        // query and deduplicate, but this approximation is good enough for risk scoring.
        return {
            count: engineResult.count + indexerResult.count,
            uniqueAuthors: engineResult.uniqueAuthors + indexerResult.uniqueAuthors
        };
    }

    /**
     * Get timestamps of similar URLs from the same author across both sources.
     * Used for time clustering analysis to detect rapid-fire URL spam.
     * Combines engine + indexer timestamps, deduplicates, and returns sorted array.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    getSimilarUrlTimestampsByAuthor(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number[] {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineTimestamps = this.db.findSimilarUrlTimestampsByAuthor({
            authorPublicKey: params.authorPublicKey,
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });

        // Indexer uses seconds (protocol timestamp)
        const indexerTimestamps = this.indexerQueries.findSimilarUrlTimestampsFromIndexer({
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp,
            authorPublicKey: params.authorPublicKey
        });

        // Combine, deduplicate, and sort
        const allTimestamps = [...new Set([...engineTimestamps, ...indexerTimestamps])];
        allTimestamps.sort((a, b) => a - b);

        return allTimestamps;
    }

    /**
     * Get timestamps of similar URLs from other authors across both sources.
     * Used for time clustering analysis to detect coordinated spam campaigns.
     * Combines engine + indexer timestamps, deduplicates, and returns sorted array.
     *
     * @param params.sinceTimestamp - Optional time window in seconds (for protocol compatibility)
     */
    getSimilarUrlTimestampsByOthers(params: { excludeAuthorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number[] {
        // Convert sinceTimestamp from seconds to milliseconds for engine queries (if provided)
        const engineTimestamps = this.db.findSimilarUrlTimestampsByOthers({
            authorPublicKey: params.excludeAuthorPublicKey,
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp !== undefined ? params.sinceTimestamp * 1000 : undefined
        });

        // Indexer uses seconds (protocol timestamp)
        const indexerTimestamps = this.indexerQueries.findSimilarUrlTimestampsFromIndexer({
            urlPrefix: params.urlPrefix,
            sinceTimestamp: params.sinceTimestamp,
            excludeAuthorPublicKey: params.excludeAuthorPublicKey
        });

        // Combine, deduplicate, and sort
        const allTimestamps = [...new Set([...engineTimestamps, ...indexerTimestamps])];
        allTimestamps.sort((a, b) => a - b);

        return allTimestamps;
    }
}
