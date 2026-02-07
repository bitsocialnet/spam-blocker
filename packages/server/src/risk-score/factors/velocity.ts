import type { CombinedDataService } from "../combined-data-service.js";
import type { RiskContext, RiskFactor } from "../types.js";
import { getAuthorPublicKeyFromChallengeRequest, getPublicationType, type PublicationType } from "../utils.js";

// TODO rename this to author-velocity.ts
// needs to be very clear this file only queries data about this author
/**
 * Thresholds for author velocity by publication type.
 * Different publication types have different acceptable posting rates.
 */
const THRESHOLDS = {
    post: {
        NORMAL: 2,
        ELEVATED: 5,
        SUSPICIOUS: 8,
        BOT_LIKE: 12
    },
    reply: {
        NORMAL: 5,
        ELEVATED: 10,
        SUSPICIOUS: 15,
        BOT_LIKE: 25
    },
    vote: {
        NORMAL: 20,
        ELEVATED: 40,
        SUSPICIOUS: 60,
        BOT_LIKE: 100
    }
};

/**
 * Thresholds for aggregate velocity across ALL publication types combined.
 * Used to detect overall activity bursts regardless of type distribution.
 */
const AGGREGATE_THRESHOLDS = {
    NORMAL: 25,
    ELEVATED: 50,
    SUSPICIOUS: 80,
    BOT_LIKE: 150
};

/**
 * Cross-type penalty blend factor.
 * When another publication type has higher velocity risk, this percentage
 * of the difference is blended into the current type's score.
 */
const CROSS_TYPE_PENALTY_BLEND = 0.5;

/**
 * Risk scores for different velocity levels.
 */
const SCORES = {
    NORMAL: 0.1,
    ELEVATED: 0.4,
    SUSPICIOUS: 0.7,
    BOT_LIKE: 0.95
};

/**
 * Get thresholds for a publication type.
 */
function getThresholdsForType(pubType: PublicationType): (typeof THRESHOLDS)["post"] {
    return THRESHOLDS[pubType];
}

/**
 * Calculate the velocity score based on publications per hour.
 */
function calculateScoreFromVelocity(
    lastHour: number,
    last24Hours: number,
    thresholds: (typeof THRESHOLDS)["post"]
): { score: number; level: string } {
    const avgPerHour = last24Hours / 24;
    const effectiveRate = Math.max(lastHour, avgPerHour);

    if (effectiveRate <= thresholds.NORMAL) {
        return { score: SCORES.NORMAL, level: "normal" };
    } else if (effectiveRate <= thresholds.ELEVATED) {
        return { score: SCORES.ELEVATED, level: "elevated" };
    } else if (effectiveRate <= thresholds.SUSPICIOUS) {
        return { score: SCORES.SUSPICIOUS, level: "suspicious" };
    } else {
        return { score: SCORES.BOT_LIKE, level: "likely automated" };
    }
}

/**
 * Get the maximum velocity score from all OTHER publication types.
 * Used to apply cross-type penalty when another type shows high velocity.
 */
function getMaxVelocityFromOtherTypes(
    combinedData: CombinedDataService,
    authorPublicKey: string,
    excludeType: "post" | "reply" | "vote"
): { score: number; level: string; type: string } {
    const types: Array<"post" | "reply" | "vote"> = ["post", "reply", "vote"];

    let maxScore = 0;
    let maxLevel = "normal";
    let maxType = "";

    for (const type of types) {
        if (type === excludeType) continue;

        const stats = combinedData.getAuthorVelocityStats(authorPublicKey, type);
        const thresholds = THRESHOLDS[type];
        const { score, level } = calculateScoreFromVelocity(stats.lastHour, stats.last24Hours, thresholds);

        if (score > maxScore) {
            maxScore = score;
            maxLevel = level;
            maxType = type;
        }
    }

    return { score: maxScore, level: maxLevel, type: maxType };
}

/**
 * Calculate aggregate velocity score across all publication types.
 */
function calculateAggregateVelocity(
    combinedData: CombinedDataService,
    authorPublicKey: string
): { score: number; level: string; lastHour: number; last24Hours: number } {
    const aggregateStats = combinedData.getAuthorAggregateVelocityStats(authorPublicKey);
    const { lastHour, last24Hours } = aggregateStats;

    const avgPerHour = last24Hours / 24;
    const effectiveRate = Math.max(lastHour, avgPerHour);

    let score: number;
    let level: string;

    if (effectiveRate <= AGGREGATE_THRESHOLDS.NORMAL) {
        score = SCORES.NORMAL;
        level = "normal";
    } else if (effectiveRate <= AGGREGATE_THRESHOLDS.ELEVATED) {
        score = SCORES.ELEVATED;
        level = "elevated";
    } else if (effectiveRate <= AGGREGATE_THRESHOLDS.SUSPICIOUS) {
        score = SCORES.SUSPICIOUS;
        level = "suspicious";
    } else {
        score = SCORES.BOT_LIKE;
        level = "likely automated";
    }

    return { score, level, lastHour, last24Hours };
}

/**
 * Calculate risk score based on publication velocity.
 *
 * This factor tracks publication velocity by the author's cryptographic public key
 * (from the publication signature). This is more reliable than author.address,
 * which can be a domain name and is not cryptographically tied to the author.
 *
 * Different publication types have different thresholds since posting frequency
 * expectations differ (e.g., votes are typically more frequent than posts).
 *
 * The final score is the maximum of:
 * 1. Per-type velocity score (e.g., votes/hour vs vote thresholds)
 * 2. Aggregate velocity score (total publications/hour across all types)
 * 3. Cross-type penalty (if another type has higher velocity, blend 50% of that risk)
 */
export function calculateVelocity(ctx: RiskContext, weight: number): RiskFactor {
    const { challengeRequest, combinedData } = ctx;
    // Use the author's cryptographic public key for identity tracking.
    // author.address can be a domain and is not cryptographically tied to the author.
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(challengeRequest);

    const pubType = getPublicationType(challengeRequest);
    const thresholds = getThresholdsForType(pubType);

    // 1. Calculate per-type velocity from combined data (engine + indexer)
    const perTypeStats = combinedData.getAuthorVelocityStats(authorPublicKey, pubType);
    const perTypeResult = calculateScoreFromVelocity(perTypeStats.lastHour, perTypeStats.last24Hours, thresholds);

    // 2. Calculate aggregate velocity across all types
    const aggregateResult = calculateAggregateVelocity(combinedData, authorPublicKey);

    // 3. Get max velocity from other types for cross-type penalty
    const otherTypesMax = getMaxVelocityFromOtherTypes(combinedData, authorPublicKey, pubType);

    // 4. Apply cross-type penalty: blend 50% of higher velocity from other types
    let crossTypePenaltyScore = perTypeResult.score;
    let crossTypePenaltyApplied = false;
    if (otherTypesMax.score > perTypeResult.score) {
        crossTypePenaltyScore = perTypeResult.score + (otherTypesMax.score - perTypeResult.score) * CROSS_TYPE_PENALTY_BLEND;
        crossTypePenaltyApplied = true;
    }

    // 5. Final score is the maximum of all three checks
    const finalScore = Math.max(perTypeResult.score, aggregateResult.score, crossTypePenaltyScore);

    // Build explanation with details about what triggered the score
    const explanationParts: string[] = [];
    explanationParts.push(`${pubType}: ${perTypeStats.lastHour}/hr (${perTypeResult.level})`);

    if (aggregateResult.score >= perTypeResult.score && aggregateResult.score > SCORES.NORMAL) {
        explanationParts.push(`aggregate: ${aggregateResult.lastHour}/hr (${aggregateResult.level})`);
    }

    if (crossTypePenaltyApplied && crossTypePenaltyScore > perTypeResult.score) {
        explanationParts.push(`cross-type penalty from ${otherTypesMax.type} (${otherTypesMax.level})`);
    }

    return {
        name: "velocityRisk",
        score: finalScore,
        weight,
        explanation: `Velocity: ${explanationParts.join(", ")}`
    };
}
