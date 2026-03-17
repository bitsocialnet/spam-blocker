import type { FastifyInstance } from "fastify";
import type { SpamDetectionDatabase } from "../db/index.js";
import type { Indexer } from "../indexer/index.js";
import type { OAuthProvidersResult } from "../oauth/providers.js";
import { getEnabledProviders } from "../oauth/providers.js";
import { registerEvaluateRoute } from "./evaluate.js";
import { registerVerifyRoute } from "./verify.js";
import { registerIframeRoute } from "./iframe.js";
import { registerCompleteRoute } from "./complete.js";
import { registerOAuthRoutes } from "./oauth.js";
import type { ChallengeTierConfig } from "../risk-score/challenge-tier.js";
import type { RateLimitConfig } from "../rate-limit/index.js";
import type { RiskFactorName } from "../risk-score/types.js";

export interface RouteOptions {
    db: SpamDetectionDatabase;
    baseUrl: string;
    turnstileSiteKey?: string;
    turnstileSecretKey?: string;
    ipapiKey?: string;
    indexer?: Indexer | null;
    /** OAuth providers result (if configured) */
    oauthProvidersResult?: OAuthProvidersResult;
    /** Challenge tier configuration thresholds */
    challengeTierConfig?: Partial<ChallengeTierConfig>;
    /** Allow non-domain (IPNS) subplebbits. Default: false */
    allowNonDomainSubplebbits?: boolean;
    /** Rate limit configuration. Undefined = feature disabled. Pass {} to enable with defaults. */
    rateLimitConfig?: RateLimitConfig;
    /** Multiplier applied to riskScore after CAPTCHA (0-1]. Default: 0.7 */
    captchaScoreMultiplier?: number;
    /** Multiplier applied to riskScore after first OAuth (0-1]. Default: 0.6 */
    oauthScoreMultiplier?: number;
    /** Multiplier applied after second OAuth from different provider (0-1]. Default: 0.5 */
    secondOauthScoreMultiplier?: number;
    /** Adjusted score must be below this to pass. Default: 0.4 */
    challengePassThreshold?: number;
    /** List of risk factor names to disable (their weight is zeroed out and redistributed) */
    disabledRiskFactors?: RiskFactorName[];
}

/**
 * Register all API routes on the Fastify instance.
 */
export function registerRoutes(fastify: FastifyInstance, options: RouteOptions): void {
    const {
        db,
        baseUrl,
        turnstileSiteKey,
        turnstileSecretKey,
        ipapiKey,
        indexer,
        oauthProvidersResult,
        challengeTierConfig,
        allowNonDomainSubplebbits,
        rateLimitConfig,
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        secondOauthScoreMultiplier,
        challengePassThreshold,
        disabledRiskFactors
    } = options;

    // Determine available challenge providers
    const enabledOAuthProviders = oauthProvidersResult ? getEnabledProviders(oauthProvidersResult) : [];
    const hasOAuthProviders = enabledOAuthProviders.length > 0;
    const hasTurnstile = !!turnstileSiteKey;

    // Register individual routes
    registerEvaluateRoute(fastify, {
        db,
        baseUrl,
        indexer,
        challengeTierConfig,
        enabledOAuthProviders,
        hasTurnstile,
        allowNonDomainSubplebbits,
        rateLimitConfig,
        disabledRiskFactors
    });
    registerVerifyRoute(fastify, { db });
    registerIframeRoute(fastify, {
        db,
        turnstileSiteKey,
        ipapiKey,
        oauthProvidersResult,
        baseUrl,
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        secondOauthScoreMultiplier,
        challengePassThreshold
    });
    registerCompleteRoute(fastify, {
        db,
        turnstileSecretKey,
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        challengePassThreshold
    });

    // Register OAuth routes if any providers are configured
    if (hasOAuthProviders && oauthProvidersResult) {
        registerOAuthRoutes(fastify, {
            db,
            providers: oauthProvidersResult.providers,
            oauthScoreMultiplier,
            secondOauthScoreMultiplier,
            captchaScoreMultiplier,
            challengePassThreshold
        });
    }

    // Health check endpoint
    fastify.get("/health", async () => {
        return { status: "ok", timestamp: Date.now() };
    });
}

export { registerEvaluateRoute } from "./evaluate.js";
export { registerVerifyRoute } from "./verify.js";
export { registerIframeRoute } from "./iframe.js";
export { registerCompleteRoute } from "./complete.js";
export * from "./schemas.js";
