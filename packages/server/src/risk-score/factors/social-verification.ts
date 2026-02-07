import type { RiskContext, RiskFactor } from "../types.js";
import type { SpamDetectionDatabase } from "../../db/index.js";
import { getAuthorPublicKeyFromChallengeRequest } from "../utils.js";

/**
 * Provider credibility weights.
 * Higher values indicate more trustworthy providers (stronger verification).
 */
const DEFAULT_PROVIDER_CREDIBILITY: Record<string, number> = {
    google: 1.0, // Phone verification, strong abuse detection
    github: 1.0, // Email required, developer-focused
    twitter: 0.85, // Phone/email verification
    discord: 0.7, // Email required, bots common
    tiktok: 0.6, // Phone typically required
    reddit: 0.6, // Email required, common bots
    yandex: 0.5 // Less strict verification
};

/** Default credibility for unknown providers */
const DEFAULT_UNKNOWN_PROVIDER_CREDIBILITY = 0.5;

/** Decay factor for multiple services (each additional provider contributes 70% of its credibility) */
const MULTIPLE_SERVICE_DECAY = 0.7;

/** Maximum combined credibility cap */
const MAX_COMBINED_CREDIBILITY = 2.5;

/**
 * Context for social verification calculation.
 */
export interface SocialVerificationContext {
    /** Author's Ed25519 public key */
    authorPublicKey: string;
    /** List of currently enabled OAuth providers (e.g., ["google", "github"]) */
    enabledProviders: string[];
    /** Database instance for querying OAuth links */
    db: SpamDetectionDatabase;
    /** Optional custom provider credibility weights */
    providerCredibility?: Record<string, number>;
}

/**
 * Get credibility weight for a provider.
 */
function getProviderCredibility(provider: string, customCredibility?: Record<string, number>): number {
    const credibility = customCredibility ?? DEFAULT_PROVIDER_CREDIBILITY;
    return credibility[provider.toLowerCase()] ?? DEFAULT_UNKNOWN_PROVIDER_CREDIBILITY;
}

/**
 * Extract provider name from OAuth identity (format: "provider:userId").
 */
function extractProvider(oauthIdentity: string): string {
    const colonIndex = oauthIdentity.indexOf(":");
    return colonIndex > 0 ? oauthIdentity.substring(0, colonIndex).toLowerCase() : oauthIdentity.toLowerCase();
}

/**
 * Calculate the reuse factor for multi-author sharing of an OAuth identity.
 * Uses inverse square: 1/n² with hard cap at 3 authors.
 *
 * - Author 1: 100% benefit (1/1² = 1.0)
 * - Author 2: 25% benefit (1/2² = 0.25)
 * - Author 3: 11% benefit (1/3² = 0.11)
 * - Author 4+: Completely discarded (0)
 */
function calculateMultiAuthorReuseFactor(authorCount: number): number {
    if (authorCount <= 0) return 0;
    if (authorCount > 3) return 0; // Hard cap: completely discarded
    return 1 / (authorCount * authorCount);
}

/**
 * Calculate the account age multiplier from an OAuth account creation timestamp.
 * Only applies a penalty for providers that expose account creation dates (GitHub, Discord).
 * Unknown/null creation dates get multiplier 1.0 (no penalty).
 *
 * | OAuth Account Age | Multiplier |
 * |-------------------|------------|
 * | < 7 days          | 0.3        |
 * | 7–30 days         | 0.5        |
 * | 30–90 days        | 0.7        |
 * | 90–365 days       | 0.9        |
 * | > 365 days        | 1.0        |
 * | Unknown (null)    | 1.0        |
 */
function calculateOAuthAccountAgeMultiplier(accountCreatedAt: number | null, nowSeconds: number): number {
    if (accountCreatedAt === null) return 1.0; // Unknown — no penalty

    const ageSeconds = nowSeconds - accountCreatedAt;
    const ageDays = ageSeconds / 86400;

    if (ageDays < 7) return 0.3;
    if (ageDays < 30) return 0.5;
    if (ageDays < 90) return 0.7;
    if (ageDays < 365) return 0.9;
    return 1.0;
}

/**
 * Calculate combined credibility from multiple OAuth identities.
 * Applies:
 * 1. Per-identity reuse factor (1/n², hard cap at 3 authors)
 * 2. Per-identity OAuth account age multiplier
 * 3. Multiple service decay (70% decay for each additional provider)
 * 4. Maximum credibility cap
 */
function calculateCombinedCredibility(params: {
    oauthIdentities: string[];
    db: SpamDetectionDatabase;
    nowSeconds: number;
    providerCredibility?: Record<string, number>;
}): {
    combinedCredibility: number;
    breakdown: Array<{
        identity: string;
        provider: string;
        baseCredibility: number;
        effectiveCredibility: number;
        authorCount: number;
        accountAgeMultiplier: number;
    }>;
} {
    const { oauthIdentities, db, nowSeconds, providerCredibility } = params;

    if (oauthIdentities.length === 0) {
        return { combinedCredibility: 0, breakdown: [] };
    }

    // Batch-fetch account creation dates for all identities (one query each, cached per call)
    const accountCreatedAtMap = new Map<string, number | null>();
    for (const identity of oauthIdentities) {
        accountCreatedAtMap.set(identity, db.getOAuthAccountCreatedAt(identity));
    }

    // Calculate effective credibility for each identity
    const identityCredibilities: Array<{
        identity: string;
        provider: string;
        baseCredibility: number;
        effectiveCredibility: number;
        authorCount: number;
        accountAgeMultiplier: number;
    }> = [];

    for (const identity of oauthIdentities) {
        const provider = extractProvider(identity);
        const baseCredibility = getProviderCredibility(provider, providerCredibility);

        // Count how many authors share this OAuth identity
        const authorCount = db.countAuthorsWithOAuthIdentity(identity);

        // Apply 1/n² reuse factor with hard cap at 3 authors
        const reuseFactor = calculateMultiAuthorReuseFactor(authorCount);

        // Apply OAuth account age multiplier (uses pre-fetched data)
        const accountCreatedAt = accountCreatedAtMap.get(identity) ?? null;
        const accountAgeMultiplier = calculateOAuthAccountAgeMultiplier(accountCreatedAt, nowSeconds);

        const effectiveCredibility = baseCredibility * reuseFactor * accountAgeMultiplier;

        identityCredibilities.push({
            identity,
            provider,
            baseCredibility,
            effectiveCredibility,
            authorCount,
            accountAgeMultiplier
        });
    }

    // Sort by effective credibility (highest first) for optimal contribution
    identityCredibilities.sort((a, b) => b.effectiveCredibility - a.effectiveCredibility);

    // Apply multiple service decay (70% decay for each additional provider)
    let combinedCredibility = 0;
    let decayMultiplier = 1.0;

    for (const item of identityCredibilities) {
        combinedCredibility += item.effectiveCredibility * decayMultiplier;
        decayMultiplier *= MULTIPLE_SERVICE_DECAY;
    }

    // Cap at maximum combined credibility
    combinedCredibility = Math.min(combinedCredibility, MAX_COMBINED_CREDIBILITY);

    return { combinedCredibility, breakdown: identityCredibilities };
}

/**
 * Calculate risk score from combined credibility.
 *
 * Quadratic formula that rewards the common 1-2 provider case:
 * score = max(0, 1 - 0.75c + 0.15c²)
 *
 * | Credibility | Score |
 * |-------------|-------|
 * | 0           | 1.0   |
 * | 0.5         | 0.66  |
 * | 1.0         | 0.40  |
 * | 1.35        | 0.26  |
 * | 1.7         | 0.15  |
 * | 2.19        | 0.07  |
 * | 2.5         | 0.03  |
 */
function credibilityToScore(credibility: number): number {
    const score = 1 - 0.75 * credibility + 0.15 * credibility * credibility;
    return Math.max(0, Math.min(1, score));
}

/**
 * Calculate risk score based on social verification (OAuth sign-in).
 *
 * This factor provides a trust signal when authors have verified via OAuth.
 *
 * Behavior:
 * - Returns weight=0 (skipped) when OAuth is completely disabled (no enabled providers)
 * - Returns score=1.0 (high risk) when OAuth is enabled but author has no verification
 * - Returns lower score based on credibility when author has OAuth links
 *
 * The credibility calculation accounts for:
 * - Provider trustworthiness (Google/GitHub > Twitter > Discord > etc.)
 * - Diminishing returns when same OAuth account links to multiple authors
 * - Multiple service decay (additional providers contribute less)
 */
export function calculateSocialVerification(ctx: RiskContext, weight: number, enabledProviders: string[]): RiskFactor {
    const factorName = "socialVerification";

    // If OAuth is completely disabled, skip this factor
    if (enabledProviders.length === 0) {
        return {
            name: factorName,
            score: 0.5, // Neutral score (doesn't matter since weight is 0)
            weight: 0, // Skipped - will be redistributed
            explanation: "OAuth verification disabled on server"
        };
    }

    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(ctx.challengeRequest);
    const { db } = ctx;

    // Get all OAuth identities linked to this author
    const oauthIdentities = db.getAuthorOAuthIdentities(authorPublicKey);

    // No OAuth links - high risk (OAuth is enabled but author hasn't verified)
    if (oauthIdentities.length === 0) {
        return {
            name: factorName,
            score: 1.0,
            weight,
            explanation: "No OAuth verification (OAuth enabled but author unverified)"
        };
    }

    // Calculate combined credibility with reuse cap and account age
    const { combinedCredibility, breakdown } = calculateCombinedCredibility({
        oauthIdentities,
        db,
        nowSeconds: ctx.now
    });

    // Convert credibility to risk score
    const score = credibilityToScore(combinedCredibility);

    // Build explanation
    const providerSummary = breakdown
        .map((item) => {
            const parts: string[] = [];
            if (item.authorCount > 3) {
                parts.push(`shared by ${item.authorCount} authors, discarded`);
            } else if (item.authorCount > 1) {
                parts.push(`shared by ${item.authorCount} authors`);
            }
            if (item.accountAgeMultiplier < 1.0) {
                parts.push(`age multiplier: ${item.accountAgeMultiplier}`);
            }
            const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
            return `${item.provider}${suffix}`;
        })
        .join(", ");

    const explanation =
        breakdown.length === 1
            ? `Verified via ${providerSummary} (credibility: ${combinedCredibility.toFixed(2)})`
            : `Verified via ${breakdown.length} providers: ${providerSummary} (combined credibility: ${combinedCredibility.toFixed(2)})`;

    return {
        name: factorName,
        score,
        weight,
        explanation
    };
}
