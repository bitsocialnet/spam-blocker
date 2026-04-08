import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateCommentUrlRisk } from "../../src/risk-score/factors/comment-url-risk.js";
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
    link?: string,
    content?: string,
    title?: string,
    parentCid?: string,
    publicKey?: string
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
            signature: publicKey ? { ...baseSignature, publicKey } : baseSignature,
            content,
            title,
            link,
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

describe("calculateCommentUrlRisk", () => {
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

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Non-comment publications are skipped (weight=0), so score is 0
            expect(result.score).toBe(0);
            expect(result.weight).toBe(0);
            expect(result.name).toBe("commentUrlRisk");
            expect(result.explanation).toContain("not applicable");
        });
    });

    describe("comments without URLs", () => {
        it("should return low risk score for comment without any URLs", () => {
            const challengeRequest = createMockChallengeRequest("author1", undefined, "Just some text content without URLs");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // No URLs is a positive signal (lower risk)
            expect(result.score).toBe(0.2);
            expect(result.explanation).toContain("no URLs found");
        });
    });

    describe("URL extraction from different sources", () => {
        it("should extract URL from link field", () => {
            const challengeRequest = createMockChallengeRequest("author1", "https://example.com/page");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBe(0.2); // Base low risk for URL
            expect(result.explanation).toContain("no suspicious patterns");
        });

        it("should extract URL from content", () => {
            const challengeRequest = createMockChallengeRequest(
                "author1",
                undefined,
                "Check out https://example.com/article for more info"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBe(0.2); // Base low risk for URL
        });

        it("should extract URL from title", () => {
            const challengeRequest = createMockChallengeRequest("author1", undefined, undefined, "My post about https://crypto.com");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBe(0.2); // Base low risk for URL
        });

        it("should extract URLs from all sources combined", () => {
            const challengeRequest = createMockChallengeRequest(
                "author1",
                "https://link-field.com/page",
                "Content with https://content-url.com/article",
                "Title with https://title-url.com/page"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Should analyze all URLs
            expect(result.score).toBeGreaterThanOrEqual(0.2);
        });

        it("should not double count same URL in link and content", () => {
            const url = "https://example.com/page";
            const challengeRequest = createMockChallengeRequest("author1", url, `Check out ${url} again`);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Should only count once
            expect(result.score).toBe(0.2);
        });
    });

    describe("duplicate URLs from same author", () => {
        it("should detect same URL posted multiple times by same author", () => {
            const authorAddress = "author1";
            const spamLink = "https://spam-site.com/affiliate";

            // Add existing comment with same link
            db.insertChallengeSession({
                sessionId: "prev-link-1",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "prev-link-1",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: baseSignature,
                    link: spamLink
                }
            });

            const challengeRequest = createMockChallengeRequest(authorAddress, spamLink);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("same URL from author");
        });

        it("should increase risk with more duplicate URLs", () => {
            const authorAddress = "author1";
            const spamLink = "https://spam-site.com/affiliate";

            // Add 5 existing comments with same link
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `prev-link-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `prev-link-${i}`,
                    publication: {
                        author: { address: authorAddress },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        link: spamLink
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(authorAddress, spamLink);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThanOrEqual(0.6);
            expect(result.explanation).toContain("5 posts with same URL");
        });
    });

    describe("duplicate URLs from different authors", () => {
        it("should detect same URL posted by other authors (coordinated spam)", () => {
            const currentAuthor = "author1";
            const otherAuthor = "author2";
            const spamLink = "https://coordinated-spam.com/scam";
            const otherSignature = { ...baseSignature, publicKey: "author2-pk" };

            db.insertChallengeSession({
                sessionId: "other-author-link",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "other-author-link",
                publication: {
                    author: { address: otherAuthor },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: otherSignature,
                    link: spamLink
                }
            });

            const challengeRequest = createMockChallengeRequest(currentAuthor, spamLink);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("another author");
        });

        it("should increase risk for multiple authors posting same URL", () => {
            const currentAuthor = "author1";
            const spamLink = "https://coordinated-campaign.com/spam";

            // Add same link from 10 different authors
            for (let i = 2; i <= 11; i++) {
                const authorSignature = { ...baseSignature, publicKey: `author${i}-pk` };
                db.insertChallengeSession({
                    sessionId: `coord-link-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `coord-link-${i}`,
                    publication: {
                        author: { address: `author${i}` },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: authorSignature,
                        link: spamLink
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(currentAuthor, spamLink);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThanOrEqual(0.7);
            expect(result.explanation).toContain("coordinated spam");
        });
    });

    describe("IP address URLs", () => {
        it("should detect IP address URLs", () => {
            const challengeRequest = createMockChallengeRequest("author1", "http://192.168.1.1/malware");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("IP address");
        });
    });

    describe("similar URL detection (prefix matching)", () => {
        it("should detect similar URLs from same author", () => {
            const authorAddress = "author1";

            // Add 5 comments with similar URLs (same prefix, different query params)
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `similar-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `similar-${i}`,
                    publication: {
                        author: { address: authorAddress },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        link: `https://spam-site.com/promo/deal?ref=${i}`
                    }
                });
            }

            // New comment with similar URL
            const challengeRequest = createMockChallengeRequest(authorAddress, "https://spam-site.com/promo/deal?ref=new");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("similar URLs");
        });

        it("should detect coordinated campaign with URL rotation and time clustering", () => {
            // Add 5 similar URLs from 5 different authors, posted within minutes of each other
            // All URLs share the same prefix: scam-site.com/offer/promo
            // but have different query params (simulating referral link rotation)
            for (let i = 1; i <= 5; i++) {
                const authorSignature = { ...baseSignature, publicKey: `author${i}-pk` };
                db.insertChallengeSession({
                    sessionId: `coord-similar-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `coord-similar-${i}`,
                    publication: {
                        author: { address: `author${i}` },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 300 - i * 60, // Posts 1-5 minutes apart (tight clustering)
                        protocolVersion: "1",
                        signature: authorSignature,
                        link: `https://scam-site.com/offer/promo?ref=author${i}`
                    }
                });
            }

            // New author posting similar URL (same prefix: scam-site.com/offer/promo)
            const challengeRequest = createMockChallengeRequest(
                "newauthor",
                "https://scam-site.com/offer/promo?ref=newauthor",
                undefined,
                undefined,
                undefined,
                "newauthor-pk"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.5); // High risk due to time clustering
            expect(result.explanation).toContain("clustered in time");
            expect(result.explanation).toContain("coordinated campaign");
        });
    });

    describe("time clustering detection", () => {
        it("should flag tightly clustered posts from multiple authors as high risk", () => {
            // 5 authors posting similar URLs within 5 minutes
            for (let i = 1; i <= 5; i++) {
                const authorSignature = { ...baseSignature, publicKey: `cluster-author${i}-pk` };
                db.insertChallengeSession({
                    sessionId: `cluster-tight-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `cluster-tight-${i}`,
                    publication: {
                        author: { address: `cluster-author${i}` },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 100 - i * 60, // 1 minute apart
                        protocolVersion: "1",
                        signature: authorSignature,
                        link: `https://spam-burst.com/promo/deal?ref=${i}`
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(
                "newclusterauthor",
                "https://spam-burst.com/promo/deal?ref=new",
                undefined,
                undefined,
                undefined,
                "newclusterauthor-pk"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.score).toBeGreaterThan(0.5); // High risk
            expect(result.explanation).toContain("clustered in time");
        });

        it("should flag posts spread over many hours with lower risk", () => {
            // 5 authors posting similar URLs spread widely over 22+ hours
            // to get stddev > 6 hours (spread out pattern)
            const hour = 3600;
            const timestamps = [
                baseTimestamp - 1 * hour, // 1h ago
                baseTimestamp - 6 * hour, // 6h ago
                baseTimestamp - 12 * hour, // 12h ago
                baseTimestamp - 18 * hour, // 18h ago
                baseTimestamp - 23 * hour // 23h ago
            ];

            for (let i = 0; i < 5; i++) {
                const authorSignature = { ...baseSignature, publicKey: `spread-author${i + 1}-pk` };
                db.insertChallengeSession({
                    sessionId: `cluster-spread-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `cluster-spread-${i}`,
                    publication: {
                        author: { address: `spread-author${i + 1}` },
                        communityAddress: "test-sub.eth",
                        timestamp: timestamps[i],
                        protocolVersion: "1",
                        signature: authorSignature,
                        link: `https://popular-article.com/news/story?share=${i + 1}`
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest(
                "newspreadauthor",
                "https://popular-article.com/news/story?share=new",
                undefined,
                undefined,
                undefined,
                "newspreadauthor-pk"
            );

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Should have lower risk because posts are spread out (organic sharing pattern)
            // Base 0.2 + 0.15 for spread out = 0.35
            expect(result.score).toBeLessThan(0.5);
            expect(result.explanation).toContain("spread over time");
        });
    });

    describe("allowlisted domains (no similarity detection)", () => {
        it("should NOT trigger similarity for different Twitter URLs", () => {
            // Add Twitter URLs from same author
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `twitter-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `twitter-${i}`,
                    publication: {
                        author: { address: "author1" },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        link: `https://x.com/VitalikButerin/status/${1000000 + i}`
                    }
                });
            }

            // New tweet from same user
            const challengeRequest = createMockChallengeRequest("author1", "https://x.com/VitalikButerin/status/9999999");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Should only have base risk, no similarity penalty
            expect(result.explanation).not.toContain("similar URLs");
        });

        it("should NOT trigger similarity for different YouTube videos", () => {
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `youtube-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `youtube-${i}`,
                    publication: {
                        author: { address: "author1" },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        link: `https://youtube.com/watch?v=video${i}`
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest("author1", "https://youtube.com/watch?v=newvideo");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.explanation).not.toContain("similar URLs");
        });

        it("should NOT trigger similarity for different GitHub issues", () => {
            for (let i = 0; i < 5; i++) {
                db.insertChallengeSession({
                    sessionId: `github-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `github-${i}`,
                    publication: {
                        author: { address: "author1" },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000 - i * 100,
                        protocolVersion: "1",
                        signature: baseSignature,
                        link: `https://github.com/user/repo/issues/${i}`
                    }
                });
            }

            const challengeRequest = createMockChallengeRequest("author1", "https://github.com/user/repo/issues/999");

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            expect(result.explanation).not.toContain("similar URLs");
        });

        it("should STILL detect exact URL matches on allowlisted domains", () => {
            const exactUrl = "https://x.com/VitalikButerin/status/123456789";

            // Add exact same URL
            db.insertChallengeSession({
                sessionId: "exact-twitter",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "exact-twitter",
                publication: {
                    author: { address: "author1" },
                    communityAddress: "test-sub.eth",
                    timestamp: baseTimestamp - 1000,
                    protocolVersion: "1",
                    signature: baseSignature,
                    link: exactUrl
                }
            });

            const challengeRequest = createMockChallengeRequest("author1", exactUrl);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Should detect exact duplicate even on allowlisted domain
            expect(result.score).toBeGreaterThan(0.2);
            expect(result.explanation).toContain("same URL from author");
        });
    });

    describe("time-independent detection", () => {
        it("should detect URLs even from old posts (no time window filtering)", () => {
            // With no time window, all historical URLs are now considered.
            // Time clustering is used to distinguish spam bursts from organic sharing.
            const authorAddress = "author1";
            const link = "https://example.com/article";
            const twoDaysAgo = baseTimestamp - 2 * 24 * 60 * 60;

            db.insertChallengeSession({
                sessionId: "old-link",
                communityPublicKey: "pk",
                expiresAt: baseTimestamp + 3600
            });
            db.insertComment({
                sessionId: "old-link",
                publication: {
                    author: { address: authorAddress },
                    communityAddress: "test-sub.eth",
                    timestamp: twoDaysAgo,
                    protocolVersion: "1",
                    signature: baseSignature,
                    link
                }
            });
            // Set receivedAt to 2 days ago
            db.getDb()
                .prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?")
                .run(twoDaysAgo * 1000, "old-link");

            const challengeRequest = createMockChallengeRequest(authorAddress, link);

            const ctx: RiskContext = {
                challengeRequest,
                now: baseTimestamp,
                hasIpInfo: false,
                db,
                combinedData
            };

            const result = calculateCommentUrlRisk(ctx, 0.12);

            // Now that there's no time window, the old link IS detected (1 prior post)
            // Even though it's old, it still counts toward duplicate detection
            expect(result.score).toBeGreaterThan(0.2); // base risk (0.2) + 0.15 for 1 post with same URL
            expect(result.explanation).toContain("same URL from author");
        });
    });

    describe("database methods", () => {
        it("findSimilarUrlsByAuthor should return count of matching prefixes", () => {
            const authorPublicKey = "author1-pk";
            const signature = { ...baseSignature, publicKey: authorPublicKey };

            // Add comments with similar URLs
            for (let i = 0; i < 3; i++) {
                db.insertChallengeSession({
                    sessionId: `similar-db-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `similar-db-${i}`,
                    publication: {
                        author: { address: "author1" },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000,
                        protocolVersion: "1",
                        signature,
                        link: `https://spam.com/promo/offer${i}`
                    }
                });
            }

            const count = db.findSimilarUrlsByAuthor({
                authorPublicKey,
                urlPrefix: "spam.com/promo",
                sinceTimestamp: (baseTimestamp - 86400) * 1000
            });

            expect(count).toBe(3);
        });

        it("findSimilarUrlsByOthers should return count and unique authors", () => {
            const authorPublicKey = "author1-pk";

            // Add similar URLs from 3 different authors
            for (let i = 2; i <= 4; i++) {
                const otherSignature = { ...baseSignature, publicKey: `author${i}-pk` };
                db.insertChallengeSession({
                    sessionId: `other-similar-${i}`,
                    communityPublicKey: "pk",
                    expiresAt: baseTimestamp + 3600
                });
                db.insertComment({
                    sessionId: `other-similar-${i}`,
                    publication: {
                        author: { address: `author${i}` },
                        communityAddress: "test-sub.eth",
                        timestamp: baseTimestamp - 1000,
                        protocolVersion: "1",
                        signature: otherSignature,
                        link: `https://spam.com/offer/deal${i}`
                    }
                });
            }

            const result = db.findSimilarUrlsByOthers({
                authorPublicKey,
                urlPrefix: "spam.com/offer",
                sinceTimestamp: (baseTimestamp - 86400) * 1000
            });

            expect(result.count).toBe(3);
            expect(result.uniqueAuthors).toBe(3);
        });
    });
});
