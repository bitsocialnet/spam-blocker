/**
 * Tests for calculateNetworkRemovalRate with weighted formula:
 * - purgedCount * 1.5 (most severe)
 * - removalCount * 1.0
 * - disapprovalCount * 1.0
 * - unfetchableCount * 0.5 (least severe, pending verification)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateNetworkRemovalRate } from "../../src/risk-score/factors/network-risk.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const authorPublicKey = "test-removal-author-pk";

const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: authorPublicKey,
    signedPropertyNames: ["author"]
};

function createMockChallengeRequest(): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    return {
        comment: {
            author: { address: "12D3KooWTestAddress" },
            subplebbitAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content: "Test content"
        }
    } as unknown as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

function seedComments(db: SpamDetectionDatabase, count: number): void {
    const dbRaw = db.getDb();
    const nowMs = baseTimestamp * 1000;
    const subAddr = "test-sub.eth";

    dbRaw
        .prepare(
            `INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
             VALUES (?, 'manual', ?, 1)`
        )
        .run(subAddr, nowMs);

    for (let i = 0; i < count; i++) {
        const cid = `QmComment${i}`;
        dbRaw
            .prepare(
                `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                 VALUES (?, ?, ?, ?, ?, ?, '1')`
            )
            .run(
                cid,
                subAddr,
                JSON.stringify({ address: "addr" }),
                JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                baseTimestamp - 86400,
                nowMs - 86400000
            );

        dbRaw
            .prepare(`INSERT INTO indexed_comments_update (cid, updatedAt, fetchedAt) VALUES (?, ?, ?)`)
            .run(cid, baseTimestamp - 86400, nowMs - 86400000);
    }
}

describe("calculateNetworkRemovalRate (weighted)", () => {
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

    it("should skip factor when no indexed comments", () => {
        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        expect(result.weight).toBe(0);
        expect(result.score).toBe(0);
    });

    it("should score 0.1 for no removals/purges", () => {
        seedComments(db, 10);
        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        expect(result.score).toBe(0.1);
    });

    it("should weigh purged comments at 1.5x", () => {
        // 10 comments, 2 purged → weighted = 2*1.5 = 3.0 → rate = 3.0/10 = 30%
        seedComments(db, 10);
        const dbRaw = db.getDb();
        dbRaw.prepare(`UPDATE indexed_comments_update SET purged = 1 WHERE cid = 'QmComment0'`).run();
        dbRaw.prepare(`UPDATE indexed_comments_update SET purged = 1 WHERE cid = 'QmComment1'`).run();

        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        // 30% → 0.5 score
        expect(result.score).toBe(0.5);
        expect(result.explanation).toContain("purged");
    });

    it("should weigh removed comments at 1.0x", () => {
        // 10 comments, 2 removed → weighted = 2*1.0 = 2.0 → rate = 2.0/10 = 20%
        seedComments(db, 10);
        const dbRaw = db.getDb();
        dbRaw.prepare(`UPDATE indexed_comments_update SET removed = 1 WHERE cid = 'QmComment0'`).run();
        dbRaw.prepare(`UPDATE indexed_comments_update SET removed = 1 WHERE cid = 'QmComment1'`).run();

        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        // 20% → 0.5 score (in 15-30% band)
        expect(result.score).toBe(0.5);
        expect(result.explanation).toContain("removed");
    });

    it("should weigh unfetchable comments at 0.5x", () => {
        // 10 comments, 2 unfetchable → weighted = 2*0.5 = 1.0 → rate = 1.0/10 = 10%
        seedComments(db, 10);
        const dbRaw = db.getDb();
        // Set up unfetchable: fetchFailureCount > 0 and lastFetchFailedAt > fetchedAt
        const futureMs = Date.now() + 60_000;
        dbRaw
            .prepare(`UPDATE indexed_comments_update SET fetchFailureCount = 2, lastFetchFailedAt = ? WHERE cid = 'QmComment0'`)
            .run(futureMs);
        dbRaw
            .prepare(`UPDATE indexed_comments_update SET fetchFailureCount = 1, lastFetchFailedAt = ? WHERE cid = 'QmComment1'`)
            .run(futureMs);

        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        // 10% → 0.3 score (in 5-15% band)
        expect(result.score).toBe(0.3);
        expect(result.explanation).toContain("unfetchable");
    });

    it("should combine all types with proper weights", () => {
        // 20 comments: 2 purged + 2 removed + 2 disapproved + 2 unfetchable
        // weighted = 2*1.5 + 2*1.0 + 2*1.0 + 2*0.5 = 3 + 2 + 2 + 1 = 8.0
        // rate = 8.0/20 = 40% → 0.7 score
        seedComments(db, 20);
        const dbRaw = db.getDb();
        const futureMs = Date.now() + 60_000;

        dbRaw.prepare(`UPDATE indexed_comments_update SET purged = 1 WHERE cid IN ('QmComment0', 'QmComment1')`).run();
        dbRaw.prepare(`UPDATE indexed_comments_update SET removed = 1 WHERE cid IN ('QmComment2', 'QmComment3')`).run();
        dbRaw.prepare(`UPDATE indexed_comments_update SET approved = 0 WHERE cid IN ('QmComment4', 'QmComment5')`).run();
        dbRaw
            .prepare(
                `UPDATE indexed_comments_update SET fetchFailureCount = 2, lastFetchFailedAt = ? WHERE cid IN ('QmComment6', 'QmComment7')`
            )
            .run(futureMs);

        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        expect(result.score).toBe(0.7);
        expect(result.explanation).toContain("purged");
        expect(result.explanation).toContain("removed");
        expect(result.explanation).toContain("disapproved");
        expect(result.explanation).toContain("unfetchable");
    });

    it("should score 0.9 for high removal rate", () => {
        // 10 comments, 8 purged → weighted = 8*1.5 = 12.0 → rate = 12.0/10 = 120% → 0.9
        seedComments(db, 10);
        const dbRaw = db.getDb();
        for (let i = 0; i < 8; i++) {
            dbRaw.prepare(`UPDATE indexed_comments_update SET purged = 1 WHERE cid = 'QmComment${i}'`).run();
        }

        const result = calculateNetworkRemovalRate(createCtx(), 0.08);
        expect(result.score).toBe(0.9);
    });
});
