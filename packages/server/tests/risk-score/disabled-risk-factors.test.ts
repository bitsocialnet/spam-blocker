import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateRiskScore } from "../../src/risk-score/index.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type { RiskFactorName } from "../../src/risk-score/types.js";

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
        subplebbit: {
            postScore: 0,
            replyScore: 0,
            firstCommentTimestamp: baseTimestamp - 86400,
            lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
        }
    };
}

function createMockCommentRequest(author: ReturnType<typeof createMockAuthor>): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        comment: {
            author,
            subplebbitAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content: "Test content"
        }
    } as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

describe("disabledRiskFactors", () => {
    let db: SpamDetectionDatabase;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
    });

    afterEach(() => {
        db.close();
    });

    it("should set disabled factor weight and effectiveWeight to 0", () => {
        const author = createMockAuthor();
        const challengeRequest = createMockCommentRequest(author);

        const result = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp,
            disabledRiskFactors: ["walletVerification"]
        });

        const walletFactor = result.factors.find((f) => f.name === "walletVerification");
        expect(walletFactor).toBeDefined();
        expect(walletFactor!.weight).toBe(0);
        expect(walletFactor!.effectiveWeight).toBe(0);
    });

    it("should redistribute weight from disabled factors to remaining active factors", () => {
        const author = createMockAuthor();
        const challengeRequest = createMockCommentRequest(author);

        const result = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp,
            disabledRiskFactors: ["walletVerification"]
        });

        // effectiveWeights of active factors should sum to 1.0
        const totalEffectiveWeight = result.factors.reduce((sum, f) => sum + (f.effectiveWeight ?? 0), 0);
        expect(totalEffectiveWeight).toBeCloseTo(1.0, 5);

        // Active factors should have effectiveWeight > their original weight
        // (because wallet's weight was redistributed)
        const activeFactors = result.factors.filter((f) => f.weight > 0);
        for (const factor of activeFactors) {
            expect(factor.effectiveWeight).toBeGreaterThan(factor.weight);
        }
    });

    it("should handle disabling multiple factors", () => {
        const author = createMockAuthor();
        const challengeRequest = createMockCommentRequest(author);

        const disabled: RiskFactorName[] = ["walletVerification", "socialVerification", "networkBanHistory"];
        const result = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp,
            disabledRiskFactors: disabled
        });

        // All disabled factors should have weight=0 and effectiveWeight=0
        for (const name of disabled) {
            const factor = result.factors.find((f) => f.name === name);
            expect(factor).toBeDefined();
            expect(factor!.weight).toBe(0);
            expect(factor!.effectiveWeight).toBe(0);
        }

        // Total effectiveWeight should still sum to 1.0
        const totalEffectiveWeight = result.factors.reduce((sum, f) => sum + (f.effectiveWeight ?? 0), 0);
        expect(totalEffectiveWeight).toBeCloseTo(1.0, 5);
    });

    it("should have no effect when disabledRiskFactors is an empty array", () => {
        const author = createMockAuthor();
        const challengeRequest = createMockCommentRequest(author);

        const resultWithEmpty = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp,
            disabledRiskFactors: []
        });

        const resultWithout = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp
        });

        // Both should produce identical scores
        expect(resultWithEmpty.score).toBeCloseTo(resultWithout.score, 10);

        // And identical factor weights
        for (let i = 0; i < resultWithEmpty.factors.length; i++) {
            expect(resultWithEmpty.factors[i].weight).toBe(resultWithout.factors[i].weight);
            expect(resultWithEmpty.factors[i].effectiveWeight).toBeCloseTo(resultWithout.factors[i].effectiveWeight!, 10);
        }
    });

    it("should preserve relative weight ratios between remaining active factors", () => {
        const author = createMockAuthor();
        const challengeRequest = createMockCommentRequest(author);

        const result = calculateRiskScore({
            challengeRequest,
            db,
            now: baseTimestamp,
            disabledRiskFactors: ["walletVerification"]
        });

        // accountAge and velocityRisk should maintain their original ratio
        const accountAge = result.factors.find((f) => f.name === "accountAge")!;
        const velocity = result.factors.find((f) => f.name === "velocityRisk")!;

        const originalRatio = accountAge.weight / velocity.weight;
        const effectiveRatio = accountAge.effectiveWeight! / velocity.effectiveWeight!;

        expect(effectiveRatio).toBeCloseTo(originalRatio, 5);
    });
});
