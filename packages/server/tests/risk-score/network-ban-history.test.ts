import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateNetworkBanHistory } from "../../src/risk-score/factors/network-risk.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const authorPublicKey = "test-ban-author-pk";

const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: authorPublicKey,
    signedPropertyNames: ["author"]
};

function createMockChallengeRequest(): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    return {
        comment: {
            author: { address: "12D3KooWTestAddress" },
            communityAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content: "Test content"
        }
    } as unknown as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

/**
 * Helper: seed indexed comments across N distinct communities for the author.
 * This creates the "posting history" that the factor uses.
 */
function seedDistinctSubs(db: SpamDetectionDatabase, count: number): void {
    const dbRaw = db.getDb();
    const nowMs = baseTimestamp * 1000;

    for (let i = 0; i < count; i++) {
        const subAddr = `sub-${i}.eth`;
        const cid = `QmSub${i}`;

        dbRaw
            .prepare(
                `INSERT OR IGNORE INTO indexed_communities (address, discoveredVia, discoveredAt, indexingEnabled)
                 VALUES (?, 'manual', ?, 1)`
            )
            .run(subAddr, nowMs);

        dbRaw
            .prepare(
                `INSERT INTO indexed_comments_ipfs (cid, communityAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                 VALUES (?, ?, ?, ?, ?, ?, '1')`
            )
            .run(
                cid,
                subAddr,
                JSON.stringify({ address: "seed-author" }),
                JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                baseTimestamp - 86400 * 30,
                nowMs - 86400000 * 30
            );

        // Also insert a comment update so the DB is consistent
        dbRaw
            .prepare(
                `INSERT INTO indexed_comments_update (cid, updatedAt, fetchedAt)
                 VALUES (?, ?, ?)`
            )
            .run(cid, baseTimestamp - 86400, nowMs - 86400000);
    }
}

/**
 * Helper: seed active bans for the author in specific communities.
 * The ban is set to expire in the future (active ban).
 * banSubIndices: which sub-N.eth to ban in (must already be seeded via seedDistinctSubs).
 */
function seedActiveBans(db: SpamDetectionDatabase, banSubIndices: number[]): void {
    const dbRaw = db.getDb();
    const nowMs = baseTimestamp * 1000;
    const futureExpiry = baseTimestamp + 86400 * 365; // 1 year in the future

    for (const i of banSubIndices) {
        const cid = `QmSub${i}`;
        // Update the existing comment update to include a ban
        dbRaw
            .prepare(`UPDATE indexed_comments_update SET author = ? WHERE cid = ?`)
            .run(JSON.stringify({ community: { banExpiresAt: futureExpiry } }), cid);
    }
}

/**
 * Helper: seed an expired ban for the author in a specific community.
 */
function seedExpiredBan(db: SpamDetectionDatabase, subIndex: number): void {
    const dbRaw = db.getDb();
    const pastExpiry = baseTimestamp - 86400; // 1 day in the past (expired)

    const cid = `QmSub${subIndex}`;
    dbRaw
        .prepare(`UPDATE indexed_comments_update SET author = ? WHERE cid = ?`)
        .run(JSON.stringify({ community: { banExpiresAt: pastExpiry } }), cid);
}

describe("calculateNetworkBanHistory", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);
    });

    afterEach(() => {
        db.close();
    });

    function createCtx(): RiskContext {
        return {
            challengeRequest: createMockChallengeRequest(),
            now: baseTimestamp,
            hasIpInfo: false,
            db,
            combinedData
        };
    }

    it("should skip factor (weight=0) when no posting history", () => {
        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        expect(result.weight).toBe(0);
        expect(result.score).toBe(0);
        expect(result.explanation).toContain("No posting history");
    });

    it("should score ~0.30 for 0 bans, 1 sub", () => {
        seedDistinctSubs(db, 1);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // cleanSubs=1, banSeverity=0, trustPenalty=max(0, 0.4 - 0.1*log2(2)) = 0.4-0.1 = 0.30
        expect(result.score).toBe(0.3);
        expect(result.weight).toBe(0.1);
    });

    it("should score ~0.20 for 0 bans, 3 subs", () => {
        seedDistinctSubs(db, 3);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // cleanSubs=3, banSeverity=0, trustPenalty=max(0, 0.4 - 0.1*log2(4)) = 0.4-0.2 = 0.20
        expect(result.score).toBe(0.2);
    });

    it("should score ~0.10 for 0 bans, 7 subs", () => {
        seedDistinctSubs(db, 7);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // cleanSubs=7, banSeverity=0, trustPenalty=max(0, 0.4 - 0.1*log2(8)) = 0.4-0.3 = 0.10
        expect(result.score).toBe(0.1);
    });

    it("should score ~0.00 for 0 bans, 15 subs", () => {
        seedDistinctSubs(db, 15);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // cleanSubs=15, banSeverity=0, trustPenalty=max(0, 0.4 - 0.1*log2(16)) = 0.4-0.4 = 0.00
        expect(result.score).toBe(0.0);
    });

    it("should score ~0.00 for 0 bans, 20 subs", () => {
        seedDistinctSubs(db, 20);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // cleanSubs=20, trustPenalty is clamped to 0
        expect(result.score).toBe(0.0);
    });

    it("should score ~0.38 for 1 active ban in 10 subs", () => {
        seedDistinctSubs(db, 10);
        seedActiveBans(db, [0]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = sqrt(1/10) ≈ 0.316
        // cleanSubs = 9, trustPenalty = max(0, 0.4 - 0.1*log2(10)) ≈ 0.4 - 0.332 ≈ 0.068
        // score = min(1, 0.316 + 0.068) ≈ 0.38
        expect(result.score).toBeCloseTo(0.38, 1);
    });

    it("should treat expired bans as 0 bans", () => {
        seedDistinctSubs(db, 10);
        seedExpiredBan(db, 0); // expire a ban in sub-0

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // Expired ban should be ignored. This is effectively 0 bans, 10 subs.
        // cleanSubs=10, banSeverity=0, trustPenalty=max(0, 0.4 - 0.1*log2(11)) ≈ 0.4-0.346 ≈ 0.054
        // Should be a very low score, just the trust penalty
        expect(result.score).toBeLessThan(0.1);
        expect(result.explanation).toContain("No active bans");
    });

    it("should score 1.0 for 3 active bans in 3 subs (all banned)", () => {
        seedDistinctSubs(db, 3);
        seedActiveBans(db, [0, 1, 2]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = 1.0 (all banned), trustPenalty doesn't matter
        expect(result.score).toBe(1.0);
    });

    it("should score 1.0 for 5 active bans in 5 subs (all banned)", () => {
        seedDistinctSubs(db, 5);
        seedActiveBans(db, [0, 1, 2, 3, 4]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        expect(result.score).toBe(1.0);
    });

    it("should score ~0.50 for 5 active bans in 20 subs", () => {
        seedDistinctSubs(db, 20);
        seedActiveBans(db, [0, 1, 2, 3, 4]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = sqrt(5/20) = sqrt(0.25) = 0.50
        // cleanSubs = 15, trustPenalty = max(0, 0.4 - 0.1*log2(16)) = 0.4-0.4 = 0.00
        // score = 0.50
        expect(result.score).toBeCloseTo(0.5, 1);
    });

    it("should score 1.0 (capped) for 15 active bans in 20 subs", () => {
        seedDistinctSubs(db, 20);
        seedActiveBans(db, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = sqrt(15/20) = sqrt(0.75) ≈ 0.866
        // cleanSubs = 5, trustPenalty = max(0, 0.4 - 0.1*log2(6)) ≈ 0.4 - 0.258 ≈ 0.142
        // score = min(1.0, 0.866 + 0.142) ≈ 1.0 (capped)
        expect(result.score).toBe(1.0);
    });

    it("should score 1.0 for 1 ban in 1 sub (only sub is banned)", () => {
        seedDistinctSubs(db, 1);
        seedActiveBans(db, [0]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = 1.0 (all subs banned)
        expect(result.score).toBe(1.0);
    });

    it("should score ~0.82 for 1 ban in 3 subs", () => {
        seedDistinctSubs(db, 3);
        seedActiveBans(db, [0]);

        const result = calculateNetworkBanHistory(createCtx(), 0.1);

        // banSeverity = sqrt(1/3) ≈ 0.577
        // cleanSubs = 2, trustPenalty = max(0, 0.4 - 0.1*log2(3)) ≈ 0.4 - 0.158 ≈ 0.242
        // score = min(1.0, 0.577 + 0.242) ≈ 0.82
        expect(result.score).toBeCloseTo(0.82, 1);
    });
});
