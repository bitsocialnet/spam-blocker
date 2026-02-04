import type { ChallengeType, IframeGeneratorOptions, OAuthProvider } from "./types.js";
import { generateTurnstileIframe, type TurnstileIframeOptions } from "./turnstile.js";
import { generateOAuthIframe, type OAuthIframeOptions } from "./oauth.js";
import { generateCaptchaAndOAuthIframe, type CaptchaAndOAuthIframeOptions } from "./captcha-and-oauth.js";
import { generateOAuthFirstIframe, type OAuthFirstIframeOptions } from "./oauth-first.js";

export type { ChallengeType, IframeGeneratorOptions, OAuthProvider } from "./types.js";
export { generateTurnstileIframe, type TurnstileIframeOptions } from "./turnstile.js";
export { generateOAuthIframe, type OAuthIframeOptions } from "./oauth.js";
export { generateCaptchaAndOAuthIframe, type CaptchaAndOAuthIframeOptions } from "./captcha-and-oauth.js";
export { generateOAuthFirstIframe, type OAuthFirstIframeOptions } from "./oauth-first.js";

/**
 * Generate challenge iframe HTML based on challenge type.
 *
 * @param challengeType - The type of challenge to generate
 * @param options - Options for the iframe generator
 * @returns HTML string for the iframe
 */
export function generateChallengeIframe(challengeType: ChallengeType, options: IframeGeneratorOptions): string {
    switch (challengeType) {
        case "oauth_first":
            return generateOAuthFirstIframe(options as OAuthFirstIframeOptions);
        case "turnstile":
            return generateTurnstileIframe(options as TurnstileIframeOptions);
        case "oauth":
            return generateOAuthIframe(options as OAuthIframeOptions);
        case "captcha_and_oauth":
            return generateCaptchaAndOAuthIframe(options as CaptchaAndOAuthIframeOptions);
        default:
            throw new Error(`Unknown challenge type: ${challengeType}`);
    }
}
