import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type { SpamDetectionDatabase } from "../db/index.js";
import type { RiskContext, RiskFactor, RiskFactorName, RiskScoreResult, WeightConfig } from "./types.js";
import { WEIGHTS_NO_IP, WEIGHTS_WITH_IP } from "./types.js";
import { CombinedDataService } from "./combined-data-service.js";
import {
    calculateAccountAge,
    calculateCommentContentTitleRisk,
    calculateCommentUrlRisk,
    calculateIpRisk,
    calculateKarma,
    calculateVelocity,
    calculateNetworkBanHistory,
    calculateModqueueRejectionRate,
    calculateNetworkRemovalRate,
    calculateSocialVerification,
    calculateWalletActivity,
    type IpIntelligence
} from "./factors/index.js";

export * from "./types.js";
export * from "./factors/index.js";

/**
 * Options for risk score calculation.
 */
export interface CalculateRiskScoreOptions {
    /** The full decrypted challenge request being evaluated */
    challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
    /** Database access for querying historical data */
    db: SpamDetectionDatabase;
    /** Optional IP intelligence data (if available from iframe access) */
    ipIntelligence?: IpIntelligence;
    /** Custom weight configuration (defaults based on IP availability) */
    weights?: WeightConfig;
    /** Current Unix timestamp in seconds (defaults to now) */
    now?: number;
    /** List of enabled OAuth providers (e.g., ["google", "github"]). Empty array disables social verification factor. */
    enabledOAuthProviders?: string[];
    /** Pre-fetched wallet transaction counts (nonces) mapping wallet address (lowercased) to nonce */
    walletTransactionCounts?: Record<string, number>;
    /** List of risk factor names to disable (their weight is zeroed out and redistributed) */
    disabledRiskFactors?: RiskFactorName[];
}

/**
 * Calculate the overall risk score for a challenge request.
 *
 * The risk score is a weighted combination of multiple factors:
 * - Account Age: How long the author has been active
 * - Karma Score: Author's accumulated karma (postScore + replyScore)
 * - Content Risk: Analysis of suspicious patterns in content
 * - Velocity Risk: How frequently the author is publishing
 * - IP Risk: Analysis of IP type (VPN, Tor, proxy, datacenter)
 * - Network Ban History: How many subs the author has been banned from
 * - ModQueue Rejection Rate: What percentage of modQueue submissions get rejected
 * - Network Removal Rate: What percentage of comments get removed across all subs
 * - Social Verification: OAuth identity verification
 * - Wallet Activity: On-chain transaction history for verified wallets
 *
 * When IP information is available, weights are redistributed to include
 * IP risk analysis. Without IP info, the other factors receive higher weights.
 *
 * @returns RiskScoreResult with the final score, factor breakdown, and explanation
 */
export function calculateRiskScore(options: CalculateRiskScoreOptions): RiskScoreResult {
    const { challengeRequest, db, ipIntelligence, walletTransactionCounts } = options;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const hasIpInfo = ipIntelligence !== undefined;
    const enabledOAuthProviders = options.enabledOAuthProviders ?? [];

    // Select weight configuration based on IP availability
    const baseWeights = options.weights ?? (hasIpInfo ? WEIGHTS_WITH_IP : WEIGHTS_NO_IP);

    // Zero out disabled factors and let the existing redistribution logic handle the rest
    const disabledRiskFactors = options.disabledRiskFactors ?? [];
    const weights: WeightConfig = { ...baseWeights };
    for (const name of disabledRiskFactors) {
        weights[name] = 0;
    }

    // Create combined data service for querying both engine and indexer tables
    const combinedData = new CombinedDataService(db);

    // Create context for factor calculators
    const ctx: RiskContext = {
        challengeRequest,
        now,
        hasIpInfo,
        db,
        combinedData
    };

    // Calculate all factors
    const factors: RiskFactor[] = [
        calculateAccountAge(ctx, weights.accountAge),
        calculateKarma(ctx, weights.karmaScore),
        calculateCommentContentTitleRisk(ctx, weights.commentContentTitleRisk),
        calculateCommentUrlRisk(ctx, weights.commentUrlRisk),
        calculateVelocity(ctx, weights.velocityRisk),
        calculateIpRisk(ipIntelligence, weights.ipRisk),
        calculateNetworkBanHistory(ctx, weights.networkBanHistory),
        calculateModqueueRejectionRate(ctx, weights.modqueueRejectionRate),
        calculateNetworkRemovalRate(ctx, weights.networkRemovalRate),
        calculateSocialVerification(ctx, weights.socialVerification, enabledOAuthProviders),
        calculateWalletActivity({ ctx, weight: weights.walletVerification, walletTransactionCounts })
    ];

    // Calculate total active weight for redistribution
    const totalActiveWeight = factors.reduce((sum, f) => sum + (f.weight > 0 ? f.weight : 0), 0);

    // Calculate effective weights (proportional redistribution)
    // When a factor is skipped (weight=0), its weight is redistributed proportionally
    // to the remaining active factors, so effectiveWeight values always sum to 1.0
    for (const factor of factors) {
        factor.effectiveWeight = totalActiveWeight > 0 && factor.weight > 0 ? factor.weight / totalActiveWeight : 0;
    }

    // Calculate weighted sum using effective weights
    let weightedSum = 0;
    for (const factor of factors) {
        weightedSum += factor.score * (factor.effectiveWeight ?? 0);
    }

    // finalScore is already normalized since effectiveWeights sum to 1
    const finalScore = totalActiveWeight > 0 ? weightedSum : 0.5;

    // Clamp to [0, 1] for safety
    const clampedScore = Math.max(0, Math.min(1, finalScore));

    // Generate explanation
    const explanation = generateExplanation(clampedScore, factors);

    return {
        score: clampedScore,
        factors,
        explanation
    };
}

/**
 * Generate a human-readable explanation for the risk score.
 */
function generateExplanation(score: number, factors: RiskFactor[]): string {
    // Get the top contributing factors (highest weighted scores)
    const significantFactors = factors
        .filter((f) => f.weight > 0)
        .sort((a, b) => b.score * b.weight - a.score * a.weight)
        .slice(0, 3);

    const riskLevel = score < 0.3 ? "Low" : score < 0.7 ? "Moderate" : "High";

    const factorSummaries = significantFactors.map((f) => `${f.name}: ${(f.score * 100).toFixed(0)}%`).join(", ");

    return `${riskLevel} risk (${(score * 100).toFixed(0)}%). Key factors: ${factorSummaries}`;
}
