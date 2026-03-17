import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import type { EvaluateResponse } from "@bitsocial/spam-blocker-shared";
import type { SpamDetectionDatabase, ChallengeTierDb } from "../db/index.js";
import { EvaluateRequestSchema, type EvaluateRequest } from "./schemas.js";
import { derivePublicationFromChallengeRequest } from "../plebbit-js-internals.js";
import { randomUUID } from "crypto";
import { verifySignedRequest } from "../security/request-signature.js";
import { verifyPublicationSignature } from "../security/publication-signature.js";
import { resolveSubplebbitPublicKey } from "../subplebbit-resolver.js";
import { calculateRiskScore } from "../risk-score/index.js";
import { getAuthorFromChallengeRequest, getAuthorPublicKeyFromChallengeRequest, getPublicationType } from "../risk-score/utils.js";
import { checkRateLimit, type RateLimitConfig } from "../rate-limit/index.js";
import { fetchWalletTransactionCounts } from "../security/author-field-signature.js";
import { determineChallengeTier, type ChallengeTierConfig } from "../risk-score/challenge-tier.js";
import { IndexerQueries } from "../indexer/db/queries.js";
import type { Indexer } from "../indexer/index.js";
import { getClientIp } from "../utils/ip.js";

const CHALLENGE_EXPIRY_MS = 3600 * 1000; // 1 hour in milliseconds
const MAX_REQUEST_SKEW_SECONDS = 5 * 60;

export interface EvaluateRouteOptions {
    db: SpamDetectionDatabase;
    baseUrl: string;
    indexer?: Indexer | null;
    /** Challenge tier configuration thresholds */
    challengeTierConfig?: Partial<ChallengeTierConfig>;
    /** List of enabled OAuth providers (e.g., ["google", "github"]) */
    enabledOAuthProviders?: string[];
    /** Whether Turnstile is configured */
    hasTurnstile?: boolean;
    /** Allow non-domain (IPNS) subplebbits. Default: false */
    allowNonDomainSubplebbits?: boolean;
    /** Rate limit configuration. Undefined = feature disabled. Pass {} to enable with defaults. */
    rateLimitConfig?: RateLimitConfig;
}

/**
 * Register the /api/v1/evaluate route.
 */
export function registerEvaluateRoute(fastify: FastifyInstance, options: EvaluateRouteOptions): void {
    const {
        db,
        baseUrl,
        indexer,
        challengeTierConfig,
        enabledOAuthProviders = [],
        hasTurnstile = false,
        allowNonDomainSubplebbits = false,
        rateLimitConfig
    } = options;

    const hasOAuthProviders = enabledOAuthProviders.length > 0;

    fastify.post(
        "/api/v1/evaluate",
        async (request: FastifyRequest<{ Body: EvaluateRequest }>, reply: FastifyReply): Promise<EvaluateResponse> => {
            const parseResult = EvaluateRequestSchema.safeParse(request.body);
            if (!parseResult.success) {
                const error = new Error(`Invalid request body: ${parseResult.error.issues.map((issue) => issue.message).join(", ")}`);
                (error as { statusCode?: number }).statusCode = 400;
                throw error;
            }

            const { challengeRequest } = parseResult.data as EvaluateRequest;
            const { signature, timestamp } = parseResult.data as EvaluateRequest;

            // Use raw challengeRequest from request.body for signature verification
            // Zod parsing strips unknown fields, but the signature was created over the original object
            const rawBody = request.body as { challengeRequest: unknown; timestamp: number };
            const rawChallengeRequest = rawBody.challengeRequest;

            // Validate request timestamp (protocol uses seconds)
            const nowSeconds = Math.floor(Date.now() / 1000);
            if (timestamp < nowSeconds - MAX_REQUEST_SKEW_SECONDS || timestamp > nowSeconds + MAX_REQUEST_SKEW_SECONDS) {
                const error = new Error("Request timestamp is out of range");
                (error as { statusCode?: number }).statusCode = 401;
                throw error;
            }

            await verifySignedRequest({ challengeRequest: rawChallengeRequest, timestamp }, signature);

            // Extract publication to get subplebbitAddress for validation
            let publication;
            try {
                publication = derivePublicationFromChallengeRequest(
                    challengeRequest as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor
                );
            } catch (error) {
                const invalidError = new Error("Invalid request body: missing publication");
                (invalidError as { statusCode?: number }).statusCode = 400;
                throw invalidError;
            }

            // Validate publication type - only accept user-generated content (posts, replies, votes)
            const typedChallengeRequest = challengeRequest as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;

            // Reject subplebbit-level actions - these are inherently authorized by the subplebbit's trust model
            if (typedChallengeRequest.commentEdit || typedChallengeRequest.commentModeration || typedChallengeRequest.subplebbitEdit) {
                const error = new Error(
                    "commentEdit, commentModeration, and subplebbitEdit are subplebbit-level actions that do not require spam detection"
                );
                (error as { statusCode?: number }).statusCode = 400;
                throw error;
            }

            const hasKnownPublicationType = typedChallengeRequest.comment || typedChallengeRequest.vote;

            if (!hasKnownPublicationType) {
                const error = new Error("Unknown or missing publication type");
                (error as { statusCode?: number }).statusCode = 400;
                throw error;
            }

            // Verify publication signature (prevents forged publications)
            const plebbit = await fastify.getPlebbitInstance();
            const verificationResult = await verifyPublicationSignature({
                challengeRequest: typedChallengeRequest,
                plebbit
            });
            if (!verificationResult.valid) {
                const error = new Error(`Publication signature is invalid: ${verificationResult.reason}`);
                (error as { statusCode?: number }).statusCode = 401;
                throw error;
            }

            const subplebbitAddress = publication.subplebbitAddress;
            // Convert Uint8Array publicKey to base64 string for comparisons and storage
            const subplebbitPublicKeyFromRequestBody = uint8ArrayToString(signature.publicKey, "base64");

            // Only accept domain-addressed subplebbits (unless allowNonDomainSubplebbits is enabled)
            // IPNS addresses are free to create, making them vulnerable to sybil attacks
            if (!allowNonDomainSubplebbits && !subplebbitAddress.includes(".")) {
                const error = new Error("Only domain-addressed subplebbits are supported");
                (error as { statusCode?: number }).statusCode = 400;
                throw error;
            }

            // Verify the request signature matches the resolved subplebbit public key
            let resolvedPublicKey: string;
            try {
                resolvedPublicKey = await resolveSubplebbitPublicKey(subplebbitAddress, plebbit);
            } catch (error) {
                const resolveError = new Error("Unable to resolve subplebbit address");
                (resolveError as { statusCode?: number }).statusCode = 401;
                throw resolveError;
            }

            if (resolvedPublicKey !== subplebbitPublicKeyFromRequestBody) {
                const mismatchError = new Error("Request signature does not match subplebbit");
                (mismatchError as { statusCode?: number }).statusCode = 401;
                throw mismatchError;
            }

            // Generate challenge ID
            const sessionId = randomUUID();

            // Calculate expiry time (internal timestamps use milliseconds)
            const nowMs = Date.now();
            const expiresAt = nowMs + CHALLENGE_EXPIRY_MS;

            // Register subplebbit for indexing (only if not already registered)
            const indexerQueries = new IndexerQueries(db.getDb());
            const existingSubplebbit = indexerQueries.getIndexedSubplebbit(subplebbitAddress);
            if (!existingSubplebbit) {
                indexerQueries.upsertIndexedSubplebbit({
                    address: subplebbitAddress,
                    publicKey: subplebbitPublicKeyFromRequestBody,
                    discoveredVia: "evaluate_api"
                });
            }

            // Fetch wallet transaction counts (nonces) for risk scoring
            const author = getAuthorFromChallengeRequest(typedChallengeRequest);
            const walletTransactionCounts = await fetchWalletTransactionCounts({
                wallets: author.wallets as
                    | Record<string, { address: string; timestamp: number; signature: { signature: string; type: string } }>
                    | undefined,
                plebbit
            });

            // Check for duplicate publication (replay attack prevention)
            const signatureValue = (publication.signature as { signature: string }).signature;
            if (db.publicationSignatureExists(signatureValue)) {
                const error = new Error("Publication already submitted");
                (error as { statusCode?: number }).statusCode = 409;
                throw error;
            }

            // Rate limit pre-check (hard reject before risk scoring)
            if (rateLimitConfig !== undefined) {
                const authorPublicKey = getAuthorPublicKeyFromChallengeRequest(typedChallengeRequest);
                const publicationType = getPublicationType(typedChallengeRequest);

                const rateLimitResult = checkRateLimit({
                    authorPublicKey,
                    publicationType,
                    db,
                    config: rateLimitConfig
                });

                if (!rateLimitResult.allowed) {
                    request.log.warn(
                        {
                            exceeded: rateLimitResult.exceeded,
                            limit: rateLimitResult.limit,
                            current: rateLimitResult.current,
                            multiplier: rateLimitResult.multiplier
                        },
                        `Rate limit exceeded: ${rateLimitResult.exceeded}`
                    );
                    const error = new Error(
                        `Rate limit exceeded: ${rateLimitResult.exceeded} (${rateLimitResult.current}/${rateLimitResult.limit})`
                    );
                    (error as { statusCode?: number }).statusCode = 429;
                    throw error;
                }
            }

            // Calculate risk score using the risk-score module
            const riskScoreResult = calculateRiskScore({
                challengeRequest: challengeRequest as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor,
                db,
                walletTransactionCounts,
                enabledOAuthProviders
            });

            // Determine challenge tier based on risk score
            const challengeTier = determineChallengeTier(riskScoreResult.score, challengeTierConfig);

            request.log.info(
                {
                    sessionId,
                    riskScore: riskScoreResult.score.toFixed(2),
                    challengeTier,
                    factors: riskScoreResult.factors
                        .filter((f) => f.weight > 0)
                        .map((f) => `${f.name}: ${(f.score * 100).toFixed(0)}%`)
                        .join(", ")
                },
                `Evaluate: score=${riskScoreResult.score.toFixed(2)} tier=${challengeTier}`
            );

            // Map challenge tier to database tier (auto_accept and auto_reject don't need sessions with tiers)
            let dbChallengeTier: ChallengeTierDb | undefined;
            if (challengeTier === "oauth_sufficient" || challengeTier === "oauth_plus_more") {
                if (hasOAuthProviders) {
                    dbChallengeTier = challengeTier;
                } else if (hasTurnstile) {
                    // No OAuth providers available — fall back to oauth_sufficient (CAPTCHA-only path)
                    dbChallengeTier = "oauth_sufficient";
                }
            }

            // Create challenge session in database (store riskScore for post-CAPTCHA adjustment)
            db.insertChallengeSession({
                sessionId,
                subplebbitPublicKey: subplebbitPublicKeyFromRequestBody,
                expiresAt,
                challengeTier: dbChallengeTier,
                riskScore: riskScoreResult.score
            });

            // Record the IP address of the subplebbit server calling /evaluate
            const callerIp = getClientIp(request);
            if (callerIp) {
                db.insertEvaluateCallerIp({
                    sessionId,
                    ipAddress: callerIp,
                    timestamp: nowMs
                });
            }

            // Store publication in database for velocity tracking
            if (typedChallengeRequest.comment) {
                db.insertComment({
                    sessionId,
                    publication: typedChallengeRequest.comment
                });
            } else if (typedChallengeRequest.vote) {
                db.insertVote({
                    sessionId,
                    publication: typedChallengeRequest.vote
                });
            }

            // Queue author's previousCommentCid for background crawling (if indexer is enabled)
            if (author.previousCommentCid && indexer) {
                indexer.queuePreviousCidCrawl(author.previousCommentCid);
            }

            // Build response based on challenge tier
            const response: EvaluateResponse = {
                riskScore: riskScoreResult.score,
                sessionId,
                challengeUrl: `${baseUrl}/api/v1/iframe/${sessionId}`,
                challengeExpiresAt: Math.floor(expiresAt / 1000),
                explanation: riskScoreResult.explanation
            };

            // For auto_accept, mark session as completed immediately
            if (challengeTier === "auto_accept") {
                db.updateChallengeSessionStatus(sessionId, "completed", nowMs);
            }

            // For auto_reject, mark session as failed immediately
            if (challengeTier === "auto_reject") {
                db.updateChallengeSessionStatus(sessionId, "failed", nowMs);
            }

            return response;
        }
    );
}
