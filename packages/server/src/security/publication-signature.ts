import { verifyCommentPubsubMessage, verifyVote } from "@plebbit/plebbit-js/dist/node/signer/signatures.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type Plebbit from "@plebbit/plebbit-js";
import { verifyAuthorWallets, verifyAuthorAvatarSignature } from "./author-field-signature.js";

type PlebbitInstance = Awaited<ReturnType<typeof Plebbit>>;

/**
 * Get the publication and its signature from a challenge request
 */
function getPublicationFromChallengeRequest(challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor) {
    if (challengeRequest.comment) return challengeRequest.comment;
    if (challengeRequest.vote) return challengeRequest.vote;
    return undefined;
}

/**
 * Strip author.subplebbit before signature verification.
 * The subplebbit adds author.subplebbit to the challenge request AFTER the author signs
 * the publication. Since author is a signed property, the extra field would cause
 * verification to fail because the CBOR bytes differ from what was originally signed.
 */
function stripSubplebbitAuthorForVerification<T extends { author: { subplebbit?: unknown } }>(publication: T): T {
    const { subplebbit: _, ...authorWithoutSubplebbit } = publication.author;
    return { ...publication, author: authorWithoutSubplebbit } as T;
}

/**
 * Verify a publication's signature using plebbit-js verify functions.
 * Also verifies author.wallets and author.avatar signatures if present.
 */
export async function verifyPublicationSignature({
    challengeRequest,
    plebbit
}: {
    challengeRequest: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
    plebbit: PlebbitInstance;
}) {
    const clientsManager = plebbit._clientsManager;
    const resolveAuthorAddresses = true;
    const overrideAuthorAddressIfInvalid = false;

    // First verify the main publication signature
    // Strip author.subplebbit before verification since it's added by the subplebbit
    // after the author signs the publication
    let publicationVerificationResult: { valid: boolean; reason?: string };

    if (challengeRequest.comment) {
        publicationVerificationResult = await verifyCommentPubsubMessage({
            comment: stripSubplebbitAuthorForVerification(challengeRequest.comment),
            resolveAuthorAddresses,
            clientsManager,
            overrideAuthorAddressIfInvalid
        });
    } else if (challengeRequest.vote) {
        publicationVerificationResult = await verifyVote({
            vote: stripSubplebbitAuthorForVerification(challengeRequest.vote),
            resolveAuthorAddresses,
            clientsManager,
            overrideAuthorAddressIfInvalid
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
        plebbit
    });

    if (!walletsResult.valid) {
        return { valid: false, reason: walletsResult.reason };
    }

    // Verify avatar
    const avatarResult = await verifyAuthorAvatarSignature({
        avatar: author.avatar,
        authorAddress: author.address,
        plebbit
    });

    if (!avatarResult.valid) {
        return { valid: false, reason: avatarResult.reason };
    }

    return { valid: true };
}
