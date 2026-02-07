/**
 * OAuth-first challenge iframe generator.
 * OAuth is the primary trust signal; CAPTCHA is a fallback for users without social accounts.
 *
 * States:
 * 1. OAuth-primary: Show OAuth buttons, "I don't have a social account" link if CAPTCHA can help
 * 2. CAPTCHA fallback: Show Turnstile widget with back link
 * 3. "Need more": After first OAuth, if score still too high, show remaining providers + optional CAPTCHA
 */

import type { IframeGeneratorOptions, OAuthProvider } from "./types.js";
import { PROVIDER_CONFIG } from "./provider-config.js";

export interface OAuthFirstIframeOptions extends IframeGeneratorOptions {
    /** Available OAuth providers (already filtered: previously-used removed) */
    availableProviders: OAuthProvider[];
    /** Base URL of the server */
    baseUrl: string;
    /** Cloudflare Turnstile site key (if configured) */
    siteKey?: string;
    /** Whether CAPTCHA alone can pass (riskScore * captchaMultiplier < passThreshold) */
    canPassWithCaptchaAlone: boolean;
    /** Whether one OAuth is enough (riskScore * oauthMultiplier < passThreshold) */
    canPassWithOneOAuth: boolean;
    /** Whether the session needs more verification after first OAuth */
    needsMore: boolean;
    /** Provider used for first OAuth (if oauthCompleted) */
    firstOAuthProvider?: string;
    /** Whether first OAuth is already completed */
    oauthCompleted: boolean;
    /** Whether CAPTCHA is already completed */
    captchaCompleted: boolean;
}

/**
 * Generate the OAuth-first challenge iframe HTML.
 */
export function generateOAuthFirstIframe(options: OAuthFirstIframeOptions): string {
    const {
        sessionId,
        availableProviders,
        baseUrl,
        siteKey,
        canPassWithCaptchaAlone,
        canPassWithOneOAuth,
        needsMore,
        firstOAuthProvider,
        oauthCompleted = false,
        captchaCompleted = false
    } = options;

    const hasTurnstile = !!siteKey;

    // Generate button HTML for available providers
    const buttons = availableProviders
        .map((provider) => {
            const config = PROVIDER_CONFIG[provider];
            const isLight = provider === "google";
            return `
                <button
                    onclick="startOAuth('${provider}')"
                    class="oauth-btn ${isLight ? "light" : ""}"
                    style="background-color: ${config.color};"
                    onmouseover="this.style.backgroundColor='${config.hoverColor}'"
                    onmouseout="this.style.backgroundColor='${config.color}'"
                >
                    <span class="icon">${config.icon}</span>
                    <span>Sign in with ${config.name}</span>
                </button>
            `;
        })
        .join("\n");

    // Determine initial view state
    let initialView: "oauth" | "captcha" | "need_more" | "completed";
    if (oauthCompleted && needsMore) {
        initialView = "need_more";
    } else if (oauthCompleted && !needsMore) {
        initialView = "completed";
    } else {
        initialView = "oauth";
    }

    // Build the first provider display if already completed
    const firstProviderName =
        firstOAuthProvider && PROVIDER_CONFIG[firstOAuthProvider as OAuthProvider]
            ? PROVIDER_CONFIG[firstOAuthProvider as OAuthProvider].name
            : firstOAuthProvider;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify your identity</title>
    ${hasTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            background: #f5f5f5;
            margin: 0;
            padding: 10px;
        }
        .container {
            background: white;
            padding: 15px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        h1 {
            font-size: 1.5rem;
            margin-bottom: 10px;
            color: #333;
        }
        .subtitle {
            color: #666;
            margin-bottom: 25px;
            font-size: 0.95rem;
        }
        .oauth-buttons {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .oauth-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 500;
            color: white;
            cursor: pointer;
            transition: background-color 0.2s, transform 0.1s, opacity 0.2s;
            width: 100%;
        }
        .oauth-btn:hover:not(:disabled) {
            transform: translateY(-1px);
        }
        .oauth-btn:active:not(:disabled) {
            transform: translateY(0);
        }
        .oauth-btn.light {
            color: #333;
            border: 1px solid #ddd;
        }
        .oauth-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .oauth-btn .icon {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .completed-badge {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 20px;
            border-radius: 8px;
            background: #e8f5e9;
            color: #2e7d32;
            font-size: 0.95rem;
            font-weight: 500;
            margin-bottom: 15px;
        }
        .completed-badge .check {
            font-size: 1.2rem;
        }
        .divider {
            display: flex;
            align-items: center;
            margin: 20px 0;
            color: #999;
            font-size: 0.85rem;
        }
        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid #e0e0e0;
        }
        .divider span {
            padding: 0 15px;
        }
        .fallback-link {
            color: #666;
            cursor: pointer;
            font-size: 0.9rem;
            text-decoration: none;
            border: none;
            background: none;
            padding: 0;
        }
        .fallback-link:hover {
            color: #333;
            text-decoration: underline;
        }
        .cf-turnstile {
            display: flex;
            justify-content: center;
            margin: 15px 0;
        }
        .status {
            margin-top: 20px;
            padding: 12px;
            border-radius: 8px;
            display: none;
            font-size: 0.95rem;
        }
        .status.loading {
            display: block;
            background: #e3f2fd;
            color: #1565c0;
        }
        .status.success {
            display: block;
            background: #e8f5e9;
            color: #2e7d32;
        }
        .status.error {
            display: block;
            background: #ffebee;
            color: #c62828;
        }
        .privacy-note {
            margin-top: 20px;
            font-size: 0.8rem;
            color: #888;
        }
        .hidden {
            display: none !important;
        }
        .back-link {
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- View: OAuth-primary -->
        <div id="view-oauth" class="${initialView === "oauth" ? "" : "hidden"}">
            <h1>Verify your identity</h1>
            <p class="subtitle">Sign in with any account to continue</p>

            <div id="oauth-buttons" class="oauth-buttons">
                ${buttons}
            </div>

            ${
                hasTurnstile && canPassWithCaptchaAlone
                    ? `
            <div class="divider"><span>or</span></div>
            <button class="fallback-link" onclick="showCaptchaView()">
                I don't have a social account
            </button>
            `
                    : ""
            }
        </div>

        <!-- View: CAPTCHA fallback -->
        <div id="view-captcha" class="hidden">
            <h1>Complete verification</h1>
            <p class="subtitle">Solve the CAPTCHA to continue</p>

            <div id="turnstile-container">
                ${
                    hasTurnstile
                        ? `
                <div
                    id="turnstile-widget"
                    class="cf-turnstile"
                    data-sitekey="${siteKey}"
                    data-callback="onTurnstileSuccess"
                    data-error-callback="onTurnstileError"
                ></div>
                `
                        : ""
                }
            </div>

            <div class="back-link">
                <button class="fallback-link" onclick="showOAuthView()">
                    &#8592; Back to sign-in options
                </button>
            </div>
        </div>

        <!-- View: Need more verification (after first OAuth) -->
        <div id="view-need-more" class="${initialView === "need_more" ? "" : "hidden"}">
            <h1>Additional verification needed</h1>

            <div id="first-oauth-badge" class="completed-badge ${oauthCompleted ? "" : "hidden"}">
                <span class="check">&#10003;</span>
                <span>Signed in with <span id="first-provider-name">${firstProviderName || ""}</span></span>
            </div>

            <p class="subtitle">Please verify with another account:</p>

            <div id="more-oauth-buttons" class="oauth-buttons">
                ${buttons}
            </div>

            ${
                hasTurnstile
                    ? `
            <div class="divider"><span>or</span></div>
            <button class="fallback-link" onclick="showNeedMoreCaptcha()">
                I don't have another account
            </button>
            `
                    : ""
            }
        </div>

        <!-- View: Need more - CAPTCHA sub-view -->
        <div id="view-need-more-captcha" class="hidden">
            <h1>Additional verification</h1>

            <div id="need-more-oauth-badge" class="completed-badge">
                <span class="check">&#10003;</span>
                <span>Signed in with <span id="need-more-provider-name"></span></span>
            </div>

            <p class="subtitle">Complete the CAPTCHA for additional verification</p>

            <div id="turnstile-container-more">
                ${
                    hasTurnstile
                        ? `
                <div
                    id="turnstile-widget-more"
                    class="cf-turnstile"
                    data-sitekey="${siteKey}"
                    data-callback="onTurnstileSuccessMore"
                    data-error-callback="onTurnstileError"
                ></div>
                `
                        : ""
                }
            </div>

            <div class="back-link">
                <button class="fallback-link" onclick="showNeedMoreView()">
                    &#8592; Back to sign-in options
                </button>
            </div>
        </div>

        <!-- View: Completed -->
        <div id="view-completed" class="${initialView === "completed" ? "" : "hidden"}">
            <h1>Verification Complete</h1>
            <p class="subtitle">Click "done" in your Bitsocial client to continue.</p>
        </div>

        <div id="status" class="status"></div>

        <p class="privacy-note">
            Your account info is not shared with the community.<br>
            We only verify that you signed in successfully.
        </p>
    </div>

    <script>
        var sessionId = ${JSON.stringify(sessionId)};
        var baseUrl = ${JSON.stringify(baseUrl)};
        var canPassWithCaptchaAlone = ${canPassWithCaptchaAlone};
        var canPassWithOneOAuth = ${canPassWithOneOAuth};
        var needsMore = ${needsMore};
        var oauthCompleted = ${oauthCompleted};
        var captchaCompleted = ${captchaCompleted};
        var firstOAuthProvider = ${JSON.stringify(firstOAuthProvider || "")};
        var pollInterval = null;
        var isCompleted = false;

        function showStatus(message, type) {
            var statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = 'status ' + type;
        }

        function hideAllViews() {
            document.getElementById('view-oauth').classList.add('hidden');
            document.getElementById('view-captcha').classList.add('hidden');
            document.getElementById('view-need-more').classList.add('hidden');
            document.getElementById('view-need-more-captcha').classList.add('hidden');
            document.getElementById('view-completed').classList.add('hidden');
            // Clear status when switching views
            document.getElementById('status').className = 'status';
        }

        function showOAuthView() {
            hideAllViews();
            document.getElementById('view-oauth').classList.remove('hidden');
        }

        function showCaptchaView() {
            hideAllViews();
            document.getElementById('view-captcha').classList.remove('hidden');
        }

        function showNeedMoreView() {
            hideAllViews();
            document.getElementById('view-need-more').classList.remove('hidden');
        }

        function showNeedMoreCaptcha() {
            hideAllViews();
            document.getElementById('need-more-provider-name').textContent =
                document.getElementById('first-provider-name').textContent;
            document.getElementById('view-need-more-captcha').classList.remove('hidden');
        }

        function showCompletedView() {
            hideAllViews();
            document.getElementById('view-completed').classList.remove('hidden');
            showStatus('Verification complete! Click "done" in your Bitsocial client to continue.', 'success');
        }

        function startOAuth(provider) {
            var url = baseUrl + '/api/v1/oauth/' + provider + '/start?sessionId=' + encodeURIComponent(sessionId);
            window.open(url, '_blank');
            startPolling();
        }

        function startPolling() {
            if (pollInterval || isCompleted) return;

            showStatus('Waiting for sign-in to complete...', 'loading');

            pollInterval = setInterval(function() {
                fetch(baseUrl + '/api/v1/oauth/status/' + encodeURIComponent(sessionId))
                    .then(function(resp) { return resp.json(); })
                    .then(function(data) {
                        if (data.completed) {
                            // Session fully completed
                            isCompleted = true;
                            clearInterval(pollInterval);
                            pollInterval = null;
                            showCompletedView();
                        } else if (data.oauthCompleted && data.needsMore) {
                            // First OAuth done but need more verification
                            clearInterval(pollInterval);
                            pollInterval = null;
                            oauthCompleted = true;
                            firstOAuthProvider = data.firstProvider || '';
                            document.getElementById('first-provider-name').textContent = data.firstProvider || 'account';

                            // Remove the provider that was just used from the "more" buttons
                            if (data.firstProvider) {
                                var moreBtns = document.getElementById('more-oauth-buttons');
                                var buttons = moreBtns.querySelectorAll('.oauth-btn');
                                buttons.forEach(function(btn) {
                                    if (btn.getAttribute('onclick') &&
                                        btn.getAttribute('onclick').indexOf("'" + data.firstProvider + "'") !== -1) {
                                        btn.remove();
                                    }
                                });
                            }

                            document.getElementById('first-oauth-badge').classList.remove('hidden');
                            showNeedMoreView();
                        } else if (data.oauthCompleted && !data.needsMore) {
                            // OAuth done, no more needed — but not yet marked as completed
                            // Keep polling until completed
                        }
                    })
                    .catch(function(e) {
                        console.error('Polling error:', e);
                    });
            }, 2000);
        }

        function onTurnstileSuccess(turnstileToken) {
            showStatus('CAPTCHA verified! Processing...', 'loading');

            fetch('/api/v1/challenge/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sessionId,
                    challengeResponse: turnstileToken,
                    challengeType: 'turnstile'
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success && data.passed) {
                    showCompletedView();
                } else if (data.success && !data.passed) {
                    // CAPTCHA alone not enough
                    if (data.oauthRequired) {
                        showStatus('CAPTCHA verified, but additional verification is required. Please sign in with a social account.', 'error');
                        showOAuthView();
                    } else {
                        showStatus('CAPTCHA verified, but your trust score still needs a boost. Please sign in below.', 'loading');
                        showOAuthView();
                    }
                } else {
                    showStatus('Verification failed: ' + (data.error || 'Unknown error'), 'error');
                }
            })
            .catch(function(error) {
                showStatus('Verification failed: ' + error.message, 'error');
            });
        }

        function onTurnstileSuccessMore(turnstileToken) {
            showStatus('CAPTCHA verified! Processing...', 'loading');

            fetch('/api/v1/challenge/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sessionId,
                    challengeResponse: turnstileToken,
                    challengeType: 'turnstile'
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success && data.passed) {
                    showCompletedView();
                } else {
                    showStatus('Verification failed: ' + (data.error || 'Additional verification needed'), 'error');
                }
            })
            .catch(function(error) {
                showStatus('Verification failed: ' + error.message, 'error');
            });
        }

        function onTurnstileError() {
            showStatus('CAPTCHA verification failed. Please try again.', 'error');
        }

        // Cleanup on page unload
        window.addEventListener('beforeunload', function() {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        });

        // If already in need-more state, auto-start polling since user may have another tab open
        if (oauthCompleted && needsMore) {
            // User may have navigated back; poll for updates
        }
    </script>
</body>
</html>`;
}
