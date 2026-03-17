import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest } from "fastify";
import * as cborg from "cborg";
import { SpamDetectionDatabase, createDatabase } from "./db/index.js";
import { registerRoutes } from "./routes/index.js";
import { destroyPlebbitInstance, getPlebbitInstance, initPlebbitInstance, setPlebbitOptions } from "./subplebbit-resolver.js";
import { Indexer, stopIndexer } from "./indexer/index.js";
import { createOAuthProviders, type OAuthConfig } from "./oauth/providers.js";
import { validateChallengeTierConfig, DEFAULT_CHALLENGE_TIER_CONFIG } from "./risk-score/challenge-tier.js";
import type { RiskFactorName } from "./risk-score/types.js";
import { WEIGHTS_NO_IP } from "./risk-score/types.js";
import type Plebbit from "@plebbit/plebbit-js";

const DEFAULT_PLEBBIT_RPC_URL = "ws://localhost:9138/";

export interface ServerConfig {
    /** Port to listen on. Default: 3000 */
    port?: number; // TODO should be required wihtout defaults
    /** Host to bind to. Default: "0.0.0.0" */
    host?: string;
    /** Base URL for generating challenge URLs. Default: "http://localhost:3000" */
    baseUrl?: string;
    /** Path to SQLite database file. Use ":memory:" for in-memory. */
    databasePath: string;
    /** Cloudflare Turnstile site key */
    turnstileSiteKey?: string;
    /** Cloudflare Turnstile secret key */
    turnstileSecretKey?: string;
    /** ipapi.is API key for IP intelligence lookups (optional — works without key) */
    ipapiKey?: string;
    /** Enable request logging. Default: true */
    logging?: boolean;
    /** Enable indexer. Default: true */
    enableIndexer?: boolean;
    /** Enable the previousCommentCid crawler. Default: false */
    enablePreviousCidCrawler?: boolean;
    /** Plebbit options passed to the Plebbit constructor. If plebbitRpcUrl is also provided, it will be merged. */
    plebbitOptions?: Parameters<typeof Plebbit>[0];
    /** Plebbit RPC WebSocket URL. Default: "ws://localhost:9138/". Convenience option merged into plebbitOptions. */
    plebbitRpcUrl?: string;
    /** OAuth provider configurations. Only configured providers will be available. */
    oauth?: OAuthConfig;
    /** Risk score threshold for auto-accept (no challenge). Default: 0.2 */
    autoAcceptThreshold?: number;
    /** Risk score threshold for OAuth-sufficient challenges. Scores between autoAcceptThreshold and this need one OAuth. Above this requires additional verification. Default: 0.4 */
    oauthSufficientThreshold?: number;
    /** Risk score threshold for auto-reject. Default: 0.8 */
    autoRejectThreshold?: number;
    /** Allow non-domain (IPNS) subplebbits. Useful for local testing. Default: false */
    allowNonDomainSubplebbits?: boolean;
    /** Multiplier applied to riskScore after CAPTCHA (0-1]. Default: 0.7 (30% reduction) */
    captchaScoreMultiplier?: number;
    /** Multiplier applied to riskScore after first OAuth (0-1]. Default: 0.6 (40% reduction) */
    oauthScoreMultiplier?: number;
    /** Multiplier applied after second OAuth from a different provider (0-1]. Default: 0.5 (50% further reduction) */
    secondOauthScoreMultiplier?: number;
    /** Adjusted score must be below this to pass. Default: 0.4 */
    challengePassThreshold?: number;
    /** List of risk factor names to disable (their weight is zeroed out and redistributed) */
    disabledRiskFactors?: RiskFactorName[];
}

export interface SpamDetectionServer {
    fastify: FastifyInstance;
    db: SpamDetectionDatabase;
    indexer: Indexer | null;
    start(): Promise<string>;
    stop(): Promise<void>;
}

/**
 * Create a new BitsocialSpamBlocker server instance.
 */
export async function createServer(config: ServerConfig): Promise<SpamDetectionServer> {
    const {
        port = 3000,
        host = "0.0.0.0",
        baseUrl = `http://localhost:${port}`,
        databasePath,
        turnstileSiteKey,
        turnstileSecretKey,
        ipapiKey,
        logging = true,
        enableIndexer = true,
        enablePreviousCidCrawler = false,
        plebbitOptions: userPlebbitOptions,
        plebbitRpcUrl = DEFAULT_PLEBBIT_RPC_URL,
        oauth,
        autoAcceptThreshold,
        oauthSufficientThreshold,
        autoRejectThreshold,
        allowNonDomainSubplebbits,
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        secondOauthScoreMultiplier,
        challengePassThreshold,
        disabledRiskFactors
    } = config;

    // Build challenge tier config from provided thresholds
    const challengeTierConfig = {
        ...(autoAcceptThreshold !== undefined && { autoAcceptThreshold }),
        ...(oauthSufficientThreshold !== undefined && { oauthSufficientThreshold }),
        ...(autoRejectThreshold !== undefined && { autoRejectThreshold })
    };

    // Merge plebbitRpcUrl into plebbitOptions
    const plebbitOptions = {
        ...userPlebbitOptions,
        plebbitRpcClientsOptions: [plebbitRpcUrl]
    };

    if (!databasePath) {
        throw new Error("databasePath is required");
    }

    // Create Fastify instance
    const fastify = Fastify({
        logger: logging
            ? {
                  level: "info",
                  transport: {
                      target: "pino-pretty",
                      options: {
                          translateTime: "HH:MM:ss Z",
                          ignore: "pid,hostname"
                      }
                  },
                  serializers: {
                      // Redact signature bytes from request body to prevent terminal spam
                      req: (req) => ({
                          method: req.method,
                          url: req.url,
                          hostname: req.hostname,
                          remoteAddress: req.ip
                      })
                  }
              }
            : false
    });

    // Add CBOR content type parser
    fastify.addContentTypeParser("application/cbor", { parseAs: "buffer" }, (_request: FastifyRequest, payload: Buffer, done) => {
        try {
            const decoded = cborg.decode(payload);
            done(null, decoded);
        } catch (err) {
            done(err as Error, undefined);
        }
    });

    fastify.decorate("getPlebbitInstance", getPlebbitInstance);

    // Create database
    const db = createDatabase(databasePath);

    // Set Plebbit options for the subplebbit resolver
    setPlebbitOptions(plebbitOptions);

    // Initialize OAuth providers if configured
    const oauthProvidersResult = oauth ? createOAuthProviders(oauth, baseUrl) : undefined;

    // Initialize and start indexer immediately if enabled
    let indexer: Indexer | null = null;
    if (enableIndexer) {
        indexer = new Indexer(db.getDb(), { config: { enablePreviousCidCrawler }, plebbitOptions });
        indexer.start().catch((err) => {
            console.error("Failed to start indexer:", err);
        });
    }

    // Register routes
    registerRoutes(fastify, {
        db,
        baseUrl,
        turnstileSiteKey,
        turnstileSecretKey,
        ipapiKey,
        indexer,
        oauthProvidersResult,
        challengeTierConfig: Object.keys(challengeTierConfig).length > 0 ? challengeTierConfig : undefined,
        allowNonDomainSubplebbits,
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        secondOauthScoreMultiplier,
        challengePassThreshold,
        disabledRiskFactors
    });

    initPlebbitInstance();

    // Error handler
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
        fastify.log.error(error);

        const statusCode = error.statusCode ?? 500;
        reply.status(statusCode).send({
            error: error.message,
            statusCode
        });
    });

    return {
        fastify,
        db,
        indexer,

        async start(): Promise<string> {
            const address = await fastify.listen({ port, host });
            return address;
        },

        async stop(): Promise<void> {
            // Stop indexer first
            if (indexer) {
                await indexer.stop();
            }
            await stopIndexer();

            await fastify.close();
            db.close();
            await destroyPlebbitInstance();
        }
    };
}

// Export database utilities
export { SpamDetectionDatabase, createDatabase } from "./db/index.js";
export type { ChallengeSession, IframeIpRecord, EvaluateCallerIp, DatabaseConfig, OAuthState, OAuthProviderName } from "./db/index.js";

// Export route utilities
export { registerRoutes } from "./routes/index.js";
export type { RouteOptions } from "./routes/index.js";
export * from "./routes/schemas.js";

// Export OAuth utilities
export { createOAuthProviders, getEnabledProviders } from "./oauth/providers.js";
export type { OAuthConfig, OAuthProviders, OAuthUserIdentity } from "./oauth/providers.js";
export type { OAuthProvider } from "./challenge-iframes/types.js";

// Run server if executed directly
const isMainModule =
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("/server/dist/index.js") ||
    process.argv[1]?.endsWith("/server/src/index.ts");

if (isMainModule) {
    // Default to data directory in project root if DATABASE_PATH not provided
    const databasePath = process.env.DATABASE_PATH ?? new URL("../../../data/spam_detection.db", import.meta.url).pathname;

    // Parse optional float environment variables for challenge tier thresholds
    const parseOptionalFloat = ({ envVar, name }: { envVar: string | undefined; name: string }): number | undefined => {
        if (envVar === undefined || envVar === "") return undefined;
        const value = parseFloat(envVar);
        if (Number.isNaN(value)) {
            throw new Error(`Invalid ${name}: '${envVar}' is not a number`);
        }
        return value;
    };

    const autoAcceptThreshold = parseOptionalFloat({ envVar: process.env.AUTO_ACCEPT_THRESHOLD, name: "AUTO_ACCEPT_THRESHOLD" });
    const oauthSufficientThreshold = parseOptionalFloat({
        envVar: process.env.OAUTH_SUFFICIENT_THRESHOLD,
        name: "OAUTH_SUFFICIENT_THRESHOLD"
    });
    const autoRejectThreshold = parseOptionalFloat({ envVar: process.env.AUTO_REJECT_THRESHOLD, name: "AUTO_REJECT_THRESHOLD" });

    const captchaScoreMultiplier = parseOptionalFloat({
        envVar: process.env.CAPTCHA_SCORE_MULTIPLIER,
        name: "CAPTCHA_SCORE_MULTIPLIER"
    });
    const oauthScoreMultiplier = parseOptionalFloat({
        envVar: process.env.OAUTH_SCORE_MULTIPLIER,
        name: "OAUTH_SCORE_MULTIPLIER"
    });
    const secondOauthScoreMultiplier = parseOptionalFloat({
        envVar: process.env.SECOND_OAUTH_SCORE_MULTIPLIER,
        name: "SECOND_OAUTH_SCORE_MULTIPLIER"
    });
    const challengePassThreshold = parseOptionalFloat({
        envVar: process.env.CHALLENGE_PASS_THRESHOLD,
        name: "CHALLENGE_PASS_THRESHOLD"
    });

    // Validate score adjustment config at startup
    if (captchaScoreMultiplier !== undefined && (captchaScoreMultiplier <= 0 || captchaScoreMultiplier > 1)) {
        throw new Error("CAPTCHA_SCORE_MULTIPLIER must be in (0, 1]");
    }
    if (oauthScoreMultiplier !== undefined && (oauthScoreMultiplier <= 0 || oauthScoreMultiplier > 1)) {
        throw new Error("OAUTH_SCORE_MULTIPLIER must be in (0, 1]");
    }
    if (secondOauthScoreMultiplier !== undefined && (secondOauthScoreMultiplier <= 0 || secondOauthScoreMultiplier > 1)) {
        throw new Error("SECOND_OAUTH_SCORE_MULTIPLIER must be in (0, 1]");
    }
    if (challengePassThreshold !== undefined && (challengePassThreshold <= 0 || challengePassThreshold >= 1)) {
        throw new Error("CHALLENGE_PASS_THRESHOLD must be in (0, 1)");
    }

    // If any threshold was provided, validate the merged config at startup
    if (autoAcceptThreshold !== undefined || oauthSufficientThreshold !== undefined || autoRejectThreshold !== undefined) {
        const mergedConfig = {
            ...DEFAULT_CHALLENGE_TIER_CONFIG,
            ...(autoAcceptThreshold !== undefined && { autoAcceptThreshold }),
            ...(oauthSufficientThreshold !== undefined && { oauthSufficientThreshold }),
            ...(autoRejectThreshold !== undefined && { autoRejectThreshold })
        };
        validateChallengeTierConfig(mergedConfig);
    }

    // Parse DISABLED_RISK_FACTORS (comma-separated list of factor names)
    const validRiskFactorNames = Object.keys(WEIGHTS_NO_IP) as RiskFactorName[];
    let disabledRiskFactors: RiskFactorName[] | undefined;
    if (process.env.DISABLED_RISK_FACTORS) {
        disabledRiskFactors = process.env.DISABLED_RISK_FACTORS.split(",").map((s) => s.trim()) as RiskFactorName[];
        for (const name of disabledRiskFactors) {
            if (!validRiskFactorNames.includes(name)) {
                throw new Error(`Invalid DISABLED_RISK_FACTORS value: '${name}'. Valid values: ${validRiskFactorNames.join(", ")}`);
            }
        }
    }

    // Build OAuth config from environment variables
    const oauth: OAuthConfig = {};
    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
        oauth.github = {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET
        };
    }
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        oauth.google = {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        };
    }
    if (process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET) {
        oauth.twitter = {
            clientId: process.env.TWITTER_CLIENT_ID,
            clientSecret: process.env.TWITTER_CLIENT_SECRET
        };
    }
    if (process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET) {
        oauth.yandex = {
            clientId: process.env.YANDEX_CLIENT_ID,
            clientSecret: process.env.YANDEX_CLIENT_SECRET
        };
    }
    if (process.env.TIKTOK_CLIENT_ID && process.env.TIKTOK_CLIENT_SECRET) {
        oauth.tiktok = {
            clientId: process.env.TIKTOK_CLIENT_ID,
            clientSecret: process.env.TIKTOK_CLIENT_SECRET
        };
    }
    if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
        oauth.discord = {
            clientId: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET
        };
    }
    if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
        oauth.reddit = {
            clientId: process.env.REDDIT_CLIENT_ID,
            clientSecret: process.env.REDDIT_CLIENT_SECRET
        };
    }

    createServer({
        port: parseInt(process.env.PORT ?? "3000", 10),
        host: process.env.HOST ?? "0.0.0.0",
        baseUrl: process.env.BASE_URL,
        databasePath,
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
        turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
        ipapiKey: process.env.IPAPI_KEY,
        logging: process.env.LOG_LEVEL !== "silent",
        enableIndexer: process.env.ENABLE_INDEXER !== "false",
        enablePreviousCidCrawler: process.env.ENABLE_PREVIOUS_CID_CRAWLER === "true",
        plebbitRpcUrl: process.env.PLEBBIT_RPC_URL,
        oauth: Object.keys(oauth).length > 0 ? oauth : undefined,
        autoAcceptThreshold,
        oauthSufficientThreshold,
        autoRejectThreshold,
        allowNonDomainSubplebbits: process.env.ALLOW_NON_DOMAIN_SUBPLEBBITS === "true",
        captchaScoreMultiplier,
        oauthScoreMultiplier,
        secondOauthScoreMultiplier,
        challengePassThreshold,
        disabledRiskFactors
    })
        .then((server) => {
            // Graceful shutdown
            const shutdown = async () => {
                console.log("\nShutting down...");
                await server.stop();
                process.exit(0);
            };

            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);

            return server.start();
        })
        .then((address) => {
            console.log(`BitsocialSpamBlocker server listening at ${address}`);
        })
        .catch((err) => {
            console.error("Failed to start server:", err);
            process.exit(1);
        });
}
