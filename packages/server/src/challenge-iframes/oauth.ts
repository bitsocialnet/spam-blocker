/**
 * OAuth challenge iframe generator.
 * Displays sign-in buttons for configured OAuth providers.
 */

import type { IframeGeneratorOptions, OAuthProvider } from "./types.js";

export interface OAuthIframeOptions extends IframeGeneratorOptions {
    /** List of enabled OAuth providers to display */
    enabledProviders: OAuthProvider[];
    /** Base URL of the server */
    baseUrl: string;
}

/**
 * Provider display configuration.
 */
const PROVIDER_CONFIG: Record<OAuthProvider, { name: string; color: string; hoverColor: string; icon: string }> = {
    github: {
        name: "GitHub",
        color: "#24292e",
        hoverColor: "#1a1e22",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`
    },
    google: {
        name: "Google",
        color: "#ffffff",
        hoverColor: "#f5f5f5",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`
    },
    twitter: {
        name: "X (Twitter)",
        color: "#000000",
        hoverColor: "#1a1a1a",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
    },
    yandex: {
        name: "Yandex",
        color: "#fc3f1d",
        hoverColor: "#e63717",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.04 12c0-5.523 4.476-10 10-10 5.522 0 10 4.477 10 10s-4.478 10-10 10c-5.524 0-10-4.477-10-10zm10.146 5.412V8.088h-.486c-1.503 0-2.293.673-2.293 1.815 0 1.003.507 1.545 1.564 2.322l.871.641-2.514 4.546H7.594l2.217-3.957c-1.304-.932-2.074-1.9-2.074-3.463 0-2.088 1.463-3.503 4.077-3.503h2.12v10.923h-1.744z"/></svg>`
    },
    tiktok: {
        name: "TikTok",
        color: "#000000",
        hoverColor: "#1a1a1a",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`
    },
    discord: {
        name: "Discord",
        color: "#5865F2",
        hoverColor: "#4752c4",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`
    },
    reddit: {
        name: "Reddit",
        color: "#FF4500",
        hoverColor: "#e03d00",
        icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`
    }
};

/**
 * Generate OAuth challenge iframe HTML.
 * Displays sign-in buttons for all enabled providers.
 */
export function generateOAuthIframe(options: OAuthIframeOptions): string {
    const { sessionId, enabledProviders, baseUrl } = options;

    // Generate button HTML for each enabled provider
    const buttons = enabledProviders
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in to verify</title>
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
            transition: background-color 0.2s, transform 0.1s;
            width: 100%;
        }
        .oauth-btn:hover {
            transform: translateY(-1px);
        }
        .oauth-btn:active {
            transform: translateY(0);
        }
        .oauth-btn.light {
            color: #333;
            border: 1px solid #ddd;
        }
        .oauth-btn .icon {
            display: flex;
            align-items: center;
            justify-content: center;
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
    </style>
</head>
<body>
    <div class="container">
        <h1>Verify your identity</h1>
        <p class="subtitle">Sign in with any account to continue</p>

        <div id="buttons" class="oauth-buttons">
            ${buttons}
        </div>

        <div id="status" class="status"></div>

        <p class="privacy-note">
            Your account info is not shared with the community.<br>
            We only verify that you signed in successfully.
        </p>
    </div>

    <script>
        const sessionId = ${JSON.stringify(sessionId)};
        const baseUrl = ${JSON.stringify(baseUrl)};
        let pollInterval = null;
        let isCompleted = false;

        function startOAuth(provider) {
            // Open OAuth in new tab
            const url = baseUrl + '/api/v1/oauth/' + provider + '/start?sessionId=' + encodeURIComponent(sessionId);
            window.open(url, '_blank');

            // Start polling for completion
            startPolling();
        }

        function showStatus(message, type) {
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = 'status ' + type;
        }

        function startPolling() {
            if (pollInterval || isCompleted) return;

            showStatus('Waiting for sign-in to complete...', 'loading');

            pollInterval = setInterval(async function() {
                try {
                    const resp = await fetch(baseUrl + '/api/v1/oauth/status/' + encodeURIComponent(sessionId));
                    const data = await resp.json();

                    if (data.completed) {
                        isCompleted = true;
                        clearInterval(pollInterval);
                        pollInterval = null;
                        document.getElementById('buttons').style.display = 'none';
                        showStatus('Verification complete! Click "done" in your Bitsocial client to continue.', 'success');
                    }
                } catch (e) {
                    console.error('Polling error:', e);
                }
            }, 2000);
        }

        // Cleanup on page unload
        window.addEventListener('beforeunload', function() {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        });
    </script>
</body>
</html>`;
}
