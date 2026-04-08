import { getPKCAddressFromPublicKey } from "@pkcprotocol/pkc-js/dist/node/signer/util.js";
import { isStringDomain } from "@pkcprotocol/pkc-js/dist/node/util.js";
import type PKC from "@pkcprotocol/pkc-js";
import type { AuthorPubsubType, ChainTicker, Nft } from "@pkcprotocol/pkc-js/dist/node/types.js";

type PkcInstance = Awaited<ReturnType<typeof PKC>>;
type LegacyChainProvider = { urls?: string[]; chainId?: number };
type LegacyViemClient = {
    verifyMessage?: (args: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>;
    getEnsAddress?: (args: { name: string }) => Promise<`0x${string}` | null>;
    getTransactionCount?: (args: { address: `0x${string}` }) => Promise<bigint | number>;
    readContract?: (args: {
        abi: typeof nftAbi;
        address: `0x${string}`;
        functionName: "ownerOf";
        args: [bigint];
    }) => Promise<`0x${string}`>;
};
type LegacyPkcChainAccess = PkcInstance & {
    chainProviders?: Partial<Record<ChainTicker, LegacyChainProvider>>;
    _domainResolver?: {
        _createViemClientIfNeeded: (chainTicker: ChainTicker, rpcUrl: string) => LegacyViemClient;
    };
};

// NFT ABI for ownerOf function
const nftAbi = [
    {
        inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
        name: "ownerOf",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
    }
] as const;

type WalletData = NonNullable<AuthorPubsubType["wallets"]>[ChainTicker];

type VerificationResult = { valid: true } | { valid: false; reason: string };

const getLegacyChainProvider = (pkc: PkcInstance, chainTicker: ChainTicker): LegacyChainProvider | undefined => {
    return (pkc as LegacyPkcChainAccess).chainProviders?.[chainTicker];
};

const getLegacyViemClient = (pkc: PkcInstance, chainTicker: ChainTicker, rpcUrl: string): LegacyViemClient | undefined => {
    return (pkc as LegacyPkcChainAccess)._domainResolver?._createViemClientIfNeeded(chainTicker, rpcUrl);
};

const resolveAuthorNameOrAddress = async (pkc: PkcInstance, address: string): Promise<string | null> => {
    const pkcWithFallback = pkc as PkcInstance & {
        resolveAuthorName?: (args: { address: string }) => Promise<string | null>;
        resolveAuthorAddress?: (args: { address: string }) => Promise<string | null>;
    };

    if (pkcWithFallback.resolveAuthorName) {
        return pkcWithFallback.resolveAuthorName({ address });
    }

    if (pkcWithFallback.resolveAuthorAddress) {
        return pkcWithFallback.resolveAuthorAddress({ address });
    }

    return null;
};

/**
 * Verify a single wallet signature.
 * For domain wallet addresses, also verifies the pkc-author-address TXT record matches the publication signer.
 */
export async function verifyAuthorWalletSignature({
    wallet,
    chainTicker,
    authorAddress,
    publicationSignaturePublicKey,
    pkc
}: {
    wallet: WalletData;
    chainTicker: string;
    authorAddress: string;
    publicationSignaturePublicKey: string;
    pkc: PkcInstance;
}): Promise<VerificationResult> {
    // Check if chain provider is available
    const chainProvider = getLegacyChainProvider(pkc, chainTicker as ChainTicker);
    if (!chainProvider) {
        console.warn(
            `Received publication with wallet on chain '${chainTicker}' but no chain provider is configured — skipping wallet verification`
        );
        return { valid: true }; // Can't verify without chain provider, skip gracefully
    }

    // For domain wallet addresses (e.g., ENS), verify pkc-author-address matches
    if (isStringDomain(wallet.address)) {
        const resolvedWalletAddress = await resolveAuthorNameOrAddress(pkc, wallet.address);
        const publicationSignatureAddress = await getPKCAddressFromPublicKey(publicationSignaturePublicKey);

        if (!resolvedWalletAddress || resolvedWalletAddress.toLowerCase() !== publicationSignatureAddress.toLowerCase()) {
            return {
                valid: false,
                reason: `Wallet domain '${wallet.address}' pkc-author-address resolves to '${resolvedWalletAddress}' but should resolve to '${publicationSignatureAddress}'`
            };
        }
        // Domain verification passed, no need to verify EIP-191 signature for domains
        return { valid: true };
    }

    // For regular addresses, verify EIP-191 signature
    // Get viem client - always use 'eth' chain for signature verification
    const rpcUrl = getLegacyChainProvider(pkc, "eth")?.urls?.[0] || chainProvider.urls?.[0];
    if (!rpcUrl) {
        console.warn(`No RPC URL is configured for wallet verification on chain '${chainTicker}' — skipping wallet verification`);
        return { valid: true };
    }

    const viemClient = getLegacyViemClient(pkc, "eth", rpcUrl);
    if (!viemClient?.verifyMessage) {
        console.warn(`No EVM verifier is available for wallet verification on chain '${chainTicker}' — skipping wallet verification`);
        return { valid: true };
    }

    // Build message to verify (property order matters!)
    const messageToBeSigned: Record<string, string | number> = {};
    messageToBeSigned["domainSeparator"] = "pkc-author-wallet";
    messageToBeSigned["authorAddress"] = authorAddress;
    messageToBeSigned["timestamp"] = wallet.timestamp;

    try {
        const valid = await viemClient.verifyMessage({
            address: wallet.address as `0x${string}`,
            message: JSON.stringify(messageToBeSigned),
            signature: wallet.signature.signature as `0x${string}`
        });

        if (!valid) {
            return { valid: false, reason: `Invalid signature for wallet '${wallet.address}'` };
        }

        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            reason: `Failed to verify wallet signature: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Verify all wallets in author.wallets
 */
export async function verifyAuthorWallets({
    wallets,
    authorAddress,
    publicationSignaturePublicKey,
    pkc
}: {
    wallets: Record<string, WalletData> | undefined;
    authorAddress: string;
    publicationSignaturePublicKey: string;
    pkc: PkcInstance;
}): Promise<VerificationResult> {
    if (!wallets || Object.keys(wallets).length === 0) {
        return { valid: true }; // No wallets to verify
    }

    for (const [chainTicker, wallet] of Object.entries(wallets)) {
        const result = await verifyAuthorWalletSignature({
            wallet,
            chainTicker,
            authorAddress,
            publicationSignaturePublicKey,
            pkc
        });

        if (!result.valid) {
            return result;
        }
    }

    return { valid: true };
}

/**
 * Fetch on-chain transaction counts (nonces) for wallets.
 * Uses eth_getTransactionCount RPC call as a proxy for wallet age + activity.
 *
 * - For domain wallet addresses (ENS), resolves them to hex addresses first using
 *   the ETH chain provider, then queries the nonce on the wallet's declared chain
 * - Skips wallets whose chain has no configured provider
 * - Gracefully handles RPC errors per wallet (returns nonce=0 on failure)
 *
 * @returns Record mapping wallet address (lowercased) to nonce count
 */
export async function fetchWalletTransactionCounts({
    wallets,
    pkc
}: {
    wallets: Record<string, WalletData> | undefined;
    pkc: PkcInstance;
}): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    if (!wallets || Object.keys(wallets).length === 0) {
        return result;
    }

    const promises: Array<Promise<void>> = [];

    for (const [chainTicker, wallet] of Object.entries(wallets)) {
        if (!wallet?.address) continue;

        // Check if chain provider is available
        const chainProvider = getLegacyChainProvider(pkc, chainTicker as ChainTicker);
        if (!chainProvider || !chainProvider.urls || chainProvider.urls.length === 0) continue;

        promises.push(
            (async () => {
                try {
                    let hexAddress: `0x${string}`;

                    if (isStringDomain(wallet.address)) {
                        // Resolve ENS/domain address to hex using the ETH chain provider
                        const ethProvider = getLegacyChainProvider(pkc, "eth");
                        if (!ethProvider || !ethProvider.urls || ethProvider.urls.length === 0) {
                            // No ETH provider to resolve domain — skip this wallet
                            return;
                        }
                        const ethClient = getLegacyViemClient(pkc, "eth", ethProvider.urls[0]);
                        if (!ethClient?.getEnsAddress) {
                            return;
                        }
                        const resolved = await ethClient.getEnsAddress({ name: wallet.address });
                        if (!resolved) {
                            // ENS name doesn't resolve to an address
                            return;
                        }
                        hexAddress = resolved;
                    } else {
                        hexAddress = wallet.address as `0x${string}`;
                    }

                    const rpcUrl = chainProvider.urls?.[0];
                    if (!rpcUrl) {
                        return;
                    }

                    const viemClient = getLegacyViemClient(pkc, chainTicker as ChainTicker, rpcUrl);
                    if (!viemClient?.getTransactionCount) {
                        return;
                    }
                    const nonce = await viemClient.getTransactionCount({
                        address: hexAddress
                    });
                    // Key by original wallet address (lowercased) for lookup
                    result[wallet.address.toLowerCase()] = Number(nonce);
                } catch (error) {
                    // Graceful fallback — log warning and return 0 for this wallet
                    console.warn(
                        `Failed to fetch transaction count for wallet ${wallet.address} on chain ${chainTicker}: ${error instanceof Error ? error.message : String(error)}`
                    );
                    result[wallet.address.toLowerCase()] = 0;
                }
            })()
        );
    }

    await Promise.all(promises);

    return result;
}

/**
 * Verify avatar (NFT) signature.
 * Verifies that the signature was created by the current NFT owner.
 */
export async function verifyAuthorAvatarSignature({
    avatar,
    authorAddress,
    pkc
}: {
    avatar: Nft | undefined;
    authorAddress: string;
    pkc: PkcInstance;
}): Promise<VerificationResult> {
    if (!avatar) {
        return { valid: true }; // No avatar to verify
    }

    // Check if chain provider is available for the NFT's chain
    const chainProvider = getLegacyChainProvider(pkc, avatar.chainTicker as ChainTicker);
    if (!chainProvider) {
        console.warn(
            `Received publication with avatar on chain '${avatar.chainTicker}' but no chain provider is configured — skipping avatar verification`
        );
        return { valid: true }; // Can't verify without chain provider, skip gracefully
    }

    const rpcUrl = chainProvider.urls?.[0];
    if (!rpcUrl) {
        console.warn(`No RPC URL is configured for avatar verification on chain '${avatar.chainTicker}' — skipping avatar verification`);
        return { valid: true };
    }

    const viemClient = getLegacyViemClient(pkc, avatar.chainTicker as ChainTicker, rpcUrl);
    if (!viemClient?.readContract || !viemClient?.verifyMessage) {
        console.warn(
            `No EVM verifier is available for avatar verification on chain '${avatar.chainTicker}' — skipping avatar verification`
        );
        return { valid: true };
    }

    // Get current NFT owner
    let currentOwner: `0x${string}`;
    try {
        currentOwner = (await viemClient.readContract({
            abi: nftAbi,
            address: avatar.address as `0x${string}`,
            functionName: "ownerOf",
            args: [BigInt(avatar.id)]
        })) as `0x${string}`;
    } catch (error) {
        return {
            valid: false,
            reason: `Failed to read NFT owner: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    // Build message to verify (property order matters!)
    const messageToBeSigned: Record<string, string | number> = {};
    messageToBeSigned["domainSeparator"] = "pkc-author-avatar";
    messageToBeSigned["authorAddress"] = authorAddress;
    messageToBeSigned["timestamp"] = avatar.timestamp;
    messageToBeSigned["tokenAddress"] = avatar.address;
    messageToBeSigned["tokenId"] = String(avatar.id); // Must be string type

    try {
        const valid = await viemClient.verifyMessage({
            address: currentOwner,
            message: JSON.stringify(messageToBeSigned),
            signature: avatar.signature.signature as `0x${string}`
        });

        if (!valid) {
            return {
                valid: false,
                reason: `Invalid avatar signature - signer is not the current NFT owner`
            };
        }

        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            reason: `Failed to verify avatar signature: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}
