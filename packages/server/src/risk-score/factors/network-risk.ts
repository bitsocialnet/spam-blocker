/**
 * Network-wide risk factors based on indexed data.
 * These factors use data from the indexer to assess author history
 * across multiple subplebbits.
 */

import type { RiskContext, RiskFactor } from "../types.js";
import { getAuthorPublicKeyFromChallengeRequest } from "../utils.js";
import { IndexerQueries } from "../../indexer/db/queries.js";

/**
 * Calculate risk based on network-wide ban history scaled by community breadth.
 *
 * Two additive components, capped at 1.0:
 *
 * 1. Ban severity — sqrt(activeBans / distinctSubs) amplifies even small ban ratios.
 *    If all subs are banned, severity = 1.0.
 * 2. Limited-community trust penalty — starts at 0.4 for 0 clean subs, drops to 0
 *    around 15 clean subs via: max(0, 0.4 - 0.1 * log2(1 + cleanSubs))
 *
 * score = min(1.0, banSeverity + trustPenalty)
 */
// TODO we need to rethink this more, getting a ban or purge is pretty severe, while removed is less so
// also this risk factor should get higher weight I think
export function calculateNetworkBanHistory(ctx: RiskContext, weight: number): RiskFactor {
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(ctx.challengeRequest);

    // Query indexed data for ban history
    const indexerQueries = new IndexerQueries(ctx.db.getDb());
    const stats = indexerQueries.getAuthorNetworkStats(authorPublicKey);

    // Skip factor if user has no posting history - "no bans" is only meaningful
    // if the user has actually participated somewhere and wasn't banned
    if (stats.totalIndexedComments === 0) {
        return {
            name: "networkBanHistory",
            score: 0,
            weight: 0, // Skip - weight redistributed to other factors
            explanation: "No posting history to evaluate bans"
        };
    }

    const activeBans = stats.banCount;
    const distinctSubs = stats.distinctSubplebbitsPostedTo;
    const cleanSubs = Math.max(0, distinctSubs - activeBans);

    // Component 1: Ban severity
    let banSeverity: number;
    if (activeBans === 0) {
        banSeverity = 0;
    } else if (activeBans >= distinctSubs) {
        banSeverity = 1.0;
    } else {
        banSeverity = Math.sqrt(activeBans / distinctSubs);
    }

    // Component 2: Limited-community trust penalty (diminishing returns)
    const trustPenalty = Math.max(0, 0.4 - 0.1 * Math.log2(1 + cleanSubs));

    const score = Math.min(1.0, banSeverity + trustPenalty);

    // Round to 2 decimal places for cleaner output
    const roundedScore = Math.round(score * 100) / 100;

    let explanation: string;
    if (activeBans === 0) {
        explanation = `No active bans across ${distinctSubs} indexed subplebbit${distinctSubs !== 1 ? "s" : ""}`;
    } else {
        explanation = `Banned in ${activeBans}/${distinctSubs} indexed subplebbit${distinctSubs !== 1 ? "s" : ""} (severity=${banSeverity.toFixed(2)}, trustPenalty=${trustPenalty.toFixed(2)})`;
    }

    return {
        name: "networkBanHistory",
        score: roundedScore,
        weight,
        explanation
    };
}

/**
 * Calculate risk based on modqueue rejection rate.
 * Authors whose submissions are frequently rejected are higher risk.
 *
 * Scoring based on rejection rate:
 * - No data: factor skipped (weight redistributed)
 * - 0-10% rejection: 0.1 (very low risk)
 * - 10-30% rejection: 0.3 (low risk)
 * - 30-50% rejection: 0.5 (moderate risk)
 * - 50-70% rejection: 0.7 (elevated risk)
 * - 70%+ rejection: 0.9 (high risk)
 */
export function calculateModqueueRejectionRate(ctx: RiskContext, weight: number): RiskFactor {
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(ctx.challengeRequest);

    // Query indexed data for modqueue stats
    const indexerQueries = new IndexerQueries(ctx.db.getDb());
    const stats = indexerQueries.getAuthorNetworkStats(authorPublicKey);

    const totalResolved = stats.modqueueAccepted + stats.modqueueRejected;

    let score: number;
    let explanation: string;

    if (totalResolved === 0) {
        return {
            name: "modqueueRejectionRate",
            score: 0,
            weight: 0, // Skip - weight redistributed to other factors
            explanation: "No modqueue data available"
        };
    } else {
        const rejectionRate = stats.modqueueRejected / totalResolved;

        if (rejectionRate <= 0.1) {
            score = 0.1;
            explanation = `ModQueue: ${Math.round(rejectionRate * 100)}% rejection rate (${stats.modqueueRejected}/${totalResolved})`;
        } else if (rejectionRate <= 0.3) {
            score = 0.3;
            explanation = `ModQueue: ${Math.round(rejectionRate * 100)}% rejection rate (${stats.modqueueRejected}/${totalResolved})`;
        } else if (rejectionRate <= 0.5) {
            score = 0.5;
            explanation = `ModQueue: ${Math.round(rejectionRate * 100)}% rejection rate (${stats.modqueueRejected}/${totalResolved})`;
        } else if (rejectionRate <= 0.7) {
            score = 0.7;
            explanation = `ModQueue: ${Math.round(rejectionRate * 100)}% rejection rate - elevated risk (${stats.modqueueRejected}/${totalResolved})`;
        } else {
            score = 0.9;
            explanation = `ModQueue: ${Math.round(rejectionRate * 100)}% rejection rate - high risk (${stats.modqueueRejected}/${totalResolved})`;
        }
    }

    return {
        name: "modqueueRejectionRate",
        score,
        weight,
        explanation
    };
}

/**
 * Calculate risk based on network-wide removal rate.
 * Authors whose content is frequently removed by moderators are higher risk.
 *
 * Scoring based on removal rate:
 * - No data: factor skipped (weight redistributed)
 * - 0-5% removal: 0.1 (very low risk)
 * - 5-15% removal: 0.3 (low risk)
 * - 15-30% removal: 0.5 (moderate risk)
 * - 30-50% removal: 0.7 (elevated risk)
 * - 50%+ removal: 0.9 (high risk)
 */
export function calculateNetworkRemovalRate(ctx: RiskContext, weight: number): RiskFactor {
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(ctx.challengeRequest);

    // Query indexed data for removal stats
    const indexerQueries = new IndexerQueries(ctx.db.getDb());
    const stats = indexerQueries.getAuthorNetworkStats(authorPublicKey);

    const totalComments = stats.totalIndexedComments;
    const removedCount = stats.removalCount + stats.disapprovalCount + stats.unfetchableCount;

    let score: number;
    let explanation: string;

    if (totalComments === 0) {
        return {
            name: "networkRemovalRate",
            score: 0,
            weight: 0, // Skip - weight redistributed to other factors
            explanation: "No indexed comments for this author"
        };
    } else {
        const removalRate = removedCount / totalComments;

        if (removalRate <= 0.05) {
            score = 0.1;
            explanation = `Network removal rate: ${Math.round(removalRate * 100)}% (${removedCount}/${totalComments} comments)`;
        } else if (removalRate <= 0.15) {
            score = 0.3;
            explanation = `Network removal rate: ${Math.round(removalRate * 100)}% (${removedCount}/${totalComments} comments)`;
        } else if (removalRate <= 0.3) {
            score = 0.5;
            explanation = `Network removal rate: ${Math.round(removalRate * 100)}% (${removedCount}/${totalComments} comments)`;
        } else if (removalRate <= 0.5) {
            score = 0.7;
            explanation = `Network removal rate: ${Math.round(removalRate * 100)}% - elevated risk (${removedCount}/${totalComments} comments)`;
        } else {
            score = 0.9;
            explanation = `Network removal rate: ${Math.round(removalRate * 100)}% - high risk (${removedCount}/${totalComments} comments)`;
        }
    }

    return {
        name: "networkRemovalRate",
        score,
        weight,
        explanation
    };
}
