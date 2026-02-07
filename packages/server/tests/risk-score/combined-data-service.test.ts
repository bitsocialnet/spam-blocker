import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: "testAuthorPublicKey",
    signedPropertyNames: ["author"]
};

describe("CombinedDataService", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);

        // Insert required parent records for indexer tables
        const rawDb = db.getDb();
        rawDb
            .prepare(
                `INSERT INTO indexed_subplebbits (address, discoveredVia, discoveredAt)
             VALUES (?, ?, ?)`
            )
            .run("sub1.eth", "manual", baseTimestamp);
        rawDb
            .prepare(
                `INSERT INTO indexed_subplebbits (address, discoveredVia, discoveredAt)
             VALUES (?, ?, ?)`
            )
            .run("sub2.eth", "manual", baseTimestamp);
    });

    afterEach(() => {
        db.close();
    });

    describe("getAuthorEarliestTimestamp", () => {
        it("should return undefined when author has no history in either source", () => {
            const result = combinedData.getAuthorEarliestTimestamp("unknownAuthor");
            expect(result).toBeUndefined();
        });

        it("should return undefined when only engine has data (engine data is ignored)", () => {
            // Insert a comment into engine database
            // Since we only use indexer data for account age, engine-only records
            // should NOT contribute (prevents spammers from inflating age via rejected submissions)
            db.insertChallengeSession({
                sessionId: "challenge-1",
                subplebbitPublicKey: "subKey",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "challenge-1",
                publication: {
                    author: { address: "author1" },
                    subplebbitAddress: "sub1.eth",
                    timestamp: baseTimestamp - 1000,
                    signature: baseSignature,
                    protocolVersion: "1"
                }
            });

            const result = combinedData.getAuthorEarliestTimestamp("testAuthorPublicKey");
            // Engine-only data should NOT count - only indexer data is used
            expect(result).toBeUndefined();
        });

        it("should only use indexer data (engine data is ignored)", () => {
            // Insert into engine - this should be IGNORED
            db.insertChallengeSession({
                sessionId: "challenge-2",
                subplebbitPublicKey: "subKey",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "challenge-2",
                publication: {
                    author: { address: "author1" },
                    subplebbitAddress: "sub1.eth",
                    timestamp: baseTimestamp - 1000, // 1000 seconds ago - engine data, ignored
                    signature: baseSignature,
                    protocolVersion: "1"
                }
            });

            // Insert into indexer - this is the only data used
            const rawDb = db.getDb();
            rawDb
                .prepare(
                    `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`
                )
                .run(
                    "Qm123",
                    "sub2.eth",
                    JSON.stringify({ address: "author1" }),
                    JSON.stringify(baseSignature),
                    baseTimestamp - 5000,
                    (baseTimestamp - 5000) * 1000 // fetchedAt in milliseconds
                );

            const result = combinedData.getAuthorEarliestTimestamp("testAuthorPublicKey");
            // Should return only the indexer timestamp (engine is ignored)
            expect(result).toBe(baseTimestamp - 5000);
        });
    });

    describe("getAuthorKarmaBySubplebbit", () => {
        it("should return empty map for unknown author", () => {
            const result = combinedData.getAuthorKarmaBySubplebbit("unknownAuthor");
            expect(result.size).toBe(0);
        });

        it("should return karma from engine when only engine has data", () => {
            db.insertChallengeSession({
                sessionId: "karma-1",
                subplebbitPublicKey: "subKey",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "karma-1",
                publication: {
                    author: {
                        address: "author1",
                        subplebbit: { postScore: 10, replyScore: 5 }
                    },
                    subplebbitAddress: "sub1.eth",
                    timestamp: baseTimestamp,
                    signature: baseSignature,
                    protocolVersion: "1"
                }
            });

            const result = combinedData.getAuthorKarmaBySubplebbit("testAuthorPublicKey");
            expect(result.size).toBe(1);
            expect(result.get("sub1.eth")).toEqual({ postScore: 10, replyScore: 5 });
        });

        it("should use more recent source when both have data for same subplebbit", () => {
            // Insert into engine with older timestamp
            db.insertChallengeSession({
                sessionId: "karma-2",
                subplebbitPublicKey: "subKey",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "karma-2",
                publication: {
                    author: {
                        address: "author1",
                        subplebbit: { postScore: 10, replyScore: 5 }
                    },
                    subplebbitAddress: "sub1.eth",
                    timestamp: baseTimestamp - 1000,
                    signature: baseSignature,
                    protocolVersion: "1"
                }
            });

            // Insert into indexer with newer updatedAt
            const rawDb = db.getDb();
            rawDb
                .prepare(
                    `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`
                )
                .run(
                    "Qm123",
                    "sub1.eth",
                    JSON.stringify({ address: "author1" }),
                    JSON.stringify(baseSignature),
                    baseTimestamp,
                    baseTimestamp
                );

            rawDb
                .prepare(
                    `INSERT INTO indexed_comments_update (cid, author, fetchedAt, updatedAt)
                 VALUES (?, ?, ?, ?)`
                )
                .run("Qm123", JSON.stringify({ subplebbit: { postScore: 50, replyScore: 25 } }), baseTimestamp, baseTimestamp + 100);

            const result = combinedData.getAuthorKarmaBySubplebbit("testAuthorPublicKey");
            expect(result.size).toBe(1);
            // Should use the indexer data since it has a more recent updatedAt
            expect(result.get("sub1.eth")).toEqual({ postScore: 50, replyScore: 25 });
        });

        it("should merge karma from different subplebbits in both sources", () => {
            // Engine has data for sub1
            db.insertChallengeSession({
                sessionId: "karma-3",
                subplebbitPublicKey: "subKey",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "karma-3",
                publication: {
                    author: {
                        address: "author1",
                        subplebbit: { postScore: 10, replyScore: 5 }
                    },
                    subplebbitAddress: "sub1.eth",
                    timestamp: baseTimestamp,
                    signature: baseSignature,
                    protocolVersion: "1"
                }
            });

            // Indexer has data for sub2
            const rawDb = db.getDb();
            rawDb
                .prepare(
                    `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`
                )
                .run(
                    "Qm123",
                    "sub2.eth",
                    JSON.stringify({ address: "author1" }),
                    JSON.stringify(baseSignature),
                    baseTimestamp,
                    baseTimestamp
                );

            rawDb
                .prepare(
                    `INSERT INTO indexed_comments_update (cid, author, fetchedAt)
                 VALUES (?, ?, ?)`
                )
                .run("Qm123", JSON.stringify({ subplebbit: { postScore: 20, replyScore: 15 } }), baseTimestamp);

            const result = combinedData.getAuthorKarmaBySubplebbit("testAuthorPublicKey");
            expect(result.size).toBe(2);
            expect(result.get("sub1.eth")).toEqual({ postScore: 10, replyScore: 5 });
            expect(result.get("sub2.eth")).toEqual({ postScore: 20, replyScore: 15 });
        });
    });

    describe("getAuthorVelocityStats", () => {
        it("should return zero counts for unknown author", () => {
            const result = combinedData.getAuthorVelocityStats("unknownAuthor", "post");
            expect(result).toEqual({ lastHour: 0, last24Hours: 0 });
        });

        it("should sum counts from both engine and indexer for posts", () => {
            // Add 2 posts to engine
            for (let i = 0; i < 2; i++) {
                const sessionId = `vel-post-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "subKey",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: { address: "author1" },
                        subplebbitAddress: "sub1.eth",
                        timestamp: baseTimestamp - 100 - i,
                        signature: baseSignature,
                        protocolVersion: "1"
                        // No parentCid = this is a post
                    }
                });
            }

            // Add 3 posts to indexer (recent timestamp)
            const rawDb = db.getDb();
            for (let i = 0; i < 3; i++) {
                rawDb
                    .prepare(
                        `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, parentCid)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(
                        `Qm${i}`,
                        "sub2.eth",
                        JSON.stringify({ address: "author1" }),
                        JSON.stringify(baseSignature),
                        baseTimestamp - 200 - i,
                        baseTimestamp,
                        null
                    );
            }

            const result = combinedData.getAuthorVelocityStats("testAuthorPublicKey", "post");
            // Should sum: 2 from engine + 3 from indexer = 5 total
            expect(result.lastHour).toBe(5);
            expect(result.last24Hours).toBe(5);
        });

        it("should only count from engine for votes (indexer does not track votes)", () => {
            // Add votes to engine
            for (let i = 0; i < 5; i++) {
                const sessionId = `vel-vote-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "subKey",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertVote({
                    sessionId,
                    publication: {
                        author: { address: "author1" },
                        subplebbitAddress: "sub1.eth",
                        timestamp: baseTimestamp - 100 - i,
                        signature: baseSignature,
                        protocolVersion: "1",
                        commentCid: `Qm${i}`,
                        vote: 1
                    }
                });
            }

            const result = combinedData.getAuthorVelocityStats("testAuthorPublicKey", "vote");
            // Should only count from engine since indexer doesn't track votes
            expect(result.lastHour).toBe(5);
            expect(result.last24Hours).toBe(5);
        });
    });

    describe("findLinksByAuthor", () => {
        it("should return 0 for unknown author", () => {
            const result = combinedData.findLinksByAuthor({
                authorPublicKey: "unknownAuthor",
                link: "https://example.com",
                sinceTimestamp: baseTimestamp - 86400
            });
            expect(result).toBe(0);
        });

        it("should sum link counts from both engine and indexer", () => {
            // Add 2 links to engine
            for (let i = 0; i < 2; i++) {
                const sessionId = `link-author-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "subKey",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: { address: "author1" },
                        subplebbitAddress: "sub1.eth",
                        timestamp: baseTimestamp - 100 - i,
                        signature: baseSignature,
                        protocolVersion: "1",
                        link: "https://example.com"
                    }
                });
            }

            // Add 3 links to indexer
            const rawDb = db.getDb();
            for (let i = 0; i < 3; i++) {
                rawDb
                    .prepare(
                        `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, link)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(
                        `Qm${i}`,
                        "sub2.eth",
                        JSON.stringify({ address: "author1" }),
                        JSON.stringify(baseSignature),
                        baseTimestamp - 200 - i,
                        baseTimestamp,
                        "https://example.com"
                    );
            }

            const result = combinedData.findLinksByAuthor({
                authorPublicKey: "testAuthorPublicKey",
                link: "https://example.com",
                sinceTimestamp: baseTimestamp - 86400
            });
            // Should sum: 2 from engine + 3 from indexer = 5 total
            expect(result).toBe(5);
        });
    });

    describe("findLinksByOthers", () => {
        it("should return counts from both sources excluding the specified author", () => {
            const otherAuthorSignature = { ...baseSignature, publicKey: "otherAuthorPublicKey" };

            // Add links from other author to engine
            for (let i = 0; i < 2; i++) {
                const sessionId = `link-other-${i}`;
                db.insertChallengeSession({
                    sessionId,
                    subplebbitPublicKey: "subKey",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId,
                    publication: {
                        author: { address: "author2" },
                        subplebbitAddress: "sub1.eth",
                        timestamp: baseTimestamp - 100 - i,
                        signature: otherAuthorSignature,
                        protocolVersion: "1",
                        link: "https://spam.com"
                    }
                });
            }

            // Add links from other author to indexer
            const rawDb = db.getDb();
            for (let i = 0; i < 2; i++) {
                rawDb
                    .prepare(
                        `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, link)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                    )
                    .run(
                        `Qm${i}`,
                        "sub2.eth",
                        JSON.stringify({ address: "author2" }),
                        JSON.stringify(otherAuthorSignature),
                        baseTimestamp - 200 - i,
                        baseTimestamp,
                        "https://spam.com"
                    );
            }

            const result = combinedData.findLinksByOthers({
                excludeAuthorPublicKey: "testAuthorPublicKey",
                link: "https://spam.com",
                sinceTimestamp: baseTimestamp - 86400
            });

            // Should count from both sources
            expect(result.count).toBe(4);
        });
    });
});
