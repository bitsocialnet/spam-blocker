import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type { SpamDetectionDatabase } from "../db/index.js";
import type { CombinedDataService } from "./combined-data-service.js";

/**
 * Individual risk factor result returned by factor functions.
 */
export interface RiskFactor {
    /** Name of the risk factor */
    name: string;
    /** Raw score for this factor (0.0 to 1.0, where 1.0 is highest risk) */
    score: number;
    /** Original weight assigned to this factor (0.0 to 1.0). May be 0 if factor is skipped. */
    weight: number;
    /** Effective weight after proportional redistribution from skipped factors (0.0 to 1.0).
     * Calculated centrally in calculateRiskScore() - always sums to 1.0 across all factors.
     * Optional because factor functions don't set this - it's computed after all factors are collected. */
    effectiveWeight?: number;
    /** Human-readable explanation for this factor's score */
    explanation: string;
}

/**
 * Complete risk score result with breakdown.
 */
export interface RiskScoreResult {
    /** Final weighted risk score (0.0 to 1.0) */
    score: number;
    /** Individual factor breakdowns */
    factors: RiskFactor[];
    /** Human-readable summary explanation */
    explanation: string;
}

/**
 * Context provided to risk factor calculators.
 */
export interface RiskContext {
    /** The full decrypted challenge request being evaluated */
    challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
    /** Current Unix timestamp in seconds */
    now: number;
    /** Whether IP information is available (affects weight distribution) */
    hasIpInfo: boolean;
    /** Database access for querying historical data */
    db: SpamDetectionDatabase;
    /** Combined data service for querying both engine and indexer tables */
    combinedData: CombinedDataService;
}

/**
 * Weight configuration for risk factors.
 * Two configurations: with and without IP info.
 */
export interface WeightConfig {
    commentContentTitleRisk: number;
    commentUrlRisk: number;
    velocityRisk: number;
    accountAge: number;
    karmaScore: number;
    ipRisk: number;
    /** Network-wide ban history from indexed data */
    networkBanHistory: number;
    /** ModQueue rejection rate from indexed data */
    modqueueRejectionRate: number;
    /** Network-wide removal rate from indexed data */
    networkRemovalRate: number;
    /** Social verification via OAuth (trust signal when verified) */
    socialVerification: number;
    /** Wallet activity verification via on-chain transaction count */
    walletVerification: number;
}

/**
 * Default weights when IP info is NOT available.
 * Total: 1.00 (normalized to 1.0 when all factors active)
 */
export const WEIGHTS_NO_IP: WeightConfig = {
    commentContentTitleRisk: 0.14,
    commentUrlRisk: 0.12,
    velocityRisk: 0.1,
    accountAge: 0.12,
    karmaScore: 0.1,
    ipRisk: 0,
    networkBanHistory: 0.1,
    modqueueRejectionRate: 0.06,
    networkRemovalRate: 0.08,
    socialVerification: 0.12,
    walletVerification: 0.06
};

/**
 * Weights when IP info IS available.
 * Total: 1.00 (normalized to 1.0 when all factors active)
 */
export const WEIGHTS_WITH_IP: WeightConfig = {
    commentContentTitleRisk: 0.1,
    commentUrlRisk: 0.1,
    velocityRisk: 0.08,
    accountAge: 0.08,
    karmaScore: 0.06,
    ipRisk: 0.2,
    networkBanHistory: 0.08,
    modqueueRejectionRate: 0.04,
    networkRemovalRate: 0.08,
    socialVerification: 0.12,
    walletVerification: 0.06
};
