import type { RiskContext, RiskFactor } from "../types.js";
import { getAuthorPublicKeyFromChallengeRequest, getPublicationType } from "../utils.js";
import {
    calculateTimestampStdDev,
    collectAllUrls,
    collectUrlPrefixesForSimilarity,
    extractDomain,
    getTimeClusteringRisk,
    isIpAddressUrl
} from "../url-utils.js";

// ============================================
// Configuration: Detection Thresholds
// ============================================

// TODO handle a highly risk case where URL is not whitelisted and is first time seen by the indexer
// make sure with the indexer that the comment hasn't been deleted recently, or otherwise it means the URLs could be spammy
/**
 * Risk score adjustments for URL detection patterns.
 * All values are additive to the base score.
 */
const RISK_SCORES = {
    /** Base risk score for comments containing URLs */
    BASE_WITH_URLS: 0.2,

    /** Same author posting same exact URL */
    SAME_AUTHOR_URL: {
        HEAVY: 0.4, // 5+ posts
        MODERATE: 0.25, // 3-4 posts
        LOW: 0.15 // 1-2 posts
    },

    /** Other authors posting same exact URL (coordinated spam) */
    OTHER_AUTHORS_URL: {
        LIKELY_COORDINATED: 0.5, // 10+ posts
        POSSIBLE_COORDINATED: 0.35, // 5-9 posts
        MULTIPLE_AUTHORS: 0.2, // 2-4 posts
        SEEN_ONCE: 0.1 // 1 post
    },

    /** Same author posting to same domain repeatedly */
    SAME_DOMAIN: {
        HEAVY: 0.25, // 10+ links
        MODERATE: 0.15 // 5-9 links
    },

    /** IP address URLs (suspicious) */
    IP_ADDRESS_URL: 0.2,

    /** Same author posting similar URLs (prefix match) */
    SIMILAR_URLS_AUTHOR: {
        CLUSTERED_HEAVY: 0.35, // 5+ similar, clustered in time
        CLUSTERED_MODERATE: 0.25, // 3-4 similar, clustered in time
        SPREAD_HEAVY: 0.2, // 5+ similar, spread over time
        SPREAD_MODERATE: 0.1 // 3-4 similar, spread over time
    },

    /** Cross-author similar URLs (coordinated campaign) */
    SIMILAR_URLS_OTHERS: {
        CLUSTERED_BASE: 0.3, // Base for time-clustered campaign (+ clustering bonus)
        SPREAD: 0.15 // Spread over time (organic sharing)
    }
};

/**
 * Count thresholds for triggering different risk levels.
 */
const THRESHOLDS = {
    /** Same author exact URL thresholds */
    SAME_AUTHOR_URL: {
        HEAVY: 5,
        MODERATE: 3,
        LOW: 1
    },

    /** Other authors exact URL thresholds */
    OTHER_AUTHORS_URL: {
        LIKELY_COORDINATED: 10,
        POSSIBLE_COORDINATED: 5,
        MULTIPLE_AUTHORS: 2,
        SEEN_ONCE: 1
    },

    /** Same domain thresholds */
    SAME_DOMAIN: {
        HEAVY: 10,
        MODERATE: 5
    },

    /** Similar URL (prefix match) thresholds */
    SIMILAR_URLS: {
        /** Minimum similar URLs from same author to trigger detection */
        AUTHOR_MIN: 3,
        /** High count of similar URLs from same author */
        AUTHOR_HEAVY: 5,
        /** Minimum similar URLs from other authors for coordinated detection */
        OTHERS_MIN_COUNT: 5,
        /** Minimum unique authors for coordinated detection */
        OTHERS_MIN_AUTHORS: 3
    }
};

/**
 * URL/link risk analysis for comments (posts and replies).
 *
 * This module analyzes URLs from multiple sources:
 * - comment.link (dedicated link field for link posts)
 * - comment.content (URLs embedded in post/reply content)
 * - comment.title (URLs in post titles)
 *
 * Detection patterns:
 * - Same URL posted multiple times by the same author
 * - Same URL posted by multiple different authors (coordinated spam)
 * - Similar URLs (same domain/path prefix) from same or different authors
 * - IP address URLs (often used for malicious links)
 */

/**
 * Calculate risk score based on URL analysis.
 *
 * Factors analyzed:
 * - Same URL posted multiple times by the same author (link spam)
 * - Same URL posted by different authors (coordinated link spam)
 * - Similar URLs (same prefix) from same author (URL variation spam)
 * - Similar URLs (same prefix) from different authors (coordinated campaign with URL rotation)
 * - IP address URLs
 *
 * Time clustering is used to distinguish coordinated spam bursts from organic sharing.
 * No fixed time window is used - instead, the standard deviation of posting timestamps
 * determines whether posts are clustered (suspicious) or spread out (organic).
 *
 * Note: This factor only applies to comments (posts and replies).
 * For non-comment publications, returns a neutral score.
 */
export function calculateCommentUrlRisk(ctx: RiskContext, weight: number): RiskFactor {
    const { challengeRequest, combinedData } = ctx;

    // Check if this is a comment (post or reply)
    const publicationType = getPublicationType(challengeRequest);
    if (publicationType !== "post" && publicationType !== "reply") {
        // URL risk doesn't apply to non-comment publications - skip this factor
        return {
            name: "commentUrlRisk",
            score: 0,
            weight: 0, // Zero weight - this factor is skipped for non-comments
            explanation: "Link analysis: not applicable (non-comment publication)"
        };
    }

    const comment = challengeRequest.comment!;

    // Collect all URLs from link, content, and title
    const allUrls = collectAllUrls({
        link: comment.link,
        content: comment.content,
        title: comment.title
    });

    // No URLs found - positive signal (no URLs is good)
    // TODO actually it should be skipped altogether if there are no urls, not sure, maybe not
    if (allUrls.length === 0) {
        return {
            name: "commentUrlRisk",
            score: 0.2, // Positive signal - no URLs is good
            weight,
            explanation: "Link analysis: no URLs found"
        };
    }

    // Use the author's cryptographic public key for identity tracking
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(challengeRequest);

    let score = RISK_SCORES.BASE_WITH_URLS;
    const issues: string[] = [];

    // ============================================
    // Exact URL matching (for all URLs)
    // ============================================

    for (const url of allUrls) {
        // Check for same URL from the same author
        const sameAuthorLinks = combinedData.findLinksByAuthor({
            authorPublicKey,
            link: url
        });

        if (sameAuthorLinks >= THRESHOLDS.SAME_AUTHOR_URL.HEAVY) {
            score += RISK_SCORES.SAME_AUTHOR_URL.HEAVY;
            issues.push(`${sameAuthorLinks} posts with same URL from author`);
        } else if (sameAuthorLinks >= THRESHOLDS.SAME_AUTHOR_URL.MODERATE) {
            score += RISK_SCORES.SAME_AUTHOR_URL.MODERATE;
            issues.push(`${sameAuthorLinks} posts with same URL from author`);
        } else if (sameAuthorLinks >= THRESHOLDS.SAME_AUTHOR_URL.LOW) {
            score += RISK_SCORES.SAME_AUTHOR_URL.LOW;
            issues.push(`${sameAuthorLinks} post(s) with same URL from author`);
        }

        // Check for same URL from different authors (coordinated spam)
        const otherAuthorsResult = combinedData.findLinksByOthers({
            excludeAuthorPublicKey: authorPublicKey,
            link: url
        });

        if (otherAuthorsResult.count >= THRESHOLDS.OTHER_AUTHORS_URL.LIKELY_COORDINATED) {
            score += RISK_SCORES.OTHER_AUTHORS_URL.LIKELY_COORDINATED;
            issues.push(
                `${otherAuthorsResult.count} posts with same URL from ${otherAuthorsResult.uniqueAuthors} other authors (likely coordinated spam)`
            );
        } else if (otherAuthorsResult.count >= THRESHOLDS.OTHER_AUTHORS_URL.POSSIBLE_COORDINATED) {
            score += RISK_SCORES.OTHER_AUTHORS_URL.POSSIBLE_COORDINATED;
            issues.push(
                `${otherAuthorsResult.count} posts with same URL from ${otherAuthorsResult.uniqueAuthors} other authors (possible coordinated spam)`
            );
        } else if (otherAuthorsResult.count >= THRESHOLDS.OTHER_AUTHORS_URL.MULTIPLE_AUTHORS) {
            score += RISK_SCORES.OTHER_AUTHORS_URL.MULTIPLE_AUTHORS;
            issues.push(`${otherAuthorsResult.count} posts with same URL from other authors`);
        } else if (otherAuthorsResult.count >= THRESHOLDS.OTHER_AUTHORS_URL.SEEN_ONCE) {
            score += RISK_SCORES.OTHER_AUTHORS_URL.SEEN_ONCE;
            issues.push("URL seen from another author");
        }

        // Check for IP address URLs
        if (isIpAddressUrl(url)) {
            score += RISK_SCORES.IP_ADDRESS_URL;
            issues.push("uses IP address instead of domain");
        }

        // Check domain diversity - same domain posted repeatedly
        const domain = extractDomain(url);
        if (domain) {
            const domainCount = combinedData.countLinkDomainByAuthor({
                authorPublicKey,
                domain
            });

            if (domainCount >= THRESHOLDS.SAME_DOMAIN.HEAVY) {
                score += RISK_SCORES.SAME_DOMAIN.HEAVY;
                issues.push(`${domainCount} links to same domain from author`);
            } else if (domainCount >= THRESHOLDS.SAME_DOMAIN.MODERATE) {
                score += RISK_SCORES.SAME_DOMAIN.MODERATE;
                issues.push(`${domainCount} links to same domain from author`);
            }
        }
    }

    // ============================================
    // Similar URL detection (prefix matching)
    // Only for non-allowlisted domains
    // ============================================

    const urlPrefixes = collectUrlPrefixesForSimilarity({
        link: comment.link,
        content: comment.content,
        title: comment.title
    });

    for (const prefix of urlPrefixes) {
        // Check for similar URLs from the same author
        const similarFromAuthor = combinedData.findSimilarUrlsByAuthor({
            authorPublicKey,
            urlPrefix: prefix
        });

        if (similarFromAuthor >= THRESHOLDS.SIMILAR_URLS.AUTHOR_MIN) {
            // Get timestamps to analyze time clustering for same-author spam
            const authorTimestamps = combinedData.getSimilarUrlTimestampsByAuthor({
                authorPublicKey,
                urlPrefix: prefix
            });

            const authorStddev = calculateTimestampStdDev(authorTimestamps);
            const authorClusteringRisk = getTimeClusteringRisk(authorStddev, authorTimestamps.length);

            if (authorClusteringRisk > 0) {
                // Rapid-fire same-author posting - higher risk
                const baseRisk =
                    similarFromAuthor >= THRESHOLDS.SIMILAR_URLS.AUTHOR_HEAVY
                        ? RISK_SCORES.SIMILAR_URLS_AUTHOR.CLUSTERED_HEAVY
                        : RISK_SCORES.SIMILAR_URLS_AUTHOR.CLUSTERED_MODERATE;
                score += baseRisk + authorClusteringRisk; // base + up to 0.3 for tight clustering
                const stddevHours = authorStddev ? (authorStddev / 3600).toFixed(1) : "N/A";
                issues.push(`${similarFromAuthor} similar URLs from author clustered in time (stddev: ${stddevHours}h)`);
            } else {
                // Spread out over time - still add risk but less severe
                if (similarFromAuthor >= THRESHOLDS.SIMILAR_URLS.AUTHOR_HEAVY) {
                    score += RISK_SCORES.SIMILAR_URLS_AUTHOR.SPREAD_HEAVY;
                    issues.push(`${similarFromAuthor} similar URLs (same prefix) from author (spread over time)`);
                } else {
                    score += RISK_SCORES.SIMILAR_URLS_AUTHOR.SPREAD_MODERATE;
                    issues.push(`${similarFromAuthor} similar URLs (same prefix) from author (spread over time)`);
                }
            }
        }

        // Check for similar URLs from other authors (coordinated campaign with URL rotation)
        const similarFromOthers = combinedData.findSimilarUrlsByOthers({
            excludeAuthorPublicKey: authorPublicKey,
            urlPrefix: prefix
        });

        if (
            similarFromOthers.count >= THRESHOLDS.SIMILAR_URLS.OTHERS_MIN_COUNT &&
            similarFromOthers.uniqueAuthors >= THRESHOLDS.SIMILAR_URLS.OTHERS_MIN_AUTHORS
        ) {
            // Get timestamps to analyze time clustering
            const timestamps = combinedData.getSimilarUrlTimestampsByOthers({
                excludeAuthorPublicKey: authorPublicKey,
                urlPrefix: prefix
            });

            const stddev = calculateTimestampStdDev(timestamps);
            const clusteringRisk = getTimeClusteringRisk(stddev, timestamps.length);

            if (clusteringRisk > 0) {
                // Time-clustered coordinated campaign - higher risk
                score += RISK_SCORES.SIMILAR_URLS_OTHERS.CLUSTERED_BASE + clusteringRisk; // base + up to 0.3 for tight clustering
                const stddevHours = stddev ? (stddev / 3600).toFixed(1) : "N/A";
                issues.push(
                    `${similarFromOthers.count} similar URLs from ${similarFromOthers.uniqueAuthors} authors clustered in time (stddev: ${stddevHours}h) - likely coordinated campaign`
                );
            } else {
                // Spread out over time - less suspicious, use lower base score
                score += RISK_SCORES.SIMILAR_URLS_OTHERS.SPREAD;
                issues.push(`${similarFromOthers.count} similar URLs from ${similarFromOthers.uniqueAuthors} authors (spread over time)`);
            }
        }
    }

    // Clamp score to [0, 1]
    score = Math.max(0, Math.min(1, score));

    const explanation = issues.length > 0 ? `Link analysis: ${issues.join(", ")}` : "Link analysis: no suspicious patterns detected";

    return {
        name: "commentUrlRisk",
        score,
        weight,
        explanation
    };
}
