# @bitsocial/spam-blocker-challenge

A Bitsocial challenge plugin that protects communities from spam by evaluating publication risk scores and optionally presenting an interactive challenge to users.

## Using Spam Blocker In Your Community

Community owners add the spam blocker challenge to their community settings. When enabled, user-generated publications return a consent-gated iframe URL. The Bitsocial Spam Blocker server evaluates the publication only after the user opens that iframe. Low-risk publications complete immediately after evaluation, high-risk publications are rejected, and medium-risk publications continue into an interactive iframe challenge. Community-level actions (`commentEdit`, `commentModeration`, and `communityEdit`) are accepted locally because they do not require spam detection.

First install the challenge on the Bitsocial server:

```bash
bitsocial challenge install @bitsocial/spam-blocker-challenge
```

Then set it on your community with one command:

```bash
bitsocial community edit your-community.bso '--settings.challenges[0].name' @bitsocial/spam-blocker-challenge
```

That uses the hosted Bitsocial Spam Blocker server and the default thresholds.

To customize thresholds or IP-based rejection rules, pass options in the same command:

```bash
bitsocial community edit your-community.bso \
  '--settings.challenges[0].name' @bitsocial/spam-blocker-challenge \
  '--settings.challenges[0].options.autoAcceptThreshold' '0.2' \
  '--settings.challenges[0].options.autoRejectThreshold' '0.8' \
  '--settings.challenges[0].options.countryBlacklist' 'RU,CN,KP' \
  '--settings.challenges[0].options.blockVpn' 'true' \
  '--settings.challenges[0].options.blockTor' 'true'
```

All option values should be strings.

## Configuration

You can also open your community settings interactively:

```bash
bitsocial community edit
```

Then add or edit the `challenges` array in your community settings to include the spam blocker challenge with your desired options.

## Options

| Option                | Default                                    | Description                                                                 |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `serverUrl`           | `https://spamblocker.bitsocial.net/api/v1` | URL of the Bitsocial spam blocker server                                    |
| `autoAcceptThreshold` | `0.2`                                      | Complete verification after iframe evaluation when risk is below this value |
| `autoRejectThreshold` | `0.8`                                      | Reject after iframe evaluation when risk is above this value                |
| `countryBlacklist`    | _(empty)_                                  | Comma-separated ISO 3166-1 alpha-2 country codes to block (e.g. `RU,CN,KP`) |
| `maxIpRisk`           | `1.0`                                      | Reject if IP risk score exceeds this threshold (estimation only)            |
| `blockVpn`            | `false`                                    | Reject publications from VPN IPs (estimation only)                          |
| `blockProxy`          | `false`                                    | Reject publications from proxy IPs (estimation only)                        |
| `blockTor`            | `false`                                    | Reject publications from Tor exit nodes (estimation only)                   |
| `blockDatacenter`     | `false`                                    | Reject publications from datacenter IPs (estimation only)                   |

## How It Works

1. When a user publishes a post, reply, or vote to a community, the challenge signs the publication locally and returns a lazy iframe URL. `getChallenge()` does not call `/evaluate`.
2. The Bitsocial client asks the user before opening the spam blocker iframe.
3. After the user opens the iframe, the iframe sends the signed payload to `/evaluate`. This is the first spam blocker server evaluation request for the publication.
4. The server returns a **risk score** between 0 and 1:
    - **Below `autoAcceptThreshold`**: Verification completes immediately.
    - **Above `autoRejectThreshold`**: Verification fails immediately.
    - **Between thresholds**: The iframe presents OAuth and/or CAPTCHA verification.
5. After challenge verification, the server's `/challenge/verify` endpoint confirms whether the user passed. Additional IP-based policies (country, VPN, proxy, Tor, datacenter blocking) are applied if configured.
6. Community-level actions (`commentEdit`, `commentModeration`, and `communityEdit`) are accepted without calling `/evaluate`.

## License

`@bitsocial/spam-blocker-challenge` is licensed under `GPL-3.0-or-later`. See [`LICENSE`](./LICENSE).
