import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SpamDetectionDatabase } from "../db/index.js";
import type { OAuthProvidersResult } from "../oauth/providers.js";
import { getEnabledProviders } from "../oauth/providers.js";
import { IframeParamsSchema, type IframeParams } from "./schemas.js";
import { refreshIpIntelIfNeeded } from "../ip-intel/index.js";
import { generateChallengeIframe, type ChallengeType, type OAuthProvider } from "../challenge-iframes/index.js";
import { getClientIp } from "../utils/ip.js";

/** Default multiplier applied to riskScore after CAPTCHA (30% reduction) */
const DEFAULT_CAPTCHA_SCORE_MULTIPLIER = 0.7;
/** Default multiplier applied to riskScore after first OAuth (40% reduction) */
const DEFAULT_OAUTH_SCORE_MULTIPLIER = 0.6;
/** Default multiplier applied after second OAuth from different provider (50% further reduction) */
const DEFAULT_SECOND_OAUTH_SCORE_MULTIPLIER = 0.5;
/** Default pass threshold — adjusted score must be below this to pass */
const DEFAULT_CHALLENGE_PASS_THRESHOLD = 0.4;

export interface IframeRouteOptions {
    db: SpamDetectionDatabase;
    turnstileSiteKey?: string;
    ipapiKey?: string;
    /** OAuth providers result (if configured) */
    oauthProvidersResult?: OAuthProvidersResult;
    /** Base URL for OAuth callbacks */
    baseUrl?: string;
    /** Multiplier applied to riskScore after CAPTCHA (0-1]. Default: 0.7 */
    captchaScoreMultiplier?: number;
    /** Multiplier applied to riskScore after first OAuth (0-1]. Default: 0.6 */
    oauthScoreMultiplier?: number;
    /** Multiplier applied after second OAuth from different provider (0-1]. Default: 0.5 */
    secondOauthScoreMultiplier?: number;
    /** Adjusted score must be below this to pass. Default: 0.4 */
    challengePassThreshold?: number;
}

/**
 * Register the /api/v1/iframe/:sessionId route.
 */
export function registerIframeRoute(fastify: FastifyInstance, options: IframeRouteOptions): void {
    const { db, turnstileSiteKey, ipapiKey, oauthProvidersResult, baseUrl } = options;
    const captchaMultiplier = options.captchaScoreMultiplier ?? DEFAULT_CAPTCHA_SCORE_MULTIPLIER;
    const oauthMultiplier = options.oauthScoreMultiplier ?? DEFAULT_OAUTH_SCORE_MULTIPLIER;
    const secondOauthMultiplier = options.secondOauthScoreMultiplier ?? DEFAULT_SECOND_OAUTH_SCORE_MULTIPLIER;
    const passThreshold = options.challengePassThreshold ?? DEFAULT_CHALLENGE_PASS_THRESHOLD;

    // Determine which challenge types are available based on configuration
    const enabledOAuthProviders = oauthProvidersResult ? getEnabledProviders(oauthProvidersResult) : [];
    const hasOAuth = enabledOAuthProviders.length > 0;
    const hasTurnstile = !!turnstileSiteKey;

    fastify.get(
        "/api/v1/iframe/:sessionId",
        async (request: FastifyRequest<{ Params: IframeParams }>, reply: FastifyReply): Promise<void> => {
            // Validate params
            const parseResult = IframeParamsSchema.safeParse(request.params);

            if (!parseResult.success) {
                reply.status(400);
                reply.send("Invalid challenge ID");
                return;
            }

            const { sessionId } = parseResult.data;

            // Look up challenge session
            const session = db.getChallengeSessionBySessionId(sessionId);

            if (!session) {
                reply.status(404);
                reply.send("Challenge not found");
                return;
            }

            // Check if challenge has expired (internal timestamps are in milliseconds)
            const nowMs = Date.now();
            if (session.expiresAt < nowMs) {
                reply.status(410);
                reply.send("Challenge has expired");
                return;
            }

            // Check if challenge was already completed
            if (session.status === "completed") {
                reply.status(409);
                reply.send("Challenge already completed");
                return;
            }

            // Check if challenge failed (auto-rejected)
            if (session.status === "failed") {
                reply.status(403);
                reply.send("Challenge was rejected due to high risk score");
                return;
            }

            // Check if iframe was already accessed (challenge is pending)
            if (session.authorAccessedIframeAt) {
                reply.status(409);
                reply.send("Challenge already accessed and pending completion");
                return;
            }

            // Get client IP for IP record
            const clientIp = getClientIp(request);

            // Store IP record and update iframe access time
            db.updateChallengeSessionIframeAccess(sessionId, nowMs);

            if (clientIp) {
                db.insertIframeIpRecord({
                    sessionId,
                    ipAddress: clientIp,
                    timestamp: nowMs
                });

                void refreshIpIntelIfNeeded({
                    db,
                    sessionId,
                    apiKey: ipapiKey
                }).catch((error) => {
                    request.log.warn({ err: error }, "Failed to refresh IP intelligence");
                });
            }

            // Determine iframe content based on OAuth-first logic
            let html: string;
            const riskScore = session.riskScore ?? 0;

            if (hasOAuth && baseUrl) {
                // OAuth-first flow: OAuth is the primary challenge
                // Compute provider availability based on author's previous OAuth usage
                const authorPublicKey = db.getAuthorPublicKeyBySessionId(sessionId);
                const previousProviders = authorPublicKey ? db.getAuthorOAuthProviders(authorPublicKey) : [];

                // Filter out previously-used providers
                let availableProviders = enabledOAuthProviders.filter((p) => !previousProviders.includes(p));
                // If all providers used up, allow re-use
                if (availableProviders.length === 0) {
                    availableProviders = enabledOAuthProviders;
                }

                // Compute score adjustment flags
                const canPassWithCaptchaAlone = hasTurnstile && riskScore * captchaMultiplier < passThreshold;
                const canPassWithOneOAuth = riskScore * oauthMultiplier < passThreshold;
                const needsMore = !canPassWithOneOAuth;

                html = generateChallengeIframe("oauth_first", {
                    sessionId,
                    availableProviders,
                    baseUrl,
                    siteKey: turnstileSiteKey,
                    canPassWithCaptchaAlone,
                    canPassWithOneOAuth,
                    needsMore,
                    oauthCompleted: session.oauthCompleted === 1,
                    captchaCompleted: session.captchaCompleted === 1
                });
            } else if (hasTurnstile) {
                // No OAuth available — serve turnstile only
                html = generateChallengeIframe("turnstile", {
                    sessionId,
                    siteKey: turnstileSiteKey
                });
            } else {
                reply.status(500);
                reply.send("No challenge provider configured");
                return;
            }

            reply.type("text/html");
            reply.send(html);
        }
    );
}
