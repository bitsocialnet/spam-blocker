/**
 * Challenge tier determination based on risk score.
 *
 * Maps risk scores to challenge difficulty tiers:
 * - auto_accept: Very low risk, no challenge required
 * - oauth_sufficient: Normal risk, one OAuth sign-in is enough
 * - oauth_plus_more: Higher risk, requires additional verification (second OAuth or OAuth + CAPTCHA)
 * - auto_reject: Very high risk, automatically rejected
 */

export type ChallengeTier = "auto_accept" | "oauth_sufficient" | "oauth_plus_more" | "auto_reject";

/**
 * Configuration for challenge tier thresholds.
 * Risk scores are 0.0-1.0 where higher = more risk.
 */
export interface ChallengeTierConfig {
    /** Risk score below this is auto-accepted (no challenge). Default: 0.2 */
    autoAcceptThreshold: number;
    /** Risk score between autoAcceptThreshold and this gets OAuth-sufficient (one OAuth enough). Default: 0.4 */
    oauthSufficientThreshold: number;
    /** Risk score above this is auto-rejected. Default: 0.8 */
    autoRejectThreshold: number;
}

/**
 * Default challenge tier thresholds.
 */
export const DEFAULT_CHALLENGE_TIER_CONFIG: ChallengeTierConfig = {
    autoAcceptThreshold: 0.2,
    oauthSufficientThreshold: 0.4,
    autoRejectThreshold: 0.8
};

/**
 * Validate that a challenge tier configuration has valid thresholds.
 *
 * Checks that each threshold is a finite number and that they are strictly ordered:
 * autoAcceptThreshold < oauthSufficientThreshold < autoRejectThreshold
 *
 * @param config - The challenge tier configuration to validate
 * @throws Error if any threshold is not a finite number or ordering is violated
 */
export function validateChallengeTierConfig(config: ChallengeTierConfig): void {
    if (!Number.isFinite(config.autoAcceptThreshold)) {
        throw new Error("autoAcceptThreshold must be a finite number");
    }
    if (!Number.isFinite(config.oauthSufficientThreshold)) {
        throw new Error("oauthSufficientThreshold must be a finite number");
    }
    if (!Number.isFinite(config.autoRejectThreshold)) {
        throw new Error("autoRejectThreshold must be a finite number");
    }
    if (config.autoAcceptThreshold >= config.oauthSufficientThreshold) {
        throw new Error("autoAcceptThreshold must be less than oauthSufficientThreshold");
    }
    if (config.oauthSufficientThreshold >= config.autoRejectThreshold) {
        throw new Error("oauthSufficientThreshold must be less than autoRejectThreshold");
    }
}

/**
 * Determine the challenge tier based on risk score.
 *
 * @param riskScore - The calculated risk score (0.0 to 1.0)
 * @param config - Threshold configuration (uses defaults if not provided)
 * @returns The appropriate challenge tier
 */
export function determineChallengeTier(riskScore: number, config?: Partial<ChallengeTierConfig>): ChallengeTier {
    const effectiveConfig: ChallengeTierConfig = {
        ...DEFAULT_CHALLENGE_TIER_CONFIG,
        ...config
    };

    validateChallengeTierConfig(effectiveConfig);

    // Determine tier based on score
    if (riskScore < effectiveConfig.autoAcceptThreshold) {
        return "auto_accept";
    }

    if (riskScore < effectiveConfig.oauthSufficientThreshold) {
        return "oauth_sufficient";
    }

    if (riskScore < effectiveConfig.autoRejectThreshold) {
        return "oauth_plus_more";
    }

    return "auto_reject";
}
