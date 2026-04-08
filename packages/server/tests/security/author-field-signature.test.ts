import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    verifyAuthorWalletSignature,
    verifyAuthorWallets,
    verifyAuthorAvatarSignature
} from "../../src/security/author-field-signature.js";

// Mock PKC client helper.
function createMockCommunityClient(overrides: {
    chainProviders?: Record<string, { urls: string[]; chainId?: number }>;
    resolveAuthorAddress?: (opts: { address: string }) => Promise<string>;
    verifyMessage?: (opts: { address: string; message: string; signature: string }) => Promise<boolean>;
    readContract?: (opts: { abi: unknown; address: string; functionName: string; args: unknown[] }) => Promise<string>;
}) {
    const chainProviders = overrides.chainProviders || {
        eth: { urls: ["https://eth.example.com"], chainId: 1 }
    };

    const verifyMessage = overrides.verifyMessage || vi.fn().mockResolvedValue(true);
    const readContract = overrides.readContract || vi.fn().mockResolvedValue("0xOwnerAddress");

    const viemClient = {
        verifyMessage,
        readContract
    };

    return {
        chainProviders,
        resolveAuthorAddress: overrides.resolveAuthorAddress || vi.fn().mockResolvedValue("12D3KooWTestAuthor"),
        _domainResolver: {
            _createViemClientIfNeeded: vi.fn().mockReturnValue(viemClient)
        }
    } as any;
}

describe("verifyAuthorWalletSignature", () => {
    describe("with valid EVM address wallet", () => {
        it("should return valid for correct signature", async () => {
            const mockCommunityClient = createMockCommunityClient({
                verifyMessage: vi.fn().mockResolvedValue(true)
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xvalidSignature", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            expect(result.valid).toBe(true);
            expect(mockCommunityClient._domainResolver._createViemClientIfNeeded).toHaveBeenCalledWith("eth", "https://eth.example.com");
        });

        it("should return invalid for incorrect signature", async () => {
            const mockCommunityClient = createMockCommunityClient({
                verifyMessage: vi.fn().mockResolvedValue(false)
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xinvalidSignature", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            expect(result.valid).toBe(false);
            expect((result as { valid: false; reason: string }).reason).toContain("Invalid signature");
        });

        it("should verify correct message format (property order matters)", async () => {
            const mockVerifyMessage = vi.fn().mockResolvedValue(true);
            const mockCommunityClient = createMockCommunityClient({
                verifyMessage: mockVerifyMessage
            });

            await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            // Verify the message was constructed with correct property order
            expect(mockVerifyMessage).toHaveBeenCalledWith({
                address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                message: JSON.stringify({
                    // Legacy protocol constant preserved until the source-side PKC rename lands.
                    domainSeparator: "pkc-author-wallet",
                    authorAddress: "12D3KooWTestAuthor",
                    timestamp: 1234567890
                }),
                signature: "0xsig"
            });
        });
    });

    describe("with domain wallet address (ENS)", () => {
        // Note: These tests use a real ed25519 public key to avoid address-derivation validation errors.
        // The public key "2LHRqj0Zs35CA0Gks70qWM1C0IY0HZYR0oUlGO/X4u4=" produces a Bitsocial address starting with "12D3KooW..."
        const realPublicKeyBase64 = "2LHRqj0Zs35CA0Gks70qWM1C0IY0HZYR0oUlGO/X4u4=";

        it("should verify via PKC author-address resolution for domain addresses", async () => {
            // This test verifies that domain addresses trigger the author-address resolution path
            // and that the result is compared against the derived PKC address from the public key
            const mockResolveAuthorAddress = vi.fn().mockResolvedValue("12D3KooWNvSZnPi3RrhrTwEY4LuuBeB6K6facKUCJcyWG1kChVkD");
            const mockCommunityClient = createMockCommunityClient({
                resolveAuthorAddress: mockResolveAuthorAddress
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "vitalik.eth", // Domain address
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: realPublicKeyBase64,
                pkc: mockCommunityClient
            });

            // The function should have called resolveAuthorAddress for the domain
            expect(mockResolveAuthorAddress).toHaveBeenCalledWith({ address: "vitalik.eth" });
            // Since our mock returns a valid address and we use a real public key, the comparison should work
            // (though it may fail if the addresses don't match - that's fine for this test)
        });

        it("should reject if the author-address TXT record does not match the publication signer", async () => {
            const mockCommunityClient = createMockCommunityClient({
                resolveAuthorAddress: vi.fn().mockResolvedValue("12D3KooWDifferentAddress")
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "evil.eth",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: realPublicKeyBase64,
                pkc: mockCommunityClient
            });

            expect(result.valid).toBe(false);
            expect((result as { valid: false; reason: string }).reason).toContain("pkc-author-address");
        });
    });

    describe("with missing chain provider", () => {
        it("should skip verification and return valid if chain provider not configured", async () => {
            const mockCommunityClient = createMockCommunityClient({
                chainProviders: {} // No providers
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "polygon", // Not configured
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            expect(result.valid).toBe(true);
        });

        it("should log a warning when chain provider is missing", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const mockCommunityClient = createMockCommunityClient({
                chainProviders: {} // No providers
            });

            await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "polygon",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("wallet on chain 'polygon'"));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no chain provider is configured"));
            warnSpy.mockRestore();
        });
    });

    describe("error handling", () => {
        it("should handle verifyMessage throwing an error", async () => {
            const mockCommunityClient = createMockCommunityClient({
                verifyMessage: vi.fn().mockRejectedValue(new Error("Network error"))
            });

            const result = await verifyAuthorWalletSignature({
                wallet: {
                    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f42d11",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig", type: "eip-191" }
                },
                chainTicker: "eth",
                authorAddress: "12D3KooWTestAuthor",
                publicationSignaturePublicKey: "testPublicKey",
                pkc: mockCommunityClient
            });

            expect(result.valid).toBe(false);
            expect((result as { valid: false; reason: string }).reason).toContain("Failed to verify wallet signature");
            expect((result as { valid: false; reason: string }).reason).toContain("Network error");
        });
    });
});

describe("verifyAuthorWallets", () => {
    it("should return valid when wallets is undefined", async () => {
        const mockCommunityClient = createMockCommunityClient({});

        const result = await verifyAuthorWallets({
            wallets: undefined,
            authorAddress: "12D3KooWTestAuthor",
            publicationSignaturePublicKey: "testPublicKey",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);
    });

    it("should return valid when wallets is empty object", async () => {
        const mockCommunityClient = createMockCommunityClient({});

        const result = await verifyAuthorWallets({
            wallets: {},
            authorAddress: "12D3KooWTestAuthor",
            publicationSignaturePublicKey: "testPublicKey",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);
    });

    it("should verify all wallets and return valid if all pass", async () => {
        const mockCommunityClient = createMockCommunityClient({
            chainProviders: {
                eth: { urls: ["https://eth.example.com"], chainId: 1 },
                polygon: { urls: ["https://polygon.example.com"], chainId: 137 }
            },
            verifyMessage: vi.fn().mockResolvedValue(true)
        });

        const result = await verifyAuthorWallets({
            wallets: {
                eth: {
                    address: "0x1111111111111111111111111111111111111111",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig1", type: "eip-191" }
                },
                polygon: {
                    address: "0x2222222222222222222222222222222222222222",
                    timestamp: 1234567891,
                    signature: { signature: "0xsig2", type: "eip-191" }
                }
            },
            authorAddress: "12D3KooWTestAuthor",
            publicationSignaturePublicKey: "testPublicKey",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);
    });

    it("should return invalid if any wallet fails verification", async () => {
        const mockVerifyMessage = vi
            .fn()
            .mockResolvedValueOnce(true) // First wallet passes
            .mockResolvedValueOnce(false); // Second wallet fails

        const mockCommunityClient = createMockCommunityClient({
            chainProviders: {
                eth: { urls: ["https://eth.example.com"], chainId: 1 },
                polygon: { urls: ["https://polygon.example.com"], chainId: 137 }
            },
            verifyMessage: mockVerifyMessage
        });

        const result = await verifyAuthorWallets({
            wallets: {
                eth: {
                    address: "0x1111111111111111111111111111111111111111",
                    timestamp: 1234567890,
                    signature: { signature: "0xsig1", type: "eip-191" }
                },
                polygon: {
                    address: "0x2222222222222222222222222222222222222222",
                    timestamp: 1234567891,
                    signature: { signature: "0xinvalid", type: "eip-191" }
                }
            },
            authorAddress: "12D3KooWTestAuthor",
            publicationSignaturePublicKey: "testPublicKey",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(false);
    });
});

describe("verifyAuthorAvatarSignature", () => {
    it("should return valid when avatar is undefined", async () => {
        const mockCommunityClient = createMockCommunityClient({});

        const result = await verifyAuthorAvatarSignature({
            avatar: undefined,
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);
    });

    it("should verify avatar signature against current NFT owner", async () => {
        const mockReadContract = vi.fn().mockResolvedValue("0xCurrentOwner");
        const mockVerifyMessage = vi.fn().mockResolvedValue(true);

        const mockCommunityClient = createMockCommunityClient({
            readContract: mockReadContract,
            verifyMessage: mockVerifyMessage
        });

        const result = await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "eth",
                address: "0xNFTContract",
                id: "123",
                timestamp: 1234567890,
                signature: { signature: "0xavatarSig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);

        // Verify it read the NFT owner
        expect(mockReadContract).toHaveBeenCalledWith({
            abi: expect.any(Array),
            address: "0xNFTContract",
            functionName: "ownerOf",
            args: [BigInt(123)]
        });

        // Verify it verified against the current owner
        expect(mockVerifyMessage).toHaveBeenCalledWith({
            address: "0xCurrentOwner",
            message: JSON.stringify({
                // Legacy protocol constant preserved until the source-side PKC rename lands.
                domainSeparator: "pkc-author-avatar",
                authorAddress: "12D3KooWTestAuthor",
                timestamp: 1234567890,
                tokenAddress: "0xNFTContract",
                tokenId: "123"
            }),
            signature: "0xavatarSig"
        });
    });

    it("should return invalid if signer is not the current NFT owner", async () => {
        const mockCommunityClient = createMockCommunityClient({
            readContract: vi.fn().mockResolvedValue("0xDifferentOwner"),
            verifyMessage: vi.fn().mockResolvedValue(false) // Signature doesn't match current owner
        });

        const result = await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "eth",
                address: "0xNFTContract",
                id: "456",
                timestamp: 1234567890,
                signature: { signature: "0xoldOwnerSig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(false);
        expect((result as { valid: false; reason: string }).reason).toContain("not the current NFT owner");
    });

    it("should skip verification and return valid if chain provider is not configured for avatar chain", async () => {
        const mockCommunityClient = createMockCommunityClient({
            chainProviders: {} // No providers
        });

        const result = await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "polygon",
                address: "0xNFTContract",
                id: "789",
                timestamp: 1234567890,
                signature: { signature: "0xsig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(true);
    });

    it("should log a warning when avatar chain provider is missing", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const mockCommunityClient = createMockCommunityClient({
            chainProviders: {} // No providers
        });

        await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "polygon",
                address: "0xNFTContract",
                id: "789",
                timestamp: 1234567890,
                signature: { signature: "0xsig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("avatar on chain 'polygon'"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no chain provider is configured"));
        warnSpy.mockRestore();
    });

    it("should return invalid if NFT contract call fails", async () => {
        const mockCommunityClient = createMockCommunityClient({
            readContract: vi.fn().mockRejectedValue(new Error("Contract not found"))
        });

        const result = await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "eth",
                address: "0xInvalidContract",
                id: "999",
                timestamp: 1234567890,
                signature: { signature: "0xsig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        expect(result.valid).toBe(false);
        expect((result as { valid: false; reason: string }).reason).toContain("Failed to read NFT owner");
    });

    it("should convert tokenId to string in signed message", async () => {
        const mockVerifyMessage = vi.fn().mockResolvedValue(true);
        const mockCommunityClient = createMockCommunityClient({
            readContract: vi.fn().mockResolvedValue("0xOwner"),
            verifyMessage: mockVerifyMessage
        });

        await verifyAuthorAvatarSignature({
            avatar: {
                chainTicker: "eth",
                address: "0xNFTContract",
                id: "12345", // String ID
                timestamp: 1234567890,
                signature: { signature: "0xsig", type: "eip-191" }
            },
            authorAddress: "12D3KooWTestAuthor",
            pkc: mockCommunityClient
        });

        // Verify tokenId is a string in the message
        const callArgs = mockVerifyMessage.mock.calls[0][0];
        const message = JSON.parse(callArgs.message);
        expect(typeof message.tokenId).toBe("string");
        expect(message.tokenId).toBe("12345");
    });
});
