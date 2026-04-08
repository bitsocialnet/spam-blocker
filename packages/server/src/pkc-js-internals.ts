import { CommunityAuthorSchema, JsonSignatureSchema, PKCTimestampSchema } from "@pkcprotocol/pkc-js/dist/node/schema/schema.js";
import { DecryptedChallengeRequestSchema } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/schema.js";
import {
    derivePublicationFromChallengeRequest as _derivePublicationFromChallengeRequest,
    isStringDomain
} from "@pkcprotocol/pkc-js/dist/node/util.js";
import type { PublicationWithCommunityAuthorFromDecryptedChallengeRequest } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";

const PkcTimestampSchema: typeof PKCTimestampSchema = PKCTimestampSchema;

const derivePublicationFromChallengeRequest = _derivePublicationFromChallengeRequest as (
    request: unknown
) => PublicationWithCommunityAuthorFromDecryptedChallengeRequest;

export {
    DecryptedChallengeRequestSchema,
    JsonSignatureSchema,
    PKCTimestampSchema,
    PkcTimestampSchema,
    CommunityAuthorSchema,
    derivePublicationFromChallengeRequest,
    isStringDomain
};
