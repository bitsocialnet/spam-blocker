import { verifyCommentPubsubMessage, verifyVote } from "@pkcprotocol/pkc-js/dist/node/signer/signatures.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";
import type PKC from "@pkcprotocol/pkc-js";
import { verifyAuthorWallets, verifyAuthorAvatarSignature } from "./author-field-signature.js";

type PkcInstance = Awaited<ReturnType<typeof PKC>>;

/**
 * Get the publication and its signature from a challenge request
 */
function getPublicationFromChallengeRequest(challengeRequest: DecryptedChallengeRequestMessageTypeWithCommunityAuthor) {
    if (challengeRequest.comment) return challengeRequest.comment;
    if (challengeRequest.vote) return challengeRequest.vote;
    return undefined;
}

/**
 * Strip author.community before signature verification.
 * The community adds author.community to the challenge request AFTER the author signs
 * the publication. Since author is a signed property, the extra field would cause
 * verification to fail because the CBOR bytes differ from what was originally signed.
 */
function stripCommunityAuthorForVerification<T extends { author: { community?: unknown } }>(publication: T): T {
    const { community: _, ...authorWithoutCommunity } = publication.author;
    return { ...publication, author: authorWithoutCommunity } as T;
}

/**
 * Verify a publication's signature using pkc-js verify functions.
 * Also verifies author.wallets and author.avatar signatures if present.
 */
export async function verifyPublicationSignature({
    challengeRequest,
    pkc
}: {
    challengeRequest: DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
    pkc: PkcInstance;
}) {
    const clientsManager = pkc._clientsManager;
    const resolveAuthorNames = pkc.resolveAuthorNames;
    // First verify the main publication signature
    // Strip author.community before verification since it's added by the community
    // after the author signs the publication
    let publicationVerificationResult: { valid: boolean; reason?: string };

    if (challengeRequest.comment) {
        publicationVerificationResult = await verifyCommentPubsubMessage({
            comment: stripCommunityAuthorForVerification(challengeRequest.comment),
            resolveAuthorNames,
            clientsManager
        });
    } else if (challengeRequest.vote) {
        publicationVerificationResult = await verifyVote({
            vote: stripCommunityAuthorForVerification(challengeRequest.vote),
            resolveAuthorNames,
            clientsManager
        });
    } else {
        return { valid: false, reason: "Unknown publication type" };
    }

    // If main signature verification failed, return early
    if (!publicationVerificationResult.valid) {
        return publicationVerificationResult;
    }

    // Now verify author.wallets and author.avatar if present
    const publication = getPublicationFromChallengeRequest(challengeRequest);
    if (!publication) {
        return { valid: false, reason: "No publication found in challenge request" };
    }

    const author = publication.author;
    const publicationSignaturePublicKey = publication.signature.publicKey;

    // Verify wallets
    const walletsResult = await verifyAuthorWallets({
        wallets: author.wallets,
        authorAddress: author.address,
        publicationSignaturePublicKey,
        pkc
    });

    if (!walletsResult.valid) {
        return { valid: false, reason: walletsResult.reason };
    }

    // Verify avatar
    const avatarResult = await verifyAuthorAvatarSignature({
        avatar: author.avatar,
        authorAddress: author.address,
        pkc
    });

    if (!avatarResult.valid) {
        return { valid: false, reason: avatarResult.reason };
    }

    return { valid: true };
}
