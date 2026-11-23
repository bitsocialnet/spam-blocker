# Bitsocial Spam Blocker

Bitsocial Spam Blocker scores posts, replies, and votes for spam risk before a community accepts them. A community installs the challenge package, which sends each publication to a spam blocker service. Low-risk publications pass, high-risk ones are rejected, and the rest are asked to verify with an OAuth sign-in or a CAPTCHA.

This repository is the public integration surface: the challenge package, the shared schemas, and the API contract. The official hosted service at `https://spamblocker.bitsocial.net/api/v1` is closed source and lives in a separate private repository. See [Hosted Spam Blocker Source Policy](./docs/architecture/hosted-service-source-policy.md) for the reasoning.

## Contents

- [Packages](#packages)
- [Quick start](#quick-start)
- [Challenge options](#challenge-options)
- [How it works](#how-it-works)
- [Pre-check pass](#pre-check-pass)
- [API contract](#api-contract)
- [Risk scoring and enforcement](#risk-scoring-and-enforcement)
- [Privacy](#privacy)
- [Known limitations](#known-limitations)
- [Development](#development)
- [License](#license)

## Packages

| Package                                                     | Path                 | License            | Purpose                                                               |
| ----------------------------------------------------------- | -------------------- | ------------------ | --------------------------------------------------------------------- |
| [`@bitsocial/spam-blocker-challenge`](./packages/challenge) | `packages/challenge` | `GPL-3.0-or-later` | pkc-js challenge that community owners install                        |
| [`@bitsocial/spam-blocker-shared`](./packages/shared)       | `packages/shared`    | `MIT`              | Zod schemas and response types shared by the challenge and the server |

## Quick start

Install the challenge on the Bitsocial server that runs your community:

```bash
bitsocial challenge install @bitsocial/spam-blocker-challenge
```

Enable it on a community:

```bash
bitsocial community edit your-community.bso '--settings.challenges[0].name' @bitsocial/spam-blocker-challenge
```

That uses the hosted service and the default thresholds. The hosted service is the recommended setup because its history across communities is what makes ban-evasion and linked-account detection possible. `serverUrl` stays configurable for any service that implements the [API contract](#api-contract).

To set options, pass them in the same command. All option values are strings.

```bash
bitsocial community edit your-community.bso \
  '--settings.challenges[0].name' @bitsocial/spam-blocker-challenge \
  '--settings.challenges[0].options.autoAcceptThreshold' '0.2' \
  '--settings.challenges[0].options.autoRejectThreshold' '0.8' \
  '--settings.challenges[0].options.countryBlacklist' 'RU,CN,KP' \
  '--settings.challenges[0].options.blockVpn' 'true' \
  '--settings.challenges[0].options.blockTor' 'true'
```

The equivalent community settings, with pkc-js `exclude` rules to skip the check for trusted authors:

```json
{
    "challenges": [
        {
            "name": "@bitsocial/spam-blocker-challenge",
            "options": {
                "serverUrl": "https://spamblocker.bitsocial.net/api/v1",
                "autoAcceptThreshold": "0.2",
                "autoRejectThreshold": "0.8",
                "countryBlacklist": "RU,CN,KP",
                "blockVpn": "true",
                "blockTor": "true"
            },
            "exclude": [{ "roles": ["owner", "admin", "moderator"] }, { "postScore": 100 }]
        }
    ]
}
```

## Challenge options

| Option                | Default                                    | Description                                                                 |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `serverUrl`           | `https://spamblocker.bitsocial.net/api/v1` | Spam blocker service URL (`http` or `https`); trailing slashes are stripped |
| `autoAcceptThreshold` | `0.2`                                      | Pass without OAuth or CAPTCHA when the risk score is below this value       |
| `autoRejectThreshold` | `0.8`                                      | Reject when the risk score is at or above this value                        |
| `countryBlacklist`    | _(empty)_                                  | Comma-separated ISO 3166-1 alpha-2 country codes to reject, e.g. `RU,CN,KP` |
| `maxIpRisk`           | `1.0`                                      | Reject when the IP risk reported by the service exceeds this value          |
| `blockVpn`            | `false`                                    | Restrict VPN IPs, including iCloud Private Relay; a sign-in unlocks them    |
| `blockProxy`          | `false`                                    | Restrict proxy IPs; a sign-in unlocks them                                  |
| `precheckExemptions`  | empty                                      | Public JSON declaration of supported challenge dependencies (see below)     |
| `blockTor`            | `false`                                    | Reject publications from Tor exit nodes                                     |
| `blockDatacenter`     | `false`                                    | Restrict datacenter IPs; a sign-in unlocks them                             |

Validation:

- Thresholds and `maxIpRisk` must be between 0 and 1, and `autoAcceptThreshold` cannot exceed `autoRejectThreshold`.
- Boolean options accept only `true` or `false`.
- An empty or missing value falls back to the default.
- An unknown country code or any other invalid option makes the challenge throw on every request, so the publication is not accepted.

The country, IP risk, VPN, proxy, Tor, and datacenter rules are applied to the result of `/challenge/verify`, after the user has passed. `blockTor`, `blockVpn`, `blockProxy`, and `blockDatacenter` are also sent in the community-signed evaluation so the service can enforce each connection policy before verification. IP classification is an estimate and can be wrong. Connection-policy rejections name the category actually reported by the service; a datacenter classification is not presented as a detected VPN. Messages list only declared whitelist/verified `.bso` exemptions and unconditional moderator-role exemptions. These policies are not cooldowns: waiting alone does not remove a connection restriction. One exception is decided by the service: an account that passed a CAPTCHA or OAuth on at least 3 separate days from unrestricted connections is exempt from `blockVpn`, `blockProxy` and `blockDatacenter` (never `blockTor`), and `/challenge/verify` reports it as `connectionExemption: "established_account"`. The hosted service also lets a new account post through a VPN, proxy or datacenter connection after it signs in: instead of rejecting the post, its challenge page asks for a sign-in, explains that posting through the connection is restricted due to abuse and how to post without signing in, and a ban in the community then follows the sign-in account. `/challenge/verify` reports that case as `connectionExemption: "sign_in"`. For either exemption it also sets `establishedAccount: true`, which is all challenge versions up to 0.1.14 read (`false` when such a connection does not qualify; rejections explain the passed-days exemption only then, since older services omit the field). Connection rejections give abuse as the reason ("Posting through a VPN has been blocked in this community due to abuse."). Only history from unrestricted connections counts, a network counts only while no other account has passed a challenge from it (one network establishes at most one account), and none counts in a community that banned an account on a network in that history, so the exemption gives nobody a connection or an extra author identity they could not already post with. iCloud Private Relay counts as a VPN; `/challenge/verify` reports `privateRelay: true` for it, and rejections name Private Relay and tell Safari users how to show their IP address to the site. A relay address blocked as a proxy or datacenter network is named with that category. Older challenge versions ignore both fields and keep rejecting those connections. A policy-enabled challenge requires complete classification evidence from `/challenge/verify`; missing or incomplete evidence fails closed without claiming a connection category. Deploy a compatible service before upgrading policy-enabled challenges. Older services that omit this evidence cannot approve those connections; communities without connection restrictions retain compatibility.

**What is public.** pkc-js strips `options` from the public community record. It publishes only `type`, `description`, `challenge`, and `exclude`. Because `challenge` is the [pre-check marker](#pre-check-pass), the server URL, connection policies (`blockTor`, `blockVpn`, `blockProxy`, and `blockDatacenter`, each set to `true` when enabled), and any explicit `precheckExemptions` policy are public. Thresholds, country restrictions, and the IP-risk limit stay private to the community operator.

## How it works

1. An author publishes a post, reply, or vote. The community's `getChallenge()` signs an evaluation payload with the community signer and returns a `url/iframe` challenge pointing at `<serverUrl>/iframe/<sessionId>/lazy#payload=...`. No request reaches the service yet.
2. The Bitsocial client asks the author before opening the iframe.
3. Once opened, the iframe posts the signed payload to `/evaluate`. The payload sits in the URL fragment, so it is not sent with the initial iframe request.
4. The service returns a risk score between 0 and 1:
    - below `autoAcceptThreshold`: the session completes;
    - at or above `autoRejectThreshold`: the session fails and the page explains why;
    - in between: the page redirects to the verification page, which asks for a CAPTCHA when a CAPTCHA alone can pass and for a sign-in otherwise (see [Iframe pages](#iframe-pages)).
5. The page tells the client the outcome is ready, and the client sends a `ChallengeAnswer` with an empty string.
6. The community calls `/challenge/verify` with the session id. On success it applies its own IP rules from the options above, then accepts or rejects the publication.

```text
getChallenge() -> lazy iframe URL (no request to the service)
  |
  v
author opens iframe -> POST /evaluate -> riskScore
  |
  ├─ <  autoAcceptThreshold -> completed ----------------------------> /challenge/verify -> success
  ├─ >= autoRejectThreshold -> failed -------------------------------> /challenge/verify -> rejected
  └─ in between -> verification page
        |
        ├─ CAPTCHA, when a CAPTCHA alone can pass
        |     ├─ enough -> completed --------------------------------> /challenge/verify -> success
        |     └─ not enough -> sign-in
        |
        └─ sign-in, for a restricted connection or a higher score
              ├─ enough -> completed --------------------------------> /challenge/verify -> success
              └─ not enough -> CAPTCHA if it finishes, else second provider
```

Other behavior of the challenge package:

- `commentEdit`, `commentModeration`, and `communityEdit` requests are accepted locally without contacting the service.
- If the service is unreachable or returns an invalid response during verify, the challenge fails with the error. It never silently accepts or rejects.
- A missing community signer fails the challenge.
- `author.community` in the forwarded request is `undefined` for authors who have never published in the community. The community fills it from its own history.

## Pre-check pass

A client can run a community's spam blocker check before it uploads an attached file, so rejected authors never upload. The community still evaluates the real signed publication, including `link`, when it is published. The pass only lets the community reuse the confirmed user-origin IP and any CAPTCHA or OAuth the author already completed, so the author does not see a second iframe.

### Public marker

The challenge package publishes `community.challenges[i].challenge = "<serverUrl>/precheck"`, for example `https://spamblocker.bitsocial.net/api/v1/precheck`. Enabled connection policies are included as query parameters, for example `<serverUrl>/precheck?blockTor=true&blockVpn=true&blockProxy=true&blockDatacenter=true`. The marker is omitted if options are invalid or a challenge-result dependency (`exclude[].challenges`) is not covered by the explicit policy below. Covered dependencies can be checked before attachment upload. Unknown or private dependencies still defer to the authoritative community checks.

A challenge is pass-capable when its `type` is `"url/iframe"` and `challenge` is an `https` (or localhost `http`) URL whose pathname ends with `/precheck`. Clients accept the `blockTor`, `blockVpn`, `blockProxy`, `blockDatacenter`, and `precheckExemptions` parameters and remove them when deriving the API base URL. The server reads the community's published policy independently.

### Obtaining a pass

1. Generate a session id `precheck-<lowercase uuid v4>`.
2. Sign a [pre-check request](#post-precheck) for the draft publication, without `link`, using the author's signer.
3. Open `<serverUrl>/iframe/<sessionId>/precheck#payload=<base64url CBOR>` as a `url/iframe` challenge.
4. After the iframe posts its answer, read `GET <serverUrl>/challenge/status/<sessionId>`.

Only `completed` produces a pass. On `failed`, or if the author closes the check before it finishes, stop before uploading. If the status cannot be read, publish without a pass and let the community check the post as usual.

### Redeeming a pass

After uploading, publish with the pre-check session id as the pre-answer of each pass-capable challenge that applies to the publication. Pre-answers are keyed by challenge index, the position in `community.challenges` as a decimal string. For example, use `challengeRequest: { challengeAnswers: { "2": pass } }` when the spam blocker is `community.challenges[2]`. Include only the challenges you pre-answer; the others get no entry.

`getChallenge()` reads its own pre-answer: `challengeAnswer` on pkc-js 0.0.152 and later, or `challengeAnswers[challengeIndex]` from the positional array that older nodes send. When it matches `^precheck-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, it posts a community-signed `/evaluate` request with `precheckSessionId`. What happens next depends on the returned `status`:

| Result                                             | Community behavior                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `completed` or `failed`                            | Answers immediately through `/challenge/verify`, so its IP, country, and network-type rules still apply |
| `pending`                                          | Returns the usual lazy iframe for the same session, which continues from the pass's CAPTCHA and OAuth   |
| Error, no `status`, or no answer within 10 seconds | Returns the usual lazy iframe, as if no pass was sent                                                   |

A pass is single use and is accepted only for the author signer and community that ran the pre-check.

### Tor-blocking communities

A successful pass still opens a brief lazy iframe when publishing, so the server can check the current connection. Earned CAPTCHA and OAuth credit is kept. This stops an author from passing a pre-check on one network and then publishing through Tor.

Community-side exemptions remain authoritative. Operators can set `options.precheckExemptions` to a JSON string declaring exactly the known challenge dependencies they use:

```json
{
    "version": 1,
    "rules": [
        { "challengeIndex": 0, "type": "verified-author-name-suffix", "suffix": ".bso" },
        {
            "challengeIndex": 1,
            "type": "whitelist",
            "urls": ["https://raw.githubusercontent.com/bitsocialnet/lists/refs/heads/master/whitelist-challenge.json"]
        }
    ]
}
```

This policy is encoded in the marker's `precheckExemptions` query parameter and signed with the public community record. It must match the actual built-in challenge settings and remain synchronized when they change: index 0 above must check `author.name` for `\\.(bso)$`, with normal name ownership validation enabled; index 1 must use the declared whitelist URLs. The factory receives only its own settings and cannot inspect sibling challenge implementations. It never infers their identity from descriptions or option names.

The server verifies the author's signing identity, checks ownership of a claimed `.bso` name, and evaluates the community's exclusion conditions. A claimed name alone grants no exemption. Version 1 supports only `.bso` and public JSON arrays of identities served over HTTPS by `raw.githubusercontent.com`, without credentials, custom ports, fragments, or redirects. Private whitelist addresses are not included in this policy. Unsupported dependencies require authoritative community evaluation instead of an early rejection.

The final community still verifies eligibility. An early exemption is not a reusable authorization to bypass other communities, challenges, or upload policies. The Tor rejection explains the configured whitelist and verified-name exceptions when this policy is present.

## API contract

All routes are relative to `serverUrl`, for example `https://spamblocker.bitsocial.net/api/v1`. Response schemas for `/evaluate` and `/challenge/verify` are exported from [`packages/shared/src/types.ts`](./packages/shared/src/types.ts).

| Route                              | Caller                  | Purpose                                             |
| ---------------------------------- | ----------------------- | --------------------------------------------------- |
| `POST /evaluate`                   | Lazy iframe, community  | Score a publication and create its session          |
| `POST /challenge/verify`           | Community               | Read the session outcome and IP intelligence        |
| `POST /precheck`                   | Pre-check iframe        | Score a draft comment before upload                 |
| `GET /challenge/status/:sessionId` | Challenge pages, client | Poll a session's state                              |
| `GET /iframe/:sessionId/lazy`      | Author's browser        | Consent-gated bootstrap page that calls `/evaluate` |
| `GET /iframe/:sessionId/precheck`  | Author's browser        | Bootstrap page that calls `/precheck`               |
| `GET /iframe/:sessionId`           | Author's browser        | Verification page (OAuth and CAPTCHA)               |
| `POST /challenge/complete`         | Verification page       | Submit a solved CAPTCHA                             |
| `GET /oauth/:provider/start`       | Verification page       | Start an OAuth sign-in                              |
| `GET /oauth/:provider/callback`    | OAuth provider          | Finish an OAuth sign-in                             |
| `GET /oauth/status/:sessionId`     | Verification page       | Poll OAuth progress                                 |

### Signed CBOR requests

`/evaluate`, `/challenge/verify`, and `/precheck` take `Content-Type: application/cbor` bodies. CBOR keeps `Uint8Array` values intact, which signature verification depends on. Responses are JSON.

To sign a request, CBOR-encode an object holding the signed properties, sign those bytes with Ed25519, and add:

```typescript
signature: {
    signature: Uint8Array; // Ed25519 signature of the CBOR-encoded signed properties
    publicKey: Uint8Array; // 32-byte Ed25519 public key
    type: "ed25519";
    signedPropertyNames: string[]; // keys of the signed object, in order
}
```

`/evaluate` and `/challenge/verify` are signed by the community signer. This stops parties unrelated to the community from querying the service about its authors. The hosted service checks that the signer matches the community, resolving domain addresses through pkc-js. `/precheck` is signed by the author.

### POST /evaluate

Request:

```typescript
{
    // DecryptedChallengeRequestMessageTypeWithCommunityAuthor from pkc-js.
    // author.community is undefined for first-time publishers.
    challengeRequest: DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
    sessionId?: string; // Caller-generated id for the lazy iframe flow; must not start with "precheck-"
    precheckSessionId?: string; // Pre-check pass being redeemed; must be signed when present
    evaluationOptions?: {
        autoAcceptThreshold?: number;
        autoRejectThreshold?: number;
        blockTor?: boolean; // Community connection policies, enforced before verification
        blockVpn?: boolean;
        blockProxy?: boolean;
        blockDatacenter?: boolean;
    };
    timestamp: number; // Unix seconds
    signature: {
        // signedPropertyNames: "challengeRequest" | "sessionId" | "evaluationOptions" | "precheckSessionId" | "timestamp"
    };
}
```

Response:

```typescript
{
    riskScore: number; // 0.0 to 1.0
    explanation?: string; // Human-readable reasoning for the score
    sessionId: string;
    challengeUrl: string; // <serverUrl>/iframe/<sessionId>
    challengeExpiresAt?: number; // Unix seconds, 1 hour after creation
    status?: "pending" | "completed" | "failed"; // Optional so responses from older servers still parse
}
```

The challenge package calls this endpoint directly only to redeem a [pre-check pass](#pre-check-pass). Otherwise the lazy iframe posts the payload after the author opens it. An unusable pass is ignored and never fails the request.

### POST /challenge/verify

Request, signed with the same community signer as the evaluation:

```typescript
{
    sessionId: string;
    timestamp: number; // Unix seconds
    signature: {
        // signedPropertyNames: ["sessionId", "timestamp"]
    }
}
```

Response:

```typescript
{
    success: boolean;
    error?: string; // One-line, user-facing reason when success is false

    // Returned on success so the community can apply its own filters
    ipRisk?: number; // 0.0 to 1.0
    ipAddressCountry?: string; // ISO 3166-1 alpha-2
    challengeType?: string; // e.g. "turnstile"
    ipTypeEstimation?: string; // Legacy primary category; do not use alone to enforce connection policy
    connectionTypes?: ("tor" | "proxy" | "vpn" | "datacenter")[]; // Every positively detected category
    ipClassificationComplete?: boolean; // Confirmed user origin and all four classification flags known
    privateRelay?: boolean; // The origin is an iCloud Private Relay egress address (also reported as "vpn")
    connectionExemption?: "established_account" | "sign_in"; // Set when the author is exempt from VPN, proxy and datacenter policies for this publication
    establishedAccount?: boolean; // Set when a VPN, proxy or datacenter connection is detected; true when connectionExemption is set (read by challenge versions up to 0.1.14)
}
```

Completion is tracked on the server. No token passes through the author's client. The community relays `error` to the author. It names the kind of problem in broad terms and never includes scores or thresholds.

### POST /precheck

Called from the author's browser through `/iframe/:sessionId/precheck`. The author identity is the signing public key. `publication.author.address` is untrusted.

Request:

```typescript
{
    sessionId: string; // "precheck-<lowercase uuid v4>", generated by the client
    communityAddress: string; // Domain or IPNS address
    publication: {
        // The comment about to be published, without link, linkWidth, or linkHeight
        author: { address: string; displayName?: string; previousCommentCid?: string };
        content?: string;
        title?: string;
        parentCid?: string;
        postCid?: string;
        spoiler?: boolean;
        nsfw?: boolean;
        flairs?: Flair[];
        timestamp: number; // Unix seconds
    };
    timestamp: number; // Unix seconds, within 5 minutes of server time
    signature: {
        // Author's signer. signedPropertyNames: ["sessionId", "communityAddress", "publication", "timestamp"], all required
    };
}
```

Response:

```typescript
{
    sessionId: string;
    status: "pending" | "completed" | "failed";
    challengeUrl: string;
    challengeExpiresAt: number; // Unix seconds, 1 hour after creation
}
```

The pre-check is not a security boundary. Redemption re-scores the real signed publication, and the community still applies its verify-time rules. Pre-check sessions never count as publishing history. The endpoint is rate-limited per client IP. Repeating a request for an existing session by the same author returns its current state, and any other reuse of the id returns 409.

### GET /challenge/status/:sessionId

Returns `{ completed, status, outcome?, warning? }` and sends `Access-Control-Allow-Origin: *`, so a client can read a pre-check's result after the cross-origin iframe posts its answer.

- `outcome` explains a rejection, or a verification step that was not enough: `{ code: "blocked" | "rejected" | "more_verification_required", title, message, retryAt? }`.
- `warning` (`{ level: "caution" | "verification_required", title, message }`) appears when many accounts have posted from the author's network.

### Iframe pages

- **`/iframe/:sessionId/lazy`** does not create a session by itself. Its script reads the signed payload from the URL fragment and posts it to `/evaluate`. It then completes, redirects to the verification page, or shows why the publication was rejected until the author presses Close.
- **`/iframe/:sessionId/precheck`** does the same for a `precheck-` session id, posting to `/precheck`.
- **`/iframe/:sessionId`** is the verification page. It shows a CAPTCHA when a CAPTCHA alone can pass at the session's score. It asks for a sign-in instead for a VPN, proxy or datacenter connection the community restricts, for a score a CAPTCHA cannot bring under the pass threshold, and after a CAPTCHA that was not enough. A sign-in that is not enough is followed by a CAPTCHA when that finishes the check, and otherwise by a sign-in with a second provider. Without a configured CAPTCHA it always asks for a sign-in; without a configured sign-in provider it serves a CAPTCHA only. Every configured provider is offered, including ones the author used before. A check that waits for verification reuses the author's last sign-in from the past 30 days, so a post that sign-in passes needs no CAPTCHA from any connection, unless a ban in the community is linked to that account or its provider is no longer offered.
- **Sign-in windows.** The verification page loads only from the address its session is bound to. It hands the sign-in window it opens a signed grant, which the service requires to start the sign-in. So the sign-in works when iCloud Private Relay or a VPN gives that window another address, and knowing a session ID is not enough to sign in to it. A sign-in link opened any other way must start on the same network as the page (the same IPv4 address or IPv6 /64), so a challenge link cannot be signed in from another network.

Challenge pages post `{ type: "challengeCompletionManaged", sessionId }` to the parent window on load. This tells the client that the page sends the answer itself, as `{ type: "challengeAnswer", challengeAnswers: [""], sessionId }`, once the author has seen the outcome.

The hosted service offers Google, Apple, and Telegram sign-in, and Cloudflare Turnstile as the CAPTCHA.

## Risk scoring and enforcement

Everything in this section describes the hosted service, not the challenge package. Fine-grained weights and heuristics are private. See the [source policy](./docs/architecture/hosted-service-source-policy.md).

### Risk score

The score is a weighted combination of account age, karma, author reputation across the network, content and link analysis, publishing velocity, IP intelligence, and linked-signer behavior. Reputation data comes from an indexer that crawls Bitsocial communities and tracks which authors get accepted, removed, or banned.

### Verification credit

Each completed verification step multiplies the risk score. The session passes when the adjusted score drops below the pass threshold (default 0.4).

| Path                                 | Default adjusted score | Passes when the raw score is below |
| ------------------------------------ | ---------------------- | ---------------------------------- |
| One OAuth sign-in                    | score × 0.6            | about 0.67                         |
| CAPTCHA only                         | score × 0.7            | about 0.57                         |
| OAuth + CAPTCHA                      | score × 0.6 × 0.7      | about 0.95                         |
| OAuth + a second, different provider | score × 0.6 × 0.5      | any score that was not rejected    |

A CAPTCHA that is not enough returns `oauthRequired`, and the page switches to the sign-in view.

### Rate limiting

Before scoring, the service can reject a publication with HTTP 429 when the author exceeds their budget. This stops manual spammers who solve every CAPTCHA.

Base limits, checked per type and then in aggregate:

| Type          | Hourly | Daily   |
| ------------- | ------ | ------- |
| post          | 4      | 20      |
| reply         | 6      | 60      |
| vote          | 10     | 200     |
| **aggregate** | **40** | **250** |

Each limit is multiplied by `ageFactor × reputationFactor`, clamped to 0.25–5.0, and never drops below 1.

| Account age           | `ageFactor` |
| --------------------- | ----------- |
| No history or < 1 day | 0.5         |
| 1–7 days              | 0.75        |
| 7–30 days             | 1.0         |
| 30–90 days            | 1.5         |
| 90–365 days           | 2.0         |
| Over 365 days         | 3.0         |

| Reputation                                  | `reputationFactor` |
| ------------------------------------------- | ------------------ |
| Any ban                                     | 0.5                |
| Removal rate above 30%                      | 0.5                |
| Removal rate 15–30%                         | 0.75               |
| Removal rate below 5% with over 10 comments | 1.25               |
| Otherwise, including no history             | 1.0                |

### Linked accounts on one network

The service links distinct signer public keys first seen on the same confirmed user-origin IP. This makes disposable accounts less useful for evading a community ban, faking a conversation, or voting on related accounts' content.

- The first three signers in a rolling 30-day window are normally treated as one person's devices, because Bitsocial accounts cannot yet sync across devices.
- More signers raise risk progressively. Rapid account churn, ban evasion, repeated failures, or replies and votes between linked signers can require stronger verification.
- Severe or compounded abuse can cause a temporary rejection for the whole network while the evidence stays in the window. Operators can also apply a manual IP block.
- Challenge pages warn authors before their network reaches the limit.

This is a defense local to the hosted service. It is not a protocol-wide identity or ban.

## Privacy

- The hosted operator stores raw IP addresses and publication content for abuse detection. All of it is visible to the operator.
- IP addresses are sent to a third-party provider for classification: proxycheck.io by default, or ipapi.is when the operator configures an ipapi.is key.
- Communities receive only the country code, the IP risk, the network type estimate, and the pass or fail result. They never receive the raw IP.
- OAuth identities (`provider:userId`) are stored by the operator with the publication and its network record, with no automatic deletion, so a ban also applies to the account. They are never shared with communities, which learn only that a sign-in succeeded.
- Sign-ins request no profile data: Google and Telegram get only the `openid` scope and Apple no scopes, so the service receives only an account ID, never a name, email, or photo. Telegram's confirmation screen still says the site receives your name, username, and photo.
- Google's and Telegram's account IDs are the same for every site that uses them. Apple's is unique to the hosted service, so no other site can match it.
- Signing in through a VPN, proxy, or relay does not reveal the author's real IP address: the service sees only the address of that connection.
- The `explanation` field gives the reasoning behind a score.

## Known limitations

- IP intelligence is a best-effort estimate and can misclassify VPNs and residential addresses.
- IP options are rejection-only by design. There is no country whitelist or other IP-based auto-approval, because it would be easy to game and could be used to flood a community.
- IP intelligence fields are optional in `/challenge/verify`. `maxIpRisk` and `countryBlacklist` apply only when the response includes `ipRisk` or `ipAddressCountry`; without that field the rule is skipped. Enabled connection policies (`blockTor`, `blockVpn`, `blockProxy`, `blockDatacenter`) are different: missing or incomplete classification fails closed, as described in [Challenge options](#challenge-options).
- IP-linked signer clusters are probabilistic. Shared households, offices, and carrier networks can group legitimate users, and attackers can rotate IPs. The allowance and the compound-signal escalation reduce false positives but cannot remove them.

## Development

Requires Node.js 22 or later and Corepack-managed Yarn.

```bash
corepack enable
```

```bash
corepack yarn install
```

| Command                       | What it does                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `corepack yarn build`         | Build `shared`, then `challenge`                            |
| `corepack yarn type-check`    | Type-check both packages                                    |
| `corepack yarn test`          | Run the challenge package's Vitest suite                    |
| `corepack yarn format`        | Format with Prettier                                        |
| `corepack yarn llms:generate` | Regenerate `llms.txt` and `llms-full.txt` after doc changes |

```text
packages/
├── challenge/   # @bitsocial/spam-blocker-challenge: getChallenge(), options schema, tests
└── shared/      # @bitsocial/spam-blocker-shared: response schemas and types
docs/
├── architecture/     # Hosted service source policy
└── agent-playbooks/  # Workflow notes for AI agents
```

AI agent rules live in [`AGENTS.md`](./AGENTS.md), with setup notes in [`docs/agent-playbooks/`](./docs/agent-playbooks/).

## License

Licensing is per package:

- [`packages/challenge`](./packages/challenge/LICENSE): `GPL-3.0-or-later`
- [`packages/shared`](./packages/shared/LICENSE): `MIT`

The repository root is marked `UNLICENSED` so the workspace metadata does not imply a single license for the whole repository. The hosted server implementation is not distributed here.
