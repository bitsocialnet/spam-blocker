/**
 * OAuth routes for social sign-in challenges.
 * Handles OAuth flow start, callback, and status polling.
 */

import type { FastifyInstance } from "fastify";
import * as arctic from "arctic";
import type { SpamDetectionDatabase } from "../db/index.js";
import type { OAuthProviders } from "../oauth/providers.js";
import { providerUsesPkce, createAuthorizationUrl, validateAuthorizationCode } from "../oauth/providers.js";
import type { OAuthProvider } from "../challenge-iframes/types.js";

/** Default multiplier applied to riskScore after first OAuth (40% reduction) */
const DEFAULT_OAUTH_SCORE_MULTIPLIER = 0.6;
/** Default multiplier applied after second OAuth from different provider (50% further reduction) */
const DEFAULT_SECOND_OAUTH_SCORE_MULTIPLIER = 0.5;
/** Default multiplier applied to riskScore after CAPTCHA (30% reduction) */
const DEFAULT_CAPTCHA_SCORE_MULTIPLIER = 0.7;
/** Default pass threshold — adjusted score must be below this to pass */
const DEFAULT_CHALLENGE_PASS_THRESHOLD = 0.4;

export interface OAuthRouteOptions {
    db: SpamDetectionDatabase;
    providers: OAuthProviders;
    /** Multiplier applied to riskScore after first OAuth (0-1]. Default: 0.6 */
    oauthScoreMultiplier?: number;
    /** Multiplier applied after second OAuth from different provider (0-1]. Default: 0.5 */
    secondOauthScoreMultiplier?: number;
    /** Multiplier applied to riskScore after CAPTCHA (0-1]. Default: 0.7 */
    captchaScoreMultiplier?: number;
    /** Adjusted score must be below this to pass. Default: 0.4 */
    challengePassThreshold?: number;
}

// OAuth state expires after 10 minutes (in milliseconds for internal storage)
const OAUTH_STATE_TTL_MS = 600 * 1000;

/**
 * Generate success page HTML shown after OAuth callback.
 */
function generateSuccessPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verification Complete</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
        }
        .success-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #155724;
            margin-bottom: 15px;
            font-size: 1.5rem;
        }
        p {
            color: #666;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">&#10003;</div>
        <h1>Verification Complete!</h1>
        <p>You can close this tab and return to your Bitsocial client.</p>
        <p style="margin-top: 10px; font-size: 0.9em; color: #888;">Click "done" in your client to continue.</p>
    </div>
</body>
</html>`;
}

/**
 * Generate "need more" page HTML shown after first OAuth when score still too high.
 */
function generateNeedMorePage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Additional Verification Needed</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
        }
        .info-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #856404;
            margin-bottom: 15px;
            font-size: 1.5rem;
        }
        p {
            color: #666;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="info-icon">&#8505;</div>
        <h1>Sign-in recorded</h1>
        <p>Additional verification is needed. Please close this tab and complete the remaining steps in the verification page.</p>
    </div>
</body>
</html>`;
}

/**
 * Generate error page HTML.
 */
function generateErrorPage(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verification Failed</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #721c24;
            margin-bottom: 15px;
            font-size: 1.5rem;
        }
        p {
            color: #666;
            line-height: 1.5;
        }
        .error-detail {
            margin-top: 15px;
            padding: 10px;
            background: #f8d7da;
            border-radius: 4px;
            color: #721c24;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">&#10007;</div>
        <h1>Verification Failed</h1>
        <p>Something went wrong during sign-in.</p>
        <div class="error-detail">${escapeHtml(error)}</div>
        <p style="margin-top: 15px;">Please close this tab and try again.</p>
    </div>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Extract the first provider from an oauthIdentity field.
 * oauthIdentity can be a single "provider:userId" or a JSON array '["provider:userId", ...]'.
 */
function getFirstProviderFromIdentity(oauthIdentity: string | null): string | undefined {
    if (!oauthIdentity) return undefined;

    // Try JSON array first
    if (oauthIdentity.startsWith("[")) {
        try {
            const arr = JSON.parse(oauthIdentity) as string[];
            if (arr.length > 0) {
                const colonIdx = arr[0].indexOf(":");
                return colonIdx > 0 ? arr[0].substring(0, colonIdx) : undefined;
            }
        } catch {
            // Fall through to single identity parsing
        }
    }

    // Single identity format "provider:userId"
    const colonIdx = oauthIdentity.indexOf(":");
    return colonIdx > 0 ? oauthIdentity.substring(0, colonIdx) : undefined;
}

/**
 * Add an OAuth identity to the session's oauthIdentity field.
 * Supports accumulating multiple identities as a JSON array.
 */
function appendOAuthIdentity(existing: string | null, newIdentity: string): string {
    if (!existing) {
        return newIdentity;
    }

    // If existing is already a JSON array, append
    if (existing.startsWith("[")) {
        try {
            const arr = JSON.parse(existing) as string[];
            arr.push(newIdentity);
            return JSON.stringify(arr);
        } catch {
            // Fall through
        }
    }

    // Convert single identity to array
    return JSON.stringify([existing, newIdentity]);
}

/**
 * Register OAuth routes on the Fastify instance.
 */
export function registerOAuthRoutes(fastify: FastifyInstance, options: OAuthRouteOptions): void {
    const { db, providers } = options;
    const oauthMultiplier = options.oauthScoreMultiplier ?? DEFAULT_OAUTH_SCORE_MULTIPLIER;
    const secondOauthMultiplier = options.secondOauthScoreMultiplier ?? DEFAULT_SECOND_OAUTH_SCORE_MULTIPLIER;
    const captchaMultiplier = options.captchaScoreMultiplier ?? DEFAULT_CAPTCHA_SCORE_MULTIPLIER;
    const passThreshold = options.challengePassThreshold ?? DEFAULT_CHALLENGE_PASS_THRESHOLD;

    // GET /api/v1/oauth/:provider/start - Start OAuth flow
    fastify.get<{
        Params: { provider: string };
        Querystring: { sessionId: string };
    }>("/api/v1/oauth/:provider/start", async (request, reply) => {
        const { provider } = request.params;
        const { sessionId } = request.query;

        // Validate provider
        if (!isValidProvider(provider)) {
            return reply.status(400).send({ error: `Invalid provider: ${provider}` });
        }

        // Check if provider is configured
        if (!providers[provider]) {
            return reply.status(400).send({ error: `Provider not configured: ${provider}` });
        }

        // Validate session exists and is pending or completed (OAuth can be added to completed sessions for future trust)
        const session = db.getChallengeSessionBySessionId(sessionId);
        if (!session) {
            return reply.status(400).send({ error: "Invalid session" });
        }
        if (session.status === "failed") {
            return reply.status(400).send({ error: "Session failed" });
        }
        if (session.expiresAt < Date.now()) {
            return reply.status(410).send({ error: "Session expired" });
        }

        // Generate state and optionally code verifier
        const state = arctic.generateState();
        const codeVerifier = providerUsesPkce(provider) ? arctic.generateCodeVerifier() : undefined;

        // Store state in database (internal timestamps are in milliseconds)
        const nowMs = Date.now();
        db.insertOAuthState({
            state,
            sessionId,
            provider,
            codeVerifier,
            createdAt: nowMs,
            expiresAt: nowMs + OAUTH_STATE_TTL_MS
        });

        // Create authorization URL
        const providerInstance = providers[provider]!;
        const authUrl = createAuthorizationUrl(providerInstance, provider, state, codeVerifier);

        // Redirect to OAuth provider
        return reply.redirect(authUrl.toString());
    });

    // GET /api/v1/oauth/:provider/callback - OAuth callback handler
    fastify.get<{
        Params: { provider: string };
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
    }>("/api/v1/oauth/:provider/callback", async (request, reply) => {
        const { provider } = request.params;
        const { code, state, error, error_description } = request.query;

        // Handle OAuth errors from provider
        if (error) {
            const errorMessage = error_description || error;
            return reply.type("text/html").send(generateErrorPage(errorMessage));
        }

        // Validate required parameters
        if (!code || !state) {
            return reply.type("text/html").send(generateErrorPage("Missing authorization code or state"));
        }

        // Validate provider
        if (!isValidProvider(provider) || !providers[provider]) {
            return reply.type("text/html").send(generateErrorPage(`Invalid provider: ${provider}`));
        }

        // Look up and validate state
        const oauthState = db.getOAuthState(state);
        if (!oauthState) {
            return reply.type("text/html").send(generateErrorPage("Invalid or expired state"));
        }

        // Verify provider matches
        if (oauthState.provider !== provider) {
            db.deleteOAuthState(state);
            return reply.type("text/html").send(generateErrorPage("Provider mismatch"));
        }

        // Check expiry (internal timestamps are in milliseconds)
        if (oauthState.expiresAt < Date.now()) {
            db.deleteOAuthState(state);
            return reply.type("text/html").send(generateErrorPage("State expired"));
        }

        // Validate session still exists and is not failed
        const session = db.getChallengeSessionBySessionId(oauthState.sessionId);
        if (!session) {
            db.deleteOAuthState(state);
            return reply.type("text/html").send(generateErrorPage("Session not found"));
        }
        if (session.status === "failed") {
            db.deleteOAuthState(state);
            return reply.type("text/html").send(generateErrorPage("Session was rejected"));
        }

        // Exchange code for token and get user identity
        const providerInstance = providers[provider]!;
        let userIdentity: { provider: string; userId: string; accountCreatedAt: number | null };
        try {
            userIdentity = await validateAuthorizationCode(providerInstance, provider, code, oauthState.codeVerifier ?? undefined);
        } catch (e) {
            db.deleteOAuthState(state);
            const errorMessage = e instanceof Error ? e.message : "Authentication failed";
            return reply.type("text/html").send(generateErrorPage(errorMessage));
        }

        const oauthIdentity = `${userIdentity.provider}:${userIdentity.userId}`;
        const riskScore = session.riskScore ?? 0;
        const nowMs = Date.now();

        // Store OAuth account creation date if available
        if (userIdentity.accountCreatedAt !== null) {
            db.updateChallengeSessionOAuthAccountCreatedAt(oauthState.sessionId, userIdentity.accountCreatedAt);
        }

        // Clean up OAuth state
        db.deleteOAuthState(state);

        // Determine if this is first or second OAuth
        const isFirstOAuth = session.oauthCompleted === 0;

        if (isFirstOAuth) {
            // First OAuth completion
            const adjustedScore = riskScore * oauthMultiplier;
            const captchaAlsoCompleted = session.captchaCompleted === 1;

            // If CAPTCHA was also completed, apply combined multiplier
            const effectiveScore = captchaAlsoCompleted ? riskScore * oauthMultiplier * captchaMultiplier : adjustedScore;

            // Store the OAuth identity
            const newIdentity = appendOAuthIdentity(session.oauthIdentity, oauthIdentity);

            if (effectiveScore < passThreshold) {
                // One OAuth (+ optional CAPTCHA) is sufficient — complete session
                db.updateChallengeSessionOAuthCompleted(oauthState.sessionId);
                db.updateChallengeSessionStatus(oauthState.sessionId, "completed", nowMs, newIdentity);

                request.log.info(
                    { sessionId: oauthState.sessionId, riskScore, effectiveScore, passThreshold, provider },
                    `OAuth sufficient: ${riskScore.toFixed(2)} × ${oauthMultiplier}${captchaAlsoCompleted ? ` × ${captchaMultiplier}` : ""} = ${effectiveScore.toFixed(2)} < ${passThreshold}`
                );

                return reply.type("text/html").send(generateSuccessPage());
            } else {
                // First OAuth not sufficient — mark oauth as completed, session stays pending
                db.updateChallengeSessionOAuthCompleted(oauthState.sessionId);
                db.updateChallengeSessionStatus(oauthState.sessionId, "pending", undefined, newIdentity);

                request.log.info(
                    { sessionId: oauthState.sessionId, riskScore, effectiveScore, passThreshold, provider },
                    `OAuth insufficient: ${riskScore.toFixed(2)} × ${oauthMultiplier}${captchaAlsoCompleted ? ` × ${captchaMultiplier}` : ""} = ${effectiveScore.toFixed(2)} >= ${passThreshold}, needs more`
                );

                return reply.type("text/html").send(generateNeedMorePage());
            }
        } else {
            // Second OAuth — verify it's from a different provider
            const firstProvider = getFirstProviderFromIdentity(session.oauthIdentity);
            if (firstProvider === provider) {
                return reply
                    .type("text/html")
                    .send(generateErrorPage("Please sign in with a different provider than your first verification"));
            }

            // Calculate combined score with second OAuth multiplier
            const captchaAlsoCompleted = session.captchaCompleted === 1;
            const effectiveScore = captchaAlsoCompleted
                ? riskScore * oauthMultiplier * secondOauthMultiplier * captchaMultiplier
                : riskScore * oauthMultiplier * secondOauthMultiplier;

            const newIdentity = appendOAuthIdentity(session.oauthIdentity, oauthIdentity);

            if (effectiveScore < passThreshold) {
                // Second OAuth passes — complete session
                db.updateChallengeSessionStatus(oauthState.sessionId, "completed", nowMs, newIdentity);

                request.log.info(
                    { sessionId: oauthState.sessionId, riskScore, effectiveScore, passThreshold, provider, firstProvider },
                    `Second OAuth sufficient: ${riskScore.toFixed(2)} × ${oauthMultiplier} × ${secondOauthMultiplier}${captchaAlsoCompleted ? ` × ${captchaMultiplier}` : ""} = ${effectiveScore.toFixed(2)} < ${passThreshold}`
                );

                return reply.type("text/html").send(generateSuccessPage());
            } else {
                // Even second OAuth not enough — store it but session stays pending
                db.updateChallengeSessionStatus(oauthState.sessionId, "pending", undefined, newIdentity);

                request.log.info(
                    { sessionId: oauthState.sessionId, riskScore, effectiveScore, passThreshold, provider, firstProvider },
                    `Second OAuth still insufficient: ${effectiveScore.toFixed(2)} >= ${passThreshold}`
                );

                return reply.type("text/html").send(generateNeedMorePage());
            }
        }
    });

    // GET /api/v1/oauth/status/:sessionId - Polling endpoint for iframe
    fastify.get<{
        Params: { sessionId: string };
    }>("/api/v1/oauth/status/:sessionId", async (request, reply) => {
        const { sessionId } = request.params;

        const session = db.getChallengeSessionBySessionId(sessionId);
        if (!session) {
            return { completed: false, error: "Session not found" };
        }

        const riskScore = session.riskScore ?? 0;
        const oauthDone = session.oauthCompleted === 1;
        const canPassWithOneOAuth = riskScore * oauthMultiplier < passThreshold;
        const needsMore = oauthDone && !canPassWithOneOAuth && session.status !== "completed";

        // Extract first provider from OAuth identity
        const firstProvider = getFirstProviderFromIdentity(session.oauthIdentity);

        return {
            completed: session.status === "completed",
            oauthCompleted: oauthDone,
            needsMore,
            firstProvider: firstProvider || undefined,
            status: session.status
        };
    });
}

/**
 * Type guard for valid OAuth providers.
 */
function isValidProvider(provider: string): provider is OAuthProvider {
    return ["github", "google", "twitter", "yandex", "tiktok", "discord", "reddit"].includes(provider);
}
