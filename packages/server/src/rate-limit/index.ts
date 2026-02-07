/**
 * Dynamic Publication Rate Limiting
 *
 * Hard rate limits that reject publications outright when an author exceeds
 * their budget. Budgets are dynamic based on author reputation (account age
 * + network stats) so established users get higher limits.
 *
 * This is a pre-check that runs before risk scoring. It uses engine DB only
 * (not combined/indexed data) since we want to count publications that came
 * through our evaluate endpoint.
 */

import type { SpamDetectionDatabase } from "../db/index.js";
import { IndexerQueries } from "../indexer/db/queries.js";
import { CombinedDataService } from "../risk-score/combined-data-service.js";
import type { PublicationType } from "../risk-score/utils.js";

// ============================================================================
// Types
// ============================================================================

export interface RateLimitPerType {
    hourly: number;
    daily: number;
}

export interface RateLimitConfig {
    /** Base rate limits per publication type (at multiplier 1.0) */
    limits?: Partial<Record<Exclude<PublicationType, "subplebbitEdit">, RateLimitPerType>>;
    /** Aggregate rate limits across all types */
    aggregate?: RateLimitPerType;
}

export interface RateLimitResult {
    allowed: boolean;
    exceeded?: string;
    limit?: number;
    current?: number;
    multiplier?: number;
}

// ============================================================================
// Defaults
// ============================================================================

type RateLimitableType = Exclude<PublicationType, "subplebbitEdit">;

export const DEFAULT_RATE_LIMITS: Record<RateLimitableType, RateLimitPerType> = {
    post: { hourly: 4, daily: 20 },
    reply: { hourly: 6, daily: 60 },
    vote: { hourly: 10, daily: 200 },
    commentEdit: { hourly: 5, daily: 30 },
    commentModeration: { hourly: 10, daily: 60 }
};

export const DEFAULT_AGGREGATE_LIMITS: RateLimitPerType = {
    hourly: 40,
    daily: 250
};

// ============================================================================
// Budget Multiplier
// ============================================================================

/**
 * Compute a dynamic budget multiplier for an author based on their reputation.
 *
 * multiplier = ageFactor × reputationFactor, clamped to [0.25, 5.0]
 *
 * Uses indexer data (CombinedDataService) for account age and network stats.
 */
export function computeBudgetMultiplier({ authorPublicKey, db }: { authorPublicKey: string; db: SpamDetectionDatabase }): number {
    const combinedData = new CombinedDataService(db);
    const indexerQueries = new IndexerQueries(db.getDb());

    // --- Age Factor ---
    const earliestTimestamp = combinedData.getAuthorEarliestTimestamp(authorPublicKey);
    let ageFactor: number;

    if (earliestTimestamp === undefined) {
        // No indexed history at all
        ageFactor = 0.5;
    } else {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const ageDays = (nowSeconds - earliestTimestamp) / 86400;

        if (ageDays < 1) {
            ageFactor = 0.5;
        } else if (ageDays < 7) {
            ageFactor = 0.75;
        } else if (ageDays < 30) {
            ageFactor = 1.0;
        } else if (ageDays < 90) {
            ageFactor = 1.5;
        } else if (ageDays < 365) {
            ageFactor = 2.0;
        } else {
            ageFactor = 3.0;
        }
    }

    // --- Reputation Factor ---
    const stats = indexerQueries.getAuthorNetworkStats(authorPublicKey);
    let reputationFactor: number;

    if (stats.banCount > 0) {
        reputationFactor = 0.5;
    } else if (stats.totalIndexedComments > 0) {
        const weightedRemovedCount =
            stats.purgedCount * 1.5 + stats.removalCount * 1.0 + stats.disapprovalCount * 1.0 + stats.unfetchableCount * 0.5;
        const removalRate = weightedRemovedCount / stats.totalIndexedComments;

        if (removalRate > 0.3) {
            reputationFactor = 0.5;
        } else if (removalRate > 0.15) {
            reputationFactor = 0.75;
        } else if (removalRate < 0.05 && stats.totalIndexedComments > 10) {
            reputationFactor = 1.25;
        } else {
            reputationFactor = 1.0;
        }
    } else {
        // No indexed history
        reputationFactor = 1.0;
    }

    const multiplier = ageFactor * reputationFactor;
    return Math.max(0.25, Math.min(5.0, multiplier));
}

// ============================================================================
// Rate Limit Check
// ============================================================================

/**
 * Check whether an author is within their rate limit budget.
 *
 * Check order: per-type hourly → per-type daily → aggregate hourly → aggregate daily.
 * First failure = reject.
 *
 * Uses engine DB only for counting publications (not indexed data).
 */
export function checkRateLimit({
    authorPublicKey,
    publicationType,
    db,
    config
}: {
    authorPublicKey: string;
    publicationType: PublicationType;
    db: SpamDetectionDatabase;
    config: RateLimitConfig;
}): RateLimitResult {
    // subplebbitEdit is never rate limited
    if (publicationType === "subplebbitEdit") {
        return { allowed: true };
    }

    const rateLimitableType = publicationType as RateLimitableType;
    const multiplier = computeBudgetMultiplier({ authorPublicKey, db });

    // Resolve per-type limits (merge config overrides with defaults)
    const baseLimits = config.limits?.[rateLimitableType] ?? DEFAULT_RATE_LIMITS[rateLimitableType];
    const baseAggregate = config.aggregate ?? DEFAULT_AGGREGATE_LIMITS;

    const effectiveHourly = Math.max(1, Math.floor(baseLimits.hourly * multiplier));
    const effectiveDaily = Math.max(1, Math.floor(baseLimits.daily * multiplier));
    const effectiveAggHourly = Math.max(1, Math.floor(baseAggregate.hourly * multiplier));
    const effectiveAggDaily = Math.max(1, Math.floor(baseAggregate.daily * multiplier));

    // Get current velocity from engine DB only
    const typeStats = db.getAuthorVelocityStats(authorPublicKey, rateLimitableType);
    const aggStats = db.getAuthorAggregateVelocityStats(authorPublicKey);

    // Check order: per-type hourly → per-type daily → aggregate hourly → aggregate daily
    if (typeStats.lastHour >= effectiveHourly) {
        return {
            allowed: false,
            exceeded: `${rateLimitableType} hourly`,
            limit: effectiveHourly,
            current: typeStats.lastHour,
            multiplier
        };
    }

    if (typeStats.last24Hours >= effectiveDaily) {
        return {
            allowed: false,
            exceeded: `${rateLimitableType} daily`,
            limit: effectiveDaily,
            current: typeStats.last24Hours,
            multiplier
        };
    }

    if (aggStats.lastHour >= effectiveAggHourly) {
        return {
            allowed: false,
            exceeded: "aggregate hourly",
            limit: effectiveAggHourly,
            current: aggStats.lastHour,
            multiplier
        };
    }

    if (aggStats.last24Hours >= effectiveAggDaily) {
        return {
            allowed: false,
            exceeded: "aggregate daily",
            limit: effectiveAggDaily,
            current: aggStats.last24Hours,
            multiplier
        };
    }

    return { allowed: true, multiplier };
}
