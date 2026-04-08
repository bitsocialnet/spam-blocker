import { z } from "zod";
import type { DecryptedChallengeRequest } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";
import {
    DecryptedChallengeRequestSchema,
    PKCTimestampSchema,
    CommunityAuthorSchema,
    derivePublicationFromChallengeRequest
} from "../pkc-js-internals.js";

/**
 * Schema for CBOR request signatures.
 * Unlike JSON signatures, these use Uint8Array for binary fields.
 */
export const CborSignatureSchema = z.object({
    signature: z.instanceof(Uint8Array),
    publicKey: z.instanceof(Uint8Array),
    type: z.string(),
    signedPropertyNames: z.array(z.string())
});

export type CborSignature = z.infer<typeof CborSignatureSchema>;

const ChallengeRequestWithCommunityAuthorSchema = DecryptedChallengeRequestSchema.superRefine((value: DecryptedChallengeRequest, ctx) => {
    let publication;
    try {
        publication = derivePublicationFromChallengeRequest(value);
    } catch (error) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid challenge request: missing publication"
        });
        return;
    }

    if (!publication) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid challenge request: missing publication"
        });
        return;
    }

    // author.community is optional - it only exists for authors who have previously
    // published in this community. New authors won't have this field.
    const communityAuthor = publication.author?.community;
    if (communityAuthor) {
        const communityResult = CommunityAuthorSchema.safeParse(communityAuthor);
        if (!communityResult.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid community author data"
            });
        }
    }
});

export interface EvaluateRequest {
    challengeRequest: DecryptedChallengeRequest;
    timestamp: number;
    signature: CborSignature;
}

export const EvaluateRequestSchema: z.ZodType<EvaluateRequest> = z
    .object({
        challengeRequest: ChallengeRequestWithCommunityAuthorSchema,
        timestamp: PKCTimestampSchema,
        signature: CborSignatureSchema
    })
    .strict() as z.ZodType<EvaluateRequest>;

/**
 * Schema for the verify request body.
 * Note: token field removed - challenge completion is tracked server-side.
 */
export interface VerifyRequest {
    sessionId: string;
    timestamp: number;
    signature: CborSignature;
}

export const VerifyRequestSchema: z.ZodType<VerifyRequest> = z
    .object({
        sessionId: z.string().min(1, "sessionId is required"),
        timestamp: PKCTimestampSchema,
        signature: CborSignatureSchema
    })
    .strict() as z.ZodType<VerifyRequest>;

/**
 * Schema for the iframe route params.
 */
export const IframeParamsSchema = z.object({
    sessionId: z.string().min(1, "sessionId is required") // TODO figure out how it should look like
});

export type IframeParams = z.infer<typeof IframeParamsSchema>;

/**
 * Schema for the challenge complete request body.
 * Called by the iframe after user completes a challenge (CAPTCHA, OAuth, etc.).
 */
export const CompleteRequestSchema = z
    .object({
        sessionId: z.string().min(1, "sessionId is required"),
        /** The response token from the challenge provider (Turnstile, hCaptcha, OAuth code, etc.) */
        challengeResponse: z.string().min(1, "challengeResponse is required"),
        /** The type of challenge that was completed (e.g., "turnstile", "hcaptcha", "github") */
        challengeType: z.string().optional()
    })
    .strict();

export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
