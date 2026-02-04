/**
 * Supported challenge types for iframe generation.
 * - oauth_first: OAuth-primary with CAPTCHA fallback (new default)
 * - turnstile: CAPTCHA-only fallback (when no OAuth providers configured)
 * - oauth: OAuth-only (legacy, when no Turnstile configured)
 * - captcha_and_oauth: Combined CAPTCHA + OAuth (legacy)
 */
export type ChallengeType = "oauth_first" | "turnstile" | "oauth" | "captcha_and_oauth";

/**
 * Supported OAuth providers for the oauth challenge type.
 */
export type OAuthProvider = "github" | "google" | "twitter" | "yandex" | "tiktok" | "discord" | "reddit";

/**
 * Options passed to iframe generator functions.
 */
export interface IframeGeneratorOptions {
    /** Unique challenge session ID */
    sessionId: string;
    /** Provider-specific options (e.g., siteKey for Turnstile) */
    [key: string]: unknown;
}

/**
 * Function signature for iframe generators.
 */
export type IframeGenerator = (options: IframeGeneratorOptions) => string;
