import type { RiskContext, RiskFactor } from "../types.js";
import { getAuthorPublicKeyFromChallengeRequest } from "../utils.js";

/**
 * Time thresholds in days for account age scoring.
 */
const THRESHOLDS = {
    /** Accounts older than this are considered very trustworthy */
    VERY_OLD: 365,
    /** Accounts older than this are considered trustworthy */
    OLD: 90,
    /** Accounts older than this are considered established */
    ESTABLISHED: 30,
    /** Accounts younger than this are considered new */
    NEW: 7,
    /** Accounts younger than this are considered very new */
    VERY_NEW: 1
};

/**
 * Risk scores for different account age brackets.
 * Lower values = lower risk.
 */
const SCORES = {
    VERY_OLD: 0.1,
    OLD: 0.2,
    ESTABLISHED: 0.35,
    MODERATE: 0.5,
    NEW: 0.7,
    VERY_NEW: 0.85,
    NO_HISTORY: 1.0 // Maximum risk - completely unknown author
};

/**
 * Calculate risk score based on account age.
 *
 * SECURITY: Only uses indexer's fetchedAt timestamp (when comment was found in subplebbit pages).
 * Does NOT trust:
 * - author.subplebbit.firstCommentTimestamp (can be fabricated by malicious subplebbit)
 * - comment.timestamp (subplebbit owner can backdate their own comments)
 * - engine's receivedAt (counts rejected submissions, inflating spammer's "age")
 *
 * By only counting indexed comments (those actually included in subplebbit pages),
 * a spammer who keeps submitting rejected spam won't get "old account" credit.
 *
 * Scoring logic:
 * - Older accounts are considered more trustworthy (lower risk)
 * - New accounts are higher risk as they haven't built a reputation
 * - Accounts with no indexed history are treated as brand new (highest risk)
 */
export function calculateAccountAge(ctx: RiskContext, weight: number): RiskFactor {
    const { challengeRequest, now, combinedData } = ctx;
    const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(challengeRequest);

    // Get first indexed timestamp from indexer (when comment appeared in subplebbit pages)
    // Only counts accepted publications, not rejected spam attempts
    const firstActivityTimestamp = combinedData.getAuthorEarliestTimestamp(authorPublicKey);

    // No first activity timestamp means new account or first interaction
    if (!firstActivityTimestamp) {
        return {
            name: "accountAge",
            score: SCORES.NO_HISTORY,
            weight,
            explanation: "No account history in this subplebbit"
        };
    }

    const accountAgeSeconds = now - firstActivityTimestamp;
    const accountAgeDays = accountAgeSeconds / (24 * 60 * 60);

    let score: number;
    let explanation: string;

    if (accountAgeDays > THRESHOLDS.VERY_OLD) {
        score = SCORES.VERY_OLD;
        explanation = `Account is ${Math.floor(accountAgeDays)} days old (very established)`;
    } else if (accountAgeDays > THRESHOLDS.OLD) {
        score = SCORES.OLD;
        explanation = `Account is ${Math.floor(accountAgeDays)} days old (established)`;
    } else if (accountAgeDays > THRESHOLDS.ESTABLISHED) {
        score = SCORES.ESTABLISHED;
        explanation = `Account is ${Math.floor(accountAgeDays)} days old (moderately established)`;
    } else if (accountAgeDays > THRESHOLDS.NEW) {
        score = SCORES.MODERATE;
        explanation = `Account is ${Math.floor(accountAgeDays)} days old`;
    } else if (accountAgeDays > THRESHOLDS.VERY_NEW) {
        score = SCORES.NEW;
        explanation = `Account is ${Math.floor(accountAgeDays)} days old (new)`;
    } else {
        score = SCORES.VERY_NEW;
        explanation = `Account is less than 1 day old (very new)`;
    }

    return {
        name: "accountAge",
        score,
        weight,
        explanation
    };
}
