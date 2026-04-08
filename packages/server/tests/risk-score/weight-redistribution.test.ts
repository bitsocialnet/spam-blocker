import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateRiskScore } from "../../src/risk-score/index.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: "pk",
    signedPropertyNames: ["author"]
};

function createMockAuthor() {
    return {
        address: "12D3KooWTestAddress",
        community: {
            postScore: 0,
            replyScore: 0,
            firstCommentTimestamp: baseTimestamp - 86400,
            lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
        }
    };
}

function createMockCommentRequest(author: ReturnType<typeof createMockAuthor>): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        comment: {
            author,
            communityAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content: "Test content"
        }
    } as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

function createMockVoteRequest(author: ReturnType<typeof createMockAuthor>): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        vote: {
            author,
            communityAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            commentCid: "QmCommentCid",
            vote: 1
        }
    } as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

describe("weight redistribution", () => {
    let db: SpamDetectionDatabase;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
    });

    afterEach(() => {
        db.close();
    });

    describe("effectiveWeight calculation", () => {
        it("should have effectiveWeights sum to 1.0 when all factors are active", () => {
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                now: baseTimestamp
            });

            // Sum of all effectiveWeights should be approximately 1.0
            const totalEffectiveWeight = result.factors.reduce((sum, f) => sum + f.effectiveWeight, 0);
            expect(totalEffectiveWeight).toBeCloseTo(1.0, 5);

            // All active factors should have effectiveWeight > 0
            for (const factor of result.factors) {
                if (factor.weight > 0) {
                    expect(factor.effectiveWeight).toBeGreaterThan(0);
                }
            }
        });

        it("should redistribute weight when multiple factors are skipped (vote publication)", () => {
            // For votes: content risk and URL risk are skipped
            const author = createMockAuthor();
            const challengeRequest = createMockVoteRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                now: baseTimestamp
            });

            // Count skipped factors
            const skippedFactors = result.factors.filter((f) => f.weight === 0);
            expect(skippedFactors.length).toBeGreaterThanOrEqual(2); // At least content and URL risk

            // All skipped factors should have effectiveWeight = 0
            for (const factor of skippedFactors) {
                expect(factor.effectiveWeight).toBe(0);
            }

            // Active factors should have their weights redistributed
            const activeFactors = result.factors.filter((f) => f.weight > 0);
            for (const factor of activeFactors) {
                expect(factor.effectiveWeight).toBeGreaterThan(factor.weight);
            }

            // Total should still be 1.0
            const totalEffectiveWeight = result.factors.reduce((sum, f) => sum + f.effectiveWeight, 0);
            expect(totalEffectiveWeight).toBeCloseTo(1.0, 5);
        });

        it("should preserve relative weight ratios between active factors", () => {
            // Two factors with different original weights should maintain their ratio
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                now: baseTimestamp
            });

            // Get two factors that are always active with different weights
            const accountAge = result.factors.find((f) => f.name === "accountAge")!;
            const velocity = result.factors.find((f) => f.name === "velocityRisk")!;

            // Original weights: accountAge=0.14, velocity=0.10
            // Ratio should be preserved: 0.14/0.10 = 1.4
            const originalRatio = accountAge.weight / velocity.weight;
            const effectiveRatio = accountAge.effectiveWeight / velocity.effectiveWeight;

            expect(effectiveRatio).toBeCloseTo(originalRatio, 5);
        });

        it("should handle IP risk being available (with ipIntelligence)", () => {
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                ipIntelligence: { isVpn: false, isTor: false, isProxy: false, isDatacenter: false },
                now: baseTimestamp
            });

            // IP risk should be active when ipIntelligence is provided
            const ipFactor = result.factors.find((f) => f.name === "ipRisk");
            expect(ipFactor).toBeDefined();
            expect(ipFactor!.weight).toBeGreaterThan(0);
            expect(ipFactor!.effectiveWeight).toBeGreaterThan(0);

            // Total should still be 1.0
            const totalEffectiveWeight = result.factors.reduce((sum, f) => sum + f.effectiveWeight, 0);
            expect(totalEffectiveWeight).toBeCloseTo(1.0, 5);
        });

        it("should skip IP risk when no ipIntelligence is provided", () => {
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                // No ipIntelligence
                now: baseTimestamp
            });

            // IP risk should be skipped
            const ipFactor = result.factors.find((f) => f.name === "ipRisk");
            expect(ipFactor).toBeDefined();
            expect(ipFactor!.weight).toBe(0);
            expect(ipFactor!.effectiveWeight).toBe(0);
        });
    });

    describe("final score calculation", () => {
        it("should calculate score using effectiveWeights", () => {
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            const result = calculateRiskScore({
                challengeRequest,
                db,
                now: baseTimestamp
            });

            // Manually calculate expected score using effectiveWeights
            let expectedScore = 0;
            for (const factor of result.factors) {
                expectedScore += factor.score * factor.effectiveWeight;
            }

            expect(result.score).toBeCloseTo(expectedScore, 5);
        });

        it("should return 0.5 if all factors are skipped (edge case)", () => {
            // This is an extreme edge case that shouldn't happen in practice
            // but tests the fallback behavior
            const author = createMockAuthor();
            const challengeRequest = createMockCommentRequest(author);

            // Use custom weights that are all zero
            const result = calculateRiskScore({
                challengeRequest,
                db,
                weights: {
                    commentContentTitleRisk: 0,
                    commentUrlRisk: 0,
                    velocityRisk: 0,
                    accountAge: 0,
                    karmaScore: 0,
                    ipRisk: 0,
                    networkBanHistory: 0,
                    modqueueRejectionRate: 0,
                    networkRemovalRate: 0
                },
                now: baseTimestamp
            });

            // All factors should be skipped
            for (const factor of result.factors) {
                expect(factor.weight).toBe(0);
                expect(factor.effectiveWeight).toBe(0);
            }

            // Score should be 0.5 (neutral fallback)
            expect(result.score).toBe(0.5);
        });
    });
});
