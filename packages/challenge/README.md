# @bitsocial/spam-blocker-challenge

A Bitsocial challenge plugin that protects communities from spam by evaluating publication risk scores and optionally presenting an interactive challenge to users.

## Using Spam Blocker In Your Community

Community owners add the spam blocker challenge to their community settings. When enabled, every publication is evaluated by the Bitsocial Spam Blocker server. Low-risk publications are accepted, high-risk publications are rejected, and medium-risk publications get an iframe challenge.

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
| `autoAcceptThreshold` | `0.2`                                      | Auto-accept publications with a risk score below this value                 |
| `autoRejectThreshold` | `0.8`                                      | Auto-reject publications with a risk score above this value                 |
| `countryBlacklist`    | _(empty)_                                  | Comma-separated ISO 3166-1 alpha-2 country codes to block (e.g. `RU,CN,KP`) |
| `maxIpRisk`           | `1.0`                                      | Reject if IP risk score exceeds this threshold (estimation only)            |
| `blockVpn`            | `false`                                    | Reject publications from VPN IPs (estimation only)                          |
| `blockProxy`          | `false`                                    | Reject publications from proxy IPs (estimation only)                        |
| `blockTor`            | `false`                                    | Reject publications from Tor exit nodes (estimation only)                   |
| `blockDatacenter`     | `false`                                    | Reject publications from datacenter IPs (estimation only)                   |

## How It Works

1. When a user publishes to a community, the challenge sends the publication to the spam blocker server's `/evaluate` endpoint.
2. The server returns a **risk score** between 0 and 1.
3. Based on the configured thresholds:
    - **Below `autoAcceptThreshold`**: The publication is automatically accepted.
    - **Above `autoRejectThreshold`**: The publication is automatically rejected.
    - **Between thresholds**: The user is presented with an interactive challenge (iframe). Upon completion, the server's `/challenge/verify` endpoint confirms whether the user passed.
4. After challenge verification, additional IP-based policies (country, VPN, proxy, Tor, datacenter blocking) are applied if configured.

## License

`@bitsocial/spam-blocker-challenge` is licensed under `GPL-3.0-or-later`. See [`LICENSE`](./LICENSE).
