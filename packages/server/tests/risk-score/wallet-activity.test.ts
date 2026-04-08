import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calculateWalletActivity } from "../../src/risk-score/factors/wallet-activity.js";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CombinedDataService } from "../../src/risk-score/combined-data-service.js";
import type { RiskContext } from "../../src/risk-score/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

// Helper to create a mock challenge request
function createMockChallengeRequest({
    authorPublicKey,
    wallets
}: {
    authorPublicKey: string;
    wallets?: Record<string, { address: string; timestamp: number; signature: { signature: string; type: string } }>;
}): DecryptedChallengeRequestMessageTypeWithCommunityAuthor {
    const author: Record<string, unknown> = {
        address: "12D3KooWTestAuthor",
        community: { postScore: 0, replyScore: 0 }
    };

    if (wallets) {
        author.wallets = wallets;
    }

    return {
        comment: {
            author,
            communityAddress: "test-sub.eth",
            timestamp: Math.floor(Date.now() / 1000),
            protocolVersion: "1",
            content: "test content",
            signature: {
                publicKey: authorPublicKey,
                signature: "mock-sig",
                type: "ed25519",
                signedPropertyNames: ["author", "communityAddress", "timestamp", "protocolVersion", "content"]
            }
        }
    } as unknown as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
}

// Helper to create RiskContext
function createContext(db: SpamDetectionDatabase, challengeRequest: DecryptedChallengeRequestMessageTypeWithCommunityAuthor): RiskContext {
    return {
        challengeRequest,
        now: Math.floor(Date.now() / 1000),
        hasIpInfo: false,
        db,
        combinedData: new CombinedDataService(db)
    };
}

// Helper to seed a publication from a different author with a specific wallet
function seedPublicationWithWallet(db: SpamDetectionDatabase, authorPublicKey: string, walletAddress: string): void {
    const sessionId = `seed-${Math.random().toString(36).slice(2)}`;
    db.insertChallengeSession({
        sessionId,
        communityPublicKey: "test-community-pubkey",
        expiresAt: Date.now() + 3600000
    });
    db.insertComment({
        sessionId,
        publication: {
            author: {
                address: "12D3KooWOtherAuthor",
                wallets: {
                    eth: {
                        address: walletAddress,
                        timestamp: Math.floor(Date.now() / 1000),
                        signature: { signature: "other-sig", type: "eip191" }
                    }
                }
            },
            communityAddress: "test-sub.eth",
            signature: { publicKey: authorPublicKey, signature: `sig-${sessionId}`, type: "ed25519" },
            protocolVersion: "1",
            content: "test",
            timestamp: Math.floor(Date.now() / 1000)
        }
    });
}

describe("calculateWalletActivity", () => {
    let db: SpamDetectionDatabase;

    beforeEach(() => {
        db = new SpamDetectionDatabase({ path: ":memory:" });
    });

    afterEach(() => {
        db.close();
    });

    describe("skip behavior", () => {
        it("should skip when author has no wallets", () => {
            const request = createMockChallengeRequest({ authorPublicKey: "pubkey-no-wallet" });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({ ctx, weight: 0.06 });

            expect(result.name).toBe("walletVerification");
            expect(result.weight).toBe(0);
            expect(result.score).toBe(0.5);
            expect(result.explanation).toContain("No wallet data");
        });

        it("should skip when walletTransactionCounts is undefined", () => {
            const request = createMockChallengeRequest({
                authorPublicKey: "pubkey-1",
                wallets: {
                    eth: {
                        address: "0x1234567890abcdef1234567890abcdef12345678",
                        timestamp: 1000,
                        signature: { signature: "sig", type: "eip191" }
                    }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({ ctx, weight: 0.06 });

            expect(result.weight).toBe(0);
            expect(result.score).toBe(0.5);
        });

        it("should skip when walletTransactionCounts is empty", () => {
            const request = createMockChallengeRequest({
                authorPublicKey: "pubkey-2",
                wallets: {
                    eth: {
                        address: "0x1234567890abcdef1234567890abcdef12345678",
                        timestamp: 1000,
                        signature: { signature: "sig", type: "eip191" }
                    }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({ ctx, weight: 0.06, walletTransactionCounts: {} });

            expect(result.weight).toBe(0);
            expect(result.score).toBe(0.5);
        });

        it("should skip when nonce is 0", () => {
            const walletAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            const request = createMockChallengeRequest({
                authorPublicKey: "pubkey-zero-nonce",
                wallets: {
                    eth: { address: walletAddr, timestamp: 1000, signature: { signature: "sig", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: { [walletAddr]: 0 }
            });

            expect(result.weight).toBe(0);
            expect(result.explanation).toContain("no transaction history");
        });
    });

    describe("nonce-to-score mapping", () => {
        const walletAddr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

        function runWithNonce(nonce: number) {
            const request = createMockChallengeRequest({
                authorPublicKey: "pubkey-nonce-test",
                wallets: {
                    eth: { address: walletAddr, timestamp: 1000, signature: { signature: "sig", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            return calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: { [walletAddr]: nonce }
            });
        }

        it("should return 0.35 for 1-10 transactions", () => {
            expect(runWithNonce(1).score).toBe(0.35);
            expect(runWithNonce(5).score).toBe(0.35);
            expect(runWithNonce(10).score).toBe(0.35);
        });

        it("should return 0.25 for 11-50 transactions", () => {
            expect(runWithNonce(11).score).toBe(0.25);
            expect(runWithNonce(30).score).toBe(0.25);
            expect(runWithNonce(50).score).toBe(0.25);
        });

        it("should return 0.15 for 51-200 transactions", () => {
            expect(runWithNonce(51).score).toBe(0.15);
            expect(runWithNonce(100).score).toBe(0.15);
            expect(runWithNonce(200).score).toBe(0.15);
        });

        it("should return 0.10 for 200+ transactions", () => {
            expect(runWithNonce(201).score).toBe(0.1);
            expect(runWithNonce(1000).score).toBe(0.1);
            expect(runWithNonce(50000).score).toBe(0.1);
        });

        it("should have correct weight when active", () => {
            const result = runWithNonce(100);
            expect(result.weight).toBe(0.06);
        });
    });

    describe("1-to-1 wallet-author enforcement", () => {
        it("should count wallet normally when only used by current author", () => {
            const walletAddr = "0xcccccccccccccccccccccccccccccccccccccccc";
            const authorPubKey = "pubkey-exclusive";

            // Seed a publication from the SAME author with this wallet
            seedPublicationWithWallet(db, authorPubKey, walletAddr);

            const request = createMockChallengeRequest({
                authorPublicKey: authorPubKey,
                wallets: {
                    eth: { address: walletAddr, timestamp: 1000, signature: { signature: "sig", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: { [walletAddr]: 100 }
            });

            expect(result.weight).toBe(0.06);
            expect(result.score).toBe(0.15); // 51-200 tier
        });

        it("should discard wallet when used by a different author", () => {
            const walletAddr = "0xdddddddddddddddddddddddddddddddddddddd";
            const currentAuthorPubKey = "pubkey-current";
            const otherAuthorPubKey = "pubkey-other";

            // Seed a publication from a DIFFERENT author with this wallet
            seedPublicationWithWallet(db, otherAuthorPubKey, walletAddr);

            const request = createMockChallengeRequest({
                authorPublicKey: currentAuthorPubKey,
                wallets: {
                    eth: { address: walletAddr, timestamp: 1000, signature: { signature: "sig", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: { [walletAddr]: 500 }
            });

            // Wallet is discarded, factor should be skipped
            expect(result.weight).toBe(0);
            expect(result.explanation).toContain("discarded");
        });

        it("should skip when all wallets are used by other authors", () => {
            const wallet1 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
            const wallet2 = "0xffffffffffffffffffffffffffffffffffffffff";
            const currentAuthorPubKey = "pubkey-all-discarded";
            const otherPubKey = "pubkey-thief";

            // Both wallets used by another author
            seedPublicationWithWallet(db, otherPubKey, wallet1);
            seedPublicationWithWallet(db, otherPubKey, wallet2);

            const request = createMockChallengeRequest({
                authorPublicKey: currentAuthorPubKey,
                wallets: {
                    eth: { address: wallet1, timestamp: 1000, signature: { signature: "sig1", type: "eip191" } },
                    matic: { address: wallet2, timestamp: 1000, signature: { signature: "sig2", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: {
                    [wallet1]: 300,
                    [wallet2]: 200
                }
            });

            expect(result.weight).toBe(0);
            expect(result.explanation).toContain("discarded");
        });
    });

    describe("best wallet selection", () => {
        it("should use the wallet with the highest nonce", () => {
            const wallet1 = "0x1111111111111111111111111111111111111111";
            const wallet2 = "0x2222222222222222222222222222222222222222";
            const authorPubKey = "pubkey-best-wallet";

            const request = createMockChallengeRequest({
                authorPublicKey: authorPubKey,
                wallets: {
                    eth: { address: wallet1, timestamp: 1000, signature: { signature: "sig1", type: "eip191" } },
                    matic: { address: wallet2, timestamp: 1000, signature: { signature: "sig2", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: {
                    [wallet1]: 5, // Low tier (0.35)
                    [wallet2]: 300 // Very strong tier (0.10)
                }
            });

            // Should use wallet2 (300 nonce) → very strong (0.10)
            expect(result.score).toBe(0.1);
            expect(result.weight).toBe(0.06);
        });

        it("should skip invalid wallets and use remaining valid one", () => {
            const wallet1 = "0x3333333333333333333333333333333333333333";
            const wallet2 = "0x4444444444444444444444444444444444444444";
            const currentPubKey = "pubkey-partial-valid";
            const otherPubKey = "pubkey-stealer";

            // wallet1 used by another author
            seedPublicationWithWallet(db, otherPubKey, wallet1);

            const request = createMockChallengeRequest({
                authorPublicKey: currentPubKey,
                wallets: {
                    eth: { address: wallet1, timestamp: 1000, signature: { signature: "sig1", type: "eip191" } },
                    matic: { address: wallet2, timestamp: 1000, signature: { signature: "sig2", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: {
                    [wallet1]: 1000, // Very strong but discarded
                    [wallet2]: 25 // Moderate tier (0.25)
                }
            });

            // wallet1 discarded, wallet2 used → moderate (0.25)
            expect(result.score).toBe(0.25);
            expect(result.weight).toBe(0.06);
        });
    });

    describe("explanation content", () => {
        it("should include truncated wallet address and transaction count", () => {
            const walletAddr = "0xabcdef1234567890abcdef1234567890abcdef12";
            const request = createMockChallengeRequest({
                authorPublicKey: "pubkey-explain",
                wallets: {
                    eth: { address: walletAddr, timestamp: 1000, signature: { signature: "sig", type: "eip191" } }
                }
            });
            const ctx = createContext(db, request);

            const result = calculateWalletActivity({
                ctx,
                weight: 0.06,
                walletTransactionCounts: { [walletAddr]: 75 }
            });

            expect(result.explanation).toContain("0xabcd...ef12");
            expect(result.explanation).toContain("75 transactions");
            expect(result.explanation).toContain("strong activity");
        });
    });
});
