import type {
    DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor,
    PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest
} from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type { AuthorTypeWithCommentUpdate } from "@plebbit/plebbit-js/dist/node/types.js";
import { derivePublicationFromChallengeRequest } from "../plebbit-js-internals.js";

/**
 * Extract the publication from a decrypted challenge request.
 * The challenge request can contain different publication types:
 * - comment
 * - vote
 *
 * This helper returns the publication object regardless of type.
 */
export function getPublicationFromChallengeRequest(
    challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor
): PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest {
    return derivePublicationFromChallengeRequest(challengeRequest);
}

/**
 * Get the author from a challenge request.
 */
export function getAuthorFromChallengeRequest(
    challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor
): AuthorTypeWithCommentUpdate {
    const publication = getPublicationFromChallengeRequest(challengeRequest);

    return publication.author;
}

/**
 * Get the author's cryptographic public key from a challenge request.
 *
 * This is the Ed25519 public key from the publication's signature, which
 * is cryptographically tied to the author's identity. Unlike author.address,
 * which can be a domain name, this public key is always the true identifier.
 *
 * Use this for identity tracking (velocity, karma, etc.) instead of author.address.
 */
export function getAuthorPublicKeyFromChallengeRequest(challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor): string {
    const publication = getPublicationFromChallengeRequest(challengeRequest);

    return publication.signature.publicKey;
}

/**
 * Publication types for velocity tracking.
 */
export type PublicationType = "post" | "reply" | "vote";

/**
 * Get the publication type from a challenge request.
 * - post: comment without parentCid
 * - reply: comment with parentCid
 * - vote: vote publication
 */
export function getPublicationType(challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor): PublicationType {
    if (challengeRequest.comment) {
        // Check if it's a post (no parentCid) or reply (has parentCid)
        return challengeRequest.comment.parentCid ? "reply" : "post";
    }
    if (challengeRequest.vote) {
        return "vote";
    }
    throw new Error("Unknown publication type in challenge request");
}

/**
 * Wallet address with chain information.
 */
export interface WalletInfo {
    address: string;
    chainTicker: string;
}

/**
 * Extract all wallet addresses from an author object.
 * Includes wallets from author.wallets and author.avatar.
 *
 * Note: author.wallets and author.avatar are user-provided but the signatures
 * are verified by plebbit-js, proving wallet ownership.
 */
export function getWalletAddresses(author: Pick<AuthorTypeWithCommentUpdate, "wallets" | "avatar">): WalletInfo[] {
    const wallets: WalletInfo[] = [];

    // Extract from author.wallets (keyed by chain ticker)
    if (author.wallets) {
        for (const [chainTicker, walletData] of Object.entries(author.wallets)) {
            if (walletData?.address) {
                wallets.push({
                    address: walletData.address,
                    chainTicker
                });
            }
        }
    }

    // Extract from author.avatar
    // The avatar contains NFT info, and we need to find the wallet that owns it
    // The wallet address for the avatar is in author.wallets[avatar.chainTicker]
    // However, since we already iterate over all wallets above, we don't need
    // to add it again. The avatar's wallet should be in author.wallets.

    return wallets;
}
