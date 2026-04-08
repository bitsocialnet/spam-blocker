import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateCommentContentTitleRisk } from "../../src/risk-score/factors/comment-content-title-risk.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

const baseTimestamp = Math.floor(Date.now() / 1000);
const baseSignature = {
    type: "ed25519",
    signature: "sig",
    publicKey: "pk",
    signedPropertyNames: ["author"]
};

function createMockChallengeRequest(
    authorAddress: string,
    content?: string,
    title?: string,
    parentCid?: string
): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        comment: {
            author: {
                address: authorAddress
            },
            communityAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            content,
            title,
            parentCid
        }
    } as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

function createMockVoteChallengeRequest(authorAddress: string): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    return {
        challengeRequestId: { bytes: new Uint8Array() },
        acceptedChallengeTypes: ["turnstile"],
        encrypted: {} as never,
        vote: {
            author: {
                address: authorAddress
            },
            communityAddress: "test-sub.eth",
            timestamp: baseTimestamp,
            protocolVersion: "1",
            signature: baseSignature,
            commentCid: "QmTest",
            vote: 1
        }
    } as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

describe("calculateCommentContentTitleRisk", () => {
    let db: SpamDetectionDatabase;
    let combinedData: CombinedDataService;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
        combinedData = new CombinedDataService(db);
    });

    afterEach(() => {
        db.close();
    });

    describe("non-comment publications", () => {
        it("should return neutral score for vote publications", () => {
            const challengeRequest = createMockVoteChallengeRequest("author1");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            // Non-comment publications are skipped (weight=0), so score is 0
            expect(result.score).toBe(0);
            expect(result.weight).toBe(0);
            expect(result.name).toBe("commentContentTitleRisk");
            expect(result.explanation).toContain("not applicable");
        });
    });

    describe("content without duplicates", () => {
        it("should return low risk score for unique content", () => {
            const challengeRequest = createMockChallengeRequest(
                "author1",
                "This is a unique comment that has never been posted before.",
                "Unique Title"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBe(0.2); // Base low risk
            expect(result.explanation).toContain("no suspicious patterns");
        });
    });

    describe("duplicate content from same author", () => {
        it("should detect exact duplicate content from same author", () => {
            const authorAddress = "author1";
            const duplicateContent = "This is spam content that will be posted multiple times.";

            // Add existing comment with same content
            db.insertChallengeSession({
                sessionId: "prev-comment-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "prev-comment-1",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: baseSignature,
                    content: duplicateContent
                }
            });

            const challengeRequest = createMockChallengeRequest(authorAddress, duplicateContent);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("duplicate");
            expect(result.explanation).toContain("same author");
        });

        it("should increase risk score with more duplicates", () => {
            const authorAddress = "author1";
            const duplicateContent = "This is spam content that will be posted multiple times.";

            // Add 5 existing comments with same content
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `prev-comment-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `prev-comment-${i}`,
                    publication: {
                        author: { address: authorAddress },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        content: duplicateContent
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(authorAddress, duplicateContent);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThanOrEqual(0.55);
            expect(result.explanation).toContain("5 duplicate");
        });

        it("should detect similar (not exact) content from same author via Jaccard similarity", () => {
            const authorAddress = "author1";
            // The SQL query uses Jaccard similarity (word overlap) to find similar content
            const originalContent = "Check out this amazing cryptocurrency investment opportunity";
            const similarContent = "Check out this amazing cryptocurrency investment opportunity for big profits today!";
            // These have high word overlap, so Jaccard similarity will find them

            // Add existing comment with similar content
            db.insertChallengeSession({
                sessionId: "prev-similar-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "prev-similar-1",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: baseSignature,
                    content: originalContent
                }
            });

            const challengeRequest = createMockChallengeRequest(authorAddress, similarContent);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("similar");
        });
    });

    describe("duplicate content from different authors", () => {
        it("should detect exact duplicate content from other authors (coordinated spam)", () => {
            const currentAuthor = "author1";
            const otherAuthor = "author2";
            const spamContent = "Buy crypto now! Visit our website for guaranteed returns!";
            // Different public key for other author
            const otherSignature = { ...baseSignature, publicKey: "author2-pk" };

            // Add existing comment from different author with same content
            db.insertChallengeSession({
                sessionId: "other-author-spam",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "other-author-spam",
                publication: {
                    author: { address: otherAuthor },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: otherSignature,
                    content: spamContent
                }
            });

            const challengeRequest = createMockChallengeRequest(currentAuthor, spamContent);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("another author");
        });

        it("should increase risk for multiple authors posting same content", () => {
            const currentAuthor = "author1";
            const spamContent = "This is coordinated spam being posted by multiple accounts.";

            // Add same content from 5 different authors (each with unique public key)
            for (let i = 2; i <= 6; i++) {
                const authorSignature = { ...baseSignature, publicKey: `author${i}-pk` };
                db.insertChallengeSession({
                    sessionId: `coord-spam-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `coord-spam-${i}`,
                    publication: {
                        author: { address: `author${i}` },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: authorSignature,
                        content: spamContent
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(currentAuthor, spamContent);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThanOrEqual(0.6);
            expect(result.explanation).toContain("coordinated spam");
        });
    });

    describe("duplicate titles", () => {
        it("should detect duplicate titles from same author", () => {
            const authorAddress = "author1";
            const duplicateTitle = "Breaking News: Major Announcement!";

            // Add existing post with same title
            db.insertChallengeSession({
                sessionId: "prev-title-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "prev-title-1",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: baseSignature,
                    title: duplicateTitle,
                    content: "Some content"
                }
            });

            const challengeRequest = createMockChallengeRequest(authorAddress, "Different content", duplicateTitle);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("same title");
        });

        it("should detect duplicate titles from other authors", () => {
            const currentAuthor = "author1";
            const otherAuthor = "author2";
            const spamTitle = "Get Rich Quick With This One Simple Trick";
            // Different public key for other author
            const otherSignature = { ...baseSignature, publicKey: "author2-pk" };

            db.insertChallengeSession({
                sessionId: "other-title-spam",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "other-title-spam",
                publication: {
                    author: { address: otherAuthor },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: otherSignature,
                    title: spamTitle,
                    content: "Content"
                }
            });

            const challengeRequest = createMockChallengeRequest(currentAuthor, "Different content", spamTitle);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("another author");
        });
    });

    describe("time window filtering", () => {
        it("should not detect old duplicates outside 24h window", () => {
            const authorAddress = "author1";
            const content = "This is duplicate content but posted long ago.";
            const twoDaysAgo = baseTimestamp - 2 * 24 * 60 * 60;

            // Add old comment outside 24h window
            db.insertChallengeSession({
                sessionId: "old-comment",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "old-comment",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: twoDaysAgo,
                    protocolVersion: "1",
                    signature: baseSignature,
                    content
                }
            });
            // Set receivedAt to 2 days ago (DB stores milliseconds)
            db.getDb()
                .prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?")
                .run(twoDaysAgo * 1000, "old-comment");

            const challengeRequest = createMockChallengeRequest(authorAddress, content);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            // Should not detect old duplicates
            expect(result.score).toBe(0.2);
            expect(result.explanation).toContain("no suspicious patterns");
        });
    });

    describe("static content analysis", () => {
        it("should detect excessive URLs", () => {
            const content = `
                Check out these links:
                https://spam1.com
                https://spam2.com
                https://spam3.com
                https://spam4.com
                https://spam5.com
            `;

            const challengeRequest = createMockChallengeRequest("author1", content);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("5 URLs");
        });

        it("should detect excessive capitalization", () => {
            const content = "THIS IS ALL CAPS TEXT THAT IS VERY SHOUTY AND ANNOYING TO READ";

            const challengeRequest = createMockChallengeRequest("author1", content);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("excessive capitalization");
        });

        it("should detect repetitive patterns", () => {
            const content = "Buy now!!!!!! This is amazing amazing amazing amazing amazing product";

            const challengeRequest = createMockChallengeRequest("author1", content);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentContentTitleRisk(ctx, 0.18);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("repetitive");
        });
    });

    describe("database similarity methods", () => {
        it("findSimilarContentByAuthor should return matching comments", () => {
            const authorPublicKey = "author1-pk";
            const content = "This is test content for similarity matching.";
            const signature = { ...baseSignature, publicKey: authorPublicKey };

            db.insertChallengeSession({
                sessionId: "similar-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "similar-1",
                publication: {
                    author: { address: "author1" },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature,
                    content
                }
            });

            // Query by signature public key (not author address)
            const results = db.findSimilarContentByAuthor({
                authorPublicKey,
                content,
                sinceTimestamp: baseTimestamp - 86400
            });

            expect(results.length).toBe(1);
            expect(results[0].content).toBe(content);
        });

        it("findSimilarContentByOthers should return matching comments from other authors", () => {
            const authorPublicKey = "author1-pk";
            const otherAuthorPublicKey = "author2-pk";
            const content = "This is test content for cross-author similarity matching.";
            const otherSignature = { ...baseSignature, publicKey: otherAuthorPublicKey };

            db.insertChallengeSession({
                sessionId: "other-similar-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "other-similar-1",
                publication: {
                    author: { address: "author2" },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: otherSignature,
                    content
                }
            });

            // Query by signature public key (not author address)
            const results = db.findSimilarContentByOthers({
                authorPublicKey,
                content,
                sinceTimestamp: baseTimestamp - 86400
            });

            expect(results.length).toBe(1);
            expect(results[0].content).toBe(content);
            expect(results[0].authorPublicKey).toBe(otherAuthorPublicKey);
        });

        it("findSimilarContentByOthers should not return comments from same author", () => {
            const authorPublicKey = "author1-pk";
            const content = "This is test content.";
            const signature = { ...baseSignature, publicKey: authorPublicKey };

            db.insertChallengeSession({
                sessionId: "same-author-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "same-author-1",
                publication: {
                    author: { address: "author1" },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature,
                    content
                }
            });

            // Query by signature public key (not author address)
            const results = db.findSimilarContentByOthers({
                authorPublicKey,
                content,
                sinceTimestamp: baseTimestamp - 86400
            });

            expect(results.length).toBe(0);
        });
    });
});
