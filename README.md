# BitsocialSpamBlocker

## Overview

A centralized spam detection service that evaluates publications and provides risk scores to help communitys filter spam. Consists of:

1. **HTTP Server** (`@bitsocial/spam-blocker-server`) - Risk assessment and challenge server
2. **Challenge Package** (`@bitsocial/spam-blocker-challenge`) - npm package for community integration

**Important:**

- The HTTP server must import and use schemas from `pkc-js` to validate incoming challenge requests. This ensures type compatibility with `DecryptedChallengeRequestMessageTypeWithcommunityAuthor`.
- The HTTP server must verify that the publication in the ChallengeRequest is correctly signed by the author.

## Repository Structure

```
bitsocial-spam-blocker/
├── package.json                    # Root workspace config
├── tsconfig.base.json
├── packages/
│   ├── server/                     # HTTP server (Fastify + better-sqlite3)
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point
│   │   │   ├── routes/             # API endpoints
│   │   │   ├── risk-score/         # Risk scoring factors and calculation
│   │   │   ├── challenges/         # CAPTCHA providers (Turnstile, etc.)
│   │   │   ├── challenge-iframes/  # Generated HTML iframes for challenges
│   │   │   ├── oauth/              # OAuth provider configuration (arctic)
│   │   │   ├── ip-intel/           # IP intelligence (ipapi.is)
│   │   │   ├── security/           # Signature verification
│   │   │   ├── db/                 # better-sqlite3 (no ORM)
│   │   │   └── indexer/            # Background network indexer
│   │   └── scripts/                # Scenario generation, etc.
│   ├── challenge/                  # npm package for communitys
│   │   └── src/
│   │       └── index.ts            # ChallengeFileFactory
│   └── shared/                     # Shared types
│       └── src/types.ts
```

## API Endpoints

### POST /api/v1/evaluate

Evaluate publication risk. The server tracks author history internally, so no completion tokens are needed.

Requests are signed by the community signer to prevent abuse (e.g., someone unrelated to the community querying the engine to doxx users). The server validates the request signature and ensures the signer matches the community (for domain addresses, the server resolves the community via `bitsocial.getCommunity` and compares `community.signature.publicKey`). Resolved community public keys are cached in-memory for 12 hours to reduce repeated lookups. The HTTP server initializes a single shared bitsocial instance and only destroys it when the server shuts down.

**Request Format:** `Content-Type: application/cbor`

The request body is CBOR-encoded (not JSON). This preserves `Uint8Array` types during transmission and ensures signature verification works correctly.

**Request:**

```typescript
// The request wraps the DecryptedChallengeRequestMessageTypeWithcommunityAuthor from bitsocial-js
// communityAddress is required; author.community is optional (undefined for first-time publishers)
// The signature is created by CBOR-encoding the signed properties, then signing with Ed25519
{
    challengeRequest: DecryptedChallengeRequestMessageTypeWithcommunityAuthor;
    timestamp: number; // Unix timestamp (seconds)
    signature: {
        signature: Uint8Array; // Ed25519 signature of CBOR-encoded signed properties
        publicKey: Uint8Array; // 32-byte Ed25519 public key
        type: "ed25519";
        signedPropertyNames: ["challengeRequest", "timestamp"];
    }
}
```

**Response:**

```typescript
{
  riskScore: number; // 0.0 to 1.0
  explanation?: string; // Human-readable reasoning for the score

  // Pre-generated challenge URL - community can use this if it decides to challenge
  sessionId: string;
  challengeUrl: string; // Full URL: https://spamblocker.bitsocial.net/api/v1/iframe/{sessionId}
  challengeExpiresAt?: number; // Unix timestamp, 1 hour from creation
}
```

The response always includes a pre-generated `challengeUrl`. If the community decides to challenge based on `riskScore`, it can immediately send the URL to the user without making a second request. If the challenge is not used, the session auto-purges after 1 hour.

### POST /api/v1/challenge/verify

Called by the community's challenge code to verify that the user completed the iframe challenge. The server tracks challenge completion state internally - no token is passed from the user.

**Request must be signed by the community** (same signing mechanism as /evaluate), using the same signing key that was used for the evaluate request.

**Request Format:** `Content-Type: application/cbor`

**Request:**

```typescript
{
    sessionId: string; // The sessionId from the /evaluate response
    timestamp: number; // Unix timestamp (seconds)
    signature: {
        signature: Uint8Array; // Ed25519 signature of CBOR-encoded signed properties
        publicKey: Uint8Array; // 32-byte Ed25519 public key
        type: "ed25519";
        signedPropertyNames: ["sessionId", "timestamp"];
    }
}
```

**Response:**

```typescript
{
  success: boolean;
  error?: string;              // If success is false

  // The following fields are returned on success, allowing the challenge
  // code to make additional filtering decisions
  ipRisk?: number;             // 0.0 to 1.0, risk score based on IP analysis
  ipAddressCountry?: string;   // ISO 3166-1 alpha-2 country code (e.g., "US", "RU")
  challengeType?: string;      // What challenge was sent (e.g., "turnstile", "hcaptcha")
  ipTypeEstimation?: string;   // "residential" | "vpn" | "proxy" | "tor" | "datacenter" | "unknown"
}
```

### GET /api/v1/iframe/:sessionId

Serves the iframe challenge page. The iframe uses an **OAuth-first** flow where OAuth is the primary trust signal and CAPTCHA is a fallback.

- **OAuth providers** (primary): GitHub, Google, Twitter, Yandex, TikTok, Discord, Reddit
- **CAPTCHA provider** (fallback): Cloudflare Turnstile

> **Privacy note**: For OAuth providers, the server only verifies successful authentication - it does NOT share account identifiers (username, email) with the community. For IP-based intelligence, only the country code is shared, never the raw IP address.

**Iframe logic (OAuth-first):**

When OAuth providers are configured, the iframe shows OAuth buttons as the primary challenge:

1. **Initial view**: OAuth sign-in buttons. If CAPTCHA alone can pass at this score level, a "I don't have a social account" link is also shown.
2. **After first OAuth**: If `riskScore × oauthMultiplier < passThreshold` → session completes. Otherwise, "Additional verification needed" view shows remaining providers and optional CAPTCHA.
3. **CAPTCHA fallback**: Shown when the user clicks "I don't have a social account". If OAuth was already completed, the combined multiplier (OAuth × CAPTCHA) is applied.

When no OAuth is configured, a turnstile-only CAPTCHA iframe is served.

**Challenge completion flow:**

1. User signs in via OAuth (or solves CAPTCHA fallback)
2. Server applies score adjustment and determines if session passes
3. If more verification needed, iframe transitions to "need more" view
4. Once passed, iframe shows "Verification complete!"
5. The user clicks "done" in their bitsocial client (the client provides this button outside the iframe)
6. The client sends a `ChallengeAnswer` with an empty string to the community
7. The community's challenge code calls `/api/v1/challenge/verify` to check if the session is completed

### POST /api/v1/challenge/complete

Called by the iframe after the user solves the CAPTCHA (as a fallback in the OAuth-first flow). Validates the Turnstile response, then applies score adjustment to decide whether the session passes.

**Request:**

```typescript
{
  sessionId: string;
  challengeResponse: string; // Token from the challenge provider
  challengeType?: string;    // e.g., "turnstile" (default)
}
```

**Response:**

```typescript
{
  success: boolean;
  error?: string;          // Error message on failure
  passed?: boolean;        // Whether the challenge is fully passed (session completed)
  oauthRequired?: boolean; // Whether OAuth is required (CAPTCHA alone is not enough)
}
```

**Score adjustment logic:** After validating the CAPTCHA, the server checks if OAuth was already completed. If so, the combined multiplier is used: `adjustedScore = riskScore × oauthMultiplier × captchaMultiplier`. Otherwise: `adjustedScore = riskScore × captchaMultiplier`. If `adjustedScore < challengePassThreshold`, the session is marked `completed` and `passed: true` is returned. Otherwise, the CAPTCHA is marked complete but the session stays `pending`, and `passed: false, oauthRequired: true` is returned.

### OAuth Routes

**GET /api/v1/oauth/:provider/start?sessionId=...** — Initiates the OAuth flow. Generates state, stores it in the database, and redirects the user to the OAuth provider's authorization page.

**GET /api/v1/oauth/:provider/callback** — OAuth callback handler. Exchanges the authorization code for a token, retrieves the user identity, then applies score adjustment:

- **First OAuth**: If `riskScore × oauthMultiplier < passThreshold` → session completed. Otherwise, marks `oauthCompleted` and session stays pending ("need more" state).
- **Second OAuth**: Must be from a different provider. Applies `riskScore × oauthMultiplier × secondOauthMultiplier`. If below threshold → session completed.
- Multiple OAuth identities are accumulated as a JSON array in the session's `oauthIdentity` field.

**GET /api/v1/oauth/status/:sessionId** — Polling endpoint used by the iframe to check OAuth status. Returns `{ completed, oauthCompleted, needsMore, firstProvider, status }`.

## Challenge Flow (Detailed)

The challenge flow uses **server-side state tracking** - no tokens are passed from the iframe to the user's client. This matches the standard bitsocial iframe challenge pattern (used by mintpass and others).

**OAuth is the primary challenge.** The iframe shows OAuth sign-in buttons first. CAPTCHA is available as a fallback for users without social accounts. After the user completes verification, the server adjusts the risk score. If the adjusted score is below the pass threshold, the session completes. For high-risk users, additional verification (second OAuth from a different provider, or CAPTCHA) may be required.

```
/evaluate → riskScore
  │
  ├─ < autoAcceptThreshold → auto_accept (pass immediately, no challenge)
  ├─ ≥ autoRejectThreshold → auto_reject (fail immediately)
  └─ between → create session (store riskScore), return challengeUrl
        │
        ▼
  Iframe serves OAuth buttons (primary) + optional CAPTCHA fallback link
        │
        ├─ User signs in via OAuth → callback applies score adjustment
        │     │
        │     ├─ riskScore × oauthMultiplier < passThreshold?
        │     │     YES → mark "completed" ──────────────────────────> /verify → success
        │     │
        │     └─    NO  → mark oauthCompleted, session stays "pending"
        │                  Iframe shows "need more" view
        │                  │
        │                  ├─ User signs in with 2nd OAuth (different provider)
        │                  │     → riskScore × oauthMult × 2ndOauthMult < threshold?
        │                  │       YES → completed ──────────────────> /verify → success
        │                  │
        │                  └─ User completes CAPTCHA
        │                        → riskScore × oauthMult × captchaMult < threshold?
        │                          YES → completed ──────────────────> /verify → success
        │
        └─ User clicks "I don't have a social account" → CAPTCHA fallback
              │
              ├─ riskScore × captchaMultiplier < passThreshold?
              │     YES → mark "completed" ──────────────────────────> /verify → success
              │
              └─    NO  → mark captchaCompleted, return { oauthRequired: true }
                           Iframe redirects back to OAuth view
```

```
┌─────────────────┐       ┌──────────────────┐       ┌────────────────┐
│   Bitsocial       │     │ Spam Blocker     │       │   OAuth /      │
│   Client        │       │     Server       │       │   Turnstile    │
└────────┬────────┘       └────────┬─────────┘       └───────┬────────┘
         │                         │                          │
         │  1. ChallengeRequest    │                          │
         │  (to community)        │                          │
         │─────────────────────────>                          │
         │                         │                          │
         │  2. community calls /evaluate │                          │
         │                         │                          │
         │  3. riskScore +         │                          │
         │     sessionId +         │                          │
         │     challengeUrl        │                          │
         │<─────────────────────────                          │
         │                         │                          │
         │  4. If challenge needed,│                          │
         │     community sends           │                          │
         │     challengeUrl to     │                          │
         │     client              │                          │
         │                         │                          │
         │  5. Client loads iframe │                          │
         │─────────────────────────────────────────────────────>
         │                         │                          │
         │  6. Iframe shows OAuth  │                          │
         │     buttons (primary)   │                          │
         │     + CAPTCHA fallback  │                          │
         │                         │                          │
         │  7. User signs in via   │                          │
         │     OAuth provider      │                          │
         │      ───────────────────────────────────────────────>
         │                         │                          │
         │  8. OAuth callback      │                          │
         │     applies score       │                          │
         │     adjustment          │                          │
         │                         │                          │
         │  9a. If score passes    │                          │
         │      → session done     │                          │
         │  9b. If needs more      │                          │
         │      → show 2nd OAuth   │                          │
         │      or CAPTCHA option  │                          │
         │      ───────────────────────────────────────────────>
         │                         │                          │
         │  10. (If more needed)   │                          │
         │      User completes     │                          │
         │      2nd OAuth or       │                          │
         │      CAPTCHA            │                          │
         │      → session done     │                          │
         │                         │                          │
         │  11. Iframe shows       │                          │
         │     "click done"        │                          │
         │<─────────────────────────                          │
         │                         │                          │
         │  12. User clicks "done" │                          │
         │      button in client   │                          │
         │      (outside iframe)   │                          │
         │                         │                          │
         │  13. Client sends       │                          │
         │      ChallengeAnswer    │                          │
         │      with empty string  │                          │
         │─────────────────────────>                          │
         │                         │                          │
         │  14. community's verify("")   │                          │
         │      calls /verify      │                          │
         │      with sessionId     │                          │
         │                         │                          │
         │  15. success: true +    │                          │
         │      IP intelligence    │                          │
         │<─────────────────────────                          │
         │                         │                          │
         │  16. community applies        │                          │
         │      post-challenge     │                          │
         │      filters            │                          │
         │                         │                          │
         │  17. Publication        │                          │
         │      accepted/rejected  │                          │
         └─────────────────────────┘                          │
```

## Risk Score

The risk score is a value between 0.0 and 1.0 that indicates the likelihood a publication is spam or malicious. It's calculated as a weighted combination of multiple factors including account age, karma, author reputation, content analysis, velocity, and IP intelligence.

For detailed documentation on how risk scoring works, including all factors, weights, and scoring logic, see:

**[Risk Scoring Documentation](packages/server/src/risk-score/RISK_SCORING.md)**

## Indexer

The server includes a background indexer that crawls the Bitsocial network to build author reputation data. It:

- Indexes communitys and their comments/posts
- Follows `author.previousCommentCid` chains to discover new communitys
- Tracks modQueue to see which authors get accepted/rejected
- Detects bans/removals by monitoring CommentUpdate availability
- Provides network-wide author reputation data for risk scoring

For detailed documentation on the indexer architecture and implementation, see:

**[Indexer Documentation](packages/server/src/indexer/README.md)**

**Tier Thresholds (configurable per community via challenge options):**

- `riskScore < autoAcceptThreshold` → Auto-accept (no challenge)
- `autoAcceptThreshold <= riskScore < oauthSufficientThreshold` → One OAuth is sufficient (`oauth_sufficient`)
- `oauthSufficientThreshold <= riskScore < autoRejectThreshold` → OAuth + more needed (`oauth_plus_more`)
- `riskScore >= autoRejectThreshold` → Auto-reject

**Score Adjustment (configurable on server):**

OAuth is the primary trust signal. CAPTCHA is a fallback for users without social accounts.

| Path                     | Formula                             | Default           | Pass if                  |
| ------------------------ | ----------------------------------- | ----------------- | ------------------------ |
| OAuth alone              | score × oauthScoreMultiplier        | score × 0.6       | < challengePassThreshold |
| CAPTCHA alone (fallback) | score × captchaScoreMultiplier      | score × 0.7       | < challengePassThreshold |
| OAuth + second OAuth     | score × oauthMult × secondOauthMult | score × 0.6 × 0.5 | < challengePassThreshold |
| OAuth + CAPTCHA          | score × oauthMult × captchaMult     | score × 0.6 × 0.7 | < challengePassThreshold |

With default values (threshold 0.4):

- One OAuth sufficient when raw score < ~0.67
- CAPTCHA alone sufficient when raw score < ~0.57
- OAuth + second OAuth sufficient when raw score < ~1.33 (all non-auto-rejected pass)
- OAuth + CAPTCHA sufficient when raw score < ~0.95 (most non-auto-rejected pass)

## Dynamic Rate Limiting

An opt-in pre-check that hard-rejects publications (HTTP 429) when an author exceeds their budget. This runs before risk scoring and prevents manual spammers who solve CAPTCHAs from posting at high rates.

**Enabling:** Pass `rateLimitConfig: {}` in `RouteOptions` to enable with defaults. Omit it to disable entirely.

**Dynamic budgets:** Each author gets a budget multiplier based on `ageFactor × reputationFactor` (clamped 0.25–5.0):

| Account Age          | ageFactor |     | Condition              | reputationFactor |
| -------------------- | --------- | --- | ---------------------- | ---------------- |
| No history / < 1 day | 0.5       |     | Any active bans        | 0.5              |
| 1–7 days             | 0.75      |     | Removal rate > 30%     | 0.5              |
| 7–30 days            | 1.0       |     | Removal rate 15–30%    | 0.75             |
| 30–90 days           | 1.5       |     | No history or < 15%    | 1.0              |
| 90–365 days          | 2.0       |     | < 5% AND > 10 comments | 1.25             |
| > 365 days           | 3.0       |     |                        |                  |

**Base limits (at 1.0× multiplier), effective = `max(1, floor(base × multiplier))`:**

| Type          | Hourly | Daily   |
| ------------- | ------ | ------- |
| post          | 4      | 20      |
| reply         | 6      | 60      |
| vote          | 10     | 200     |
| **aggregate** | **40** | **250** |

Check order: per-type hourly → per-type daily → aggregate hourly → aggregate daily. Only user-generated content (posts, replies, votes) is rate-limited. community-level actions (commentEdit, commentModeration, communityEdit) are rejected by the evaluate endpoint since they don't require spam detection.

## Challenge Verification

Challenge completion is tracked **server-side** in the database - no tokens are passed to the user's client.

When a user completes the iframe challenge:

1. The iframe shows OAuth sign-in buttons; user signs in with a provider
2. The OAuth callback applies score adjustment (`riskScore × oauthMultiplier`)
3. If the adjusted score is below `challengePassThreshold` → session marked `completed`
4. If not → `oauthCompleted` is set, iframe shows "need more" view with remaining providers and optional CAPTCHA
5. User completes second OAuth (different provider) or CAPTCHA → combined multiplier applied → session marked `completed`
6. Alternatively, user can use CAPTCHA fallback from the start ("I don't have a social account")
7. The user clicks "done" in their bitsocial client
8. The client sends a `ChallengeAnswer` with an empty string to the community
9. The community's challenge code calls `/api/v1/challenge/verify` with the `sessionId`
10. The server checks `session.status === "completed"` and returns success + IP intelligence

**Session expiry:** 1 hour from creation

## Database Schema (SQLite + better-sqlite3)

**Tables:**

Author columns store the full `author` object from each publication (for example, `DecryptedChallengeRequestMessageTypeWithcommunityAuthor.comment.author`).

### `comments`

Stores comment publications for analysis and rate limiting.

- `sessionId` TEXT PRIMARY KEY (foreign key of challengeSessions)
- `author` TEXT NOT NULL -- is actually a JSON
- `subplebbitAddress` TEXT NOT NULL
- `parentCid` TEXT (null for posts, set for replies)
- `content` TEXT
- `link` TEXT
- `linkWidth` INTEGER
- `linkHeight` INTEGER
- `postCid` TEXT
- `signature` TEXT NOT NULL
- `title` TEXT
- `timestamp` INTEGER NOT NULL
- `linkHtmlTagName` TEXT
- `flair` TEXT
- `spoiler` INTEGER (BOOLEAN 0/1)
- `protocolVersion` TEXT NOT NULL
- `nsfw` INTEGER (BOOLEAN 0/1)
- `receivedAt` INTEGER NOT NULL

### `votes`

Stores vote publications.

- `sessionId` TEXT PRIMARY KEY (foreign key of challengeSessions)
- `author` TEXT NOT NULL -- is actually a json
- `subplebbitAddress` TEXT NOT NULL
- `commentCid` TEXT NOT NULL
- `signature` TEXT NOT NULL
- `protocolVersion` TEXT NOT NULL
- `vote` INTEGER NOT NULL (-1, 0 or 1)
- `timestamp` INTEGER NOT NULL
- `receivedAt` INTEGER NOT NULL

### `challengeSessions`

Tracks challenge sessions. Sessions are kept permanently for historical analysis. Internal timestamps (completedAt, expiresAt, receivedChallengeRequestAt, authorAccessedIframeAt) are in milliseconds.

- `sessionId` TEXT PRIMARY KEY -- UUID v4
- `subplebbitPublicKey` TEXT
- `status` TEXT DEFAULT 'pending' (pending, completed, failed)
- `completedAt` INTEGER
- `expiresAt` INTEGER NOT NULL
- `receivedChallengeRequestAt` INTEGER NOT NULL
- `authorAccessedIframeAt` INTEGER -- when did the author access the iframe?
- `oauthIdentity` TEXT -- format: "provider:userId" or JSON array '["provider:userId", ...]'
- `challengeTier` TEXT -- 'oauth_sufficient' or 'oauth_plus_more' (determined by score thresholds)
- `captchaCompleted` INTEGER DEFAULT 0 -- 1 if CAPTCHA portion completed
- `oauthCompleted` INTEGER DEFAULT 0 -- 1 if first OAuth completed
- `riskScore` REAL -- the risk score at evaluation time (used for score adjustment after OAuth/CAPTCHA)

### `ipRecords`

Stores raw IP addresses associated with authors (captured via iframe). One record per challenge.

- `sessionId` TEXT NOT NULL (foreign key to challengeSessions.sessionId) PRIMARY KEY
- `ipAddress` TEXT NOT NULL -- ip address string representation
- `isVpn` INTEGER (BOOLEAN 0/1)
- `isProxy` INTEGER (BOOLEAN 0/1)
- `isTor` INTEGER (BOOLEAN 0/1)
- `isDatacenter` INTEGER (BOOLEAN 0/1)
- `countryCode` TEXT -- ISO 3166-1 alpha-2 country code
- `timestamp` INTEGER NOT NULL -- when did we query the ip provider

### `oauthStates`

Ephemeral table for CSRF protection during OAuth flow. Internal timestamps (createdAt, expiresAt) are in milliseconds.

- `state` TEXT PRIMARY KEY
- `sessionId` TEXT NOT NULL (foreign key to challengeSessions)
- `provider` TEXT NOT NULL -- 'github', 'google', 'twitter', etc.
- `codeVerifier` TEXT -- PKCE code verifier (required for google, twitter)
- `createdAt` INTEGER NOT NULL
- `expiresAt` INTEGER NOT NULL

## Challenge Code (npm package)

Implements plebbit-js `ChallengeFileFactory`:

```typescript
// Usage in community settings
{
  "challenges": [{
    "name": "@bitsocial/spam-blocker-challenge",
    "options": {
      "serverUrl": "https://spamblocker.bitsocial.net/api/v1",
      "autoAcceptThreshold": "0.2",
      "autoRejectThreshold": "0.8",
      "countryBlacklist": "RU,CN,KP",
      "blockVpn": "true",
      "blockTor": "true"
    },
    "exclude": [
      { "role": ["owner", "admin", "moderator"] },
      { "postScore": 100 }
    ]
  }]
}
```

When calling `/api/v1/evaluate`, the `author.subplebbit` field in the publication
(e.g., `challengeRequest.comment.author.subplebbit`) may be `undefined` for first-time
publishers who have never posted in the community before. The community populates this
field from its internal database of author history, so new authors won't have it set.

### Configuration Options (Challenge Package)

| Option                | Default                                    | Description                                                                    |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `serverUrl`           | `https://spamblocker.bitsocial.net/api/v1` | URL of the BitsocialSpamBlocker server (must be http/https)                    |
| `autoAcceptThreshold` | `0.2`                                      | Auto-accept publications below this risk score                                 |
| `autoRejectThreshold` | `0.8`                                      | Auto-reject publications above this risk score                                 |
| `countryBlacklist`    | `""`                                       | Comma-separated ISO 3166-1 alpha-2 country codes to block (e.g., `"RU,CN,KP"`) |
| `maxIpRisk`           | `1.0`                                      | Reject if ipRisk from /verify exceeds this threshold                           |
| `blockVpn`            | `false`                                    | Reject publications from VPN IPs (`true`/`false` only)                         |
| `blockProxy`          | `false`                                    | Reject publications from proxy IPs (`true`/`false` only)                       |
| `blockTor`            | `false`                                    | Reject publications from Tor exit nodes (`true`/`false` only)                  |
| `blockDatacenter`     | `false`                                    | Reject publications from datacenter IPs (`true`/`false` only)                  |

**Post-challenge filtering:** After a user completes a challenge, the `/verify` response includes IP intelligence data. The challenge code uses the above options to reject publications even after successful challenge completion (e.g., if the user is from a blacklisted country or using a VPN).

**Error Handling:** If the server is unreachable, the challenge code throws an error (does not silently accept or reject). This ensures the community owner is notified of issues.

**Privacy of options:** The `options` object (including `serverUrl` and all threshold/filtering settings) is **not** exposed in the public `community.challenges` IPFS record. bitsocial-js strips `options` when computing the public `communityChallenge` from `communityChallengeSetting`, so only `type`, `description`, and `exclude` are published. This means the server URL, thresholds, and filtering rules remain private to the community operator.

### Server Configuration (separate from challenge)

These settings are configured on the HTTP server, not in the challenge package:

**Required:**

- `DATABASE_PATH`: Path to the SQLite database file. Use `:memory:` for in-memory.

**Challenge providers:**

- `TURNSTILE_SITE_KEY`: Cloudflare Turnstile site key
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret key
- `BASE_URL`: Base URL for OAuth callbacks (e.g., `https://spamblocker.bitsocial.net`)

**IP Intelligence:**

- `IPAPI_KEY`: ipapi.is API key for IP intelligence lookups (optional — works without key)

**Challenge tier thresholds:**

- `AUTO_ACCEPT_THRESHOLD`: Auto-accept below this score (default: 0.2)
- `OAUTH_SUFFICIENT_THRESHOLD`: Scores between autoAccept and this pass with one OAuth (default: 0.4)
- `AUTO_REJECT_THRESHOLD`: Auto-reject at or above this score (default: 0.8)

**Score adjustment (OAuth-first model):**

- `OAUTH_SCORE_MULTIPLIER`: Multiplier applied after first OAuth, in (0, 1] (default: 0.6)
- `SECOND_OAUTH_SCORE_MULTIPLIER`: Multiplier applied after second OAuth from different provider, in (0, 1] (default: 0.5)
- `CAPTCHA_SCORE_MULTIPLIER`: Multiplier applied after CAPTCHA (fallback), in (0, 1] (default: 0.7)
- `CHALLENGE_PASS_THRESHOLD`: Adjusted score must be below this, in (0, 1) (default: 0.4)

**OAuth providers** (each requires both CLIENT_ID and CLIENT_SECRET):

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET`
- `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET`
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`

**Risk factor disabling:**

- `DISABLED_RISK_FACTORS`: Comma-separated list of risk factor names to disable. Disabled factors get `weight=0` and their weight is redistributed to remaining factors. Valid values: `commentContentTitleRisk`, `commentUrlRisk`, `velocityRisk`, `accountAge`, `karmaScore`, `ipRisk`, `networkBanHistory`, `modqueueRejectionRate`, `networkRemovalRate`, `socialVerification`, `walletVerification`. Example: `DISABLED_RISK_FACTORS=walletVerification`

**Other:**

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `LOG_LEVEL`: Set to `silent` to disable logging
- `PLEBBIT_RPC_URL`: Plebbit RPC URL for subplebbit resolution
- `ALLOW_NON_DOMAIN_SUBPLEBBITS`: Set to `true` to allow non-domain subplebbit addresses

## Key Design Decisions

- **Database:** SQLite with better-sqlite3, no ORM
- **Content Analysis:** Server-side setting, enabled by default
- **Primary Challenge Provider:** Cloudflare Turnstile (free, privacy-friendly)
- **Challenge Model:** CAPTCHA-first with score-based OAuth gating (CAPTCHA always required; OAuth only if score remains too high after adjustment)
- **OAuth Library:** Arctic (lightweight, supports many providers)
- **Error Handling:** Always throw on server errors (no silent failures)
- **IP Storage:** Raw IPs stored (not hashed) for accurate analysis
- **IP Intelligence:** ipapi.is (external HTTP API, best-effort, works without API key)
- **Ephemeral Sessions:** Challenge sessions auto-purge after 1 hour

## Privacy Considerations

- Raw IPs are stored for spam detection purposes
- Content analysis is performed on the server
- IP intelligence lookups are sent to ipapi.is when enabled
- OAuth identity (provider:userId) is stored server-side but never shared with communities
- All data is visible to the server operator
- Open source for auditability
- Explanation field shows reasoning for scores

## Known Limitations

- IP intelligence fields are best-effort estimates and can be wrong (e.g., VPNs, residential IPs, or misclassification)
- Treat IP intelligence as informational and use it only for rejection decisions
- IP intelligence fields are optional and may be removed from the engine response in the future; challenge code only applies IP filtering options when they are present
- IP-based options are intentionally rejection-only; we do not support IP-derived auto-approval (e.g., a country whitelist), because it is easy to game and can be used to flood a community

## Implementation Steps

1. **Setup monorepo** with npm workspaces, TypeScript, ESM
2. **Implement shared types** package
3. **Build server**:
    - Fastify setup with routes
    - better-sqlite3 database
    - Import plebbit-js schemas for validation
    - Risk scoring with weighted factors
    - Ed25519 request signature verification
    - Turnstile integration
    - OAuth providers (arctic)
    - Challenge iframe generation (CAPTCHA-first with score-based OAuth gating)
    - IP intelligence (ipapi.is)
    - Background network indexer
4. **Build challenge package**:
    - ChallengeFileFactory implementation
    - HTTP client for server communication
5. **Testing**: Unit tests, integration tests with bitsocial-js
6. **Documentation**: README, API docs, risk score scenarios

## Verification Plan

1. Run server locally: `DATABASE_PATH=spam_detection.db npm run dev`
2. Test /evaluate endpoint with `{ challengeRequest: DecryptedChallengeRequestMessageTypeWithcommunityAuthor }`
3. Test iframe flow using challengeUrl from /evaluate response
4. Test /challenge/verify with valid and invalid tokens
5. Test post-challenge filtering (country blacklist, VPN blocking, etc.)
6. Integrate challenge package with local plebbit-js community
7. Verify full end-to-end flow

## Reference Files

- bitsocial-js challenge example: `plebbit-js/src/runtime/node/community/challenges/bitsocial-js-challenges/captcha-canvas-v3/index.ts`
- bitsocial-js schemas: `plebbit-js/src/community/schema.ts`
- bitsocial-js challenge orchestration: `plebbit-js/src/runtime/node/community/challenges/index.ts`
- MintPass iframe challenge: https://github.com/bitsociallabs/mintpass/tree/master/challenge
