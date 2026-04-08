import { z } from "zod";
import type { DecryptedChallengeRequest } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import {
    DecryptedChallengeRequestSchema,
    PlebbitTimestampSchema,
    SubplebbitAuthorSchema,
    derivePublicationFromChallengeRequest
} from "../plebbit-js-internals.js";

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

const ChallengeRequestWithSubplebbitAuthorSchema = DecryptedChallengeRequestSchema.superRefine((value: DecryptedChallengeRequest, ctx) => {
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

    // author.subplebbit is optional - it only exists for authors who have previously
    // published in this subplebbit. New authors won't have this field.
    const subplebbitAuthor = publication.author?.subplebbit;
    if (subplebbitAuthor) {
        const subplebbitResult = SubplebbitAuthorSchema.safeParse(subplebbitAuthor);
        if (!subplebbitResult.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid subplebbit author data"
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
        challengeRequest: ChallengeRequestWithSubplebbitAuthorSchema,
        timestamp: PlebbitTimestampSchema,
        signature: CborSignatureSchema
    })
    .strict();

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
        timestamp: PlebbitTimestampSchema,
        signature: CborSignatureSchema
    })
    .strict();

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
