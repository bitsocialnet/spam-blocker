# @bitsocial/spam-blocker-challenge

A Bitsocial challenge plugin that protects communities from spam by evaluating publication risk scores and optionally presenting an interactive challenge to users.

## Installation

Install the challenge using the Bitsocial CLI:

```bash
bitsocial challenge install @bitsocial/spam-blocker-challenge
```

## Configuration

Configure the challenge for your community using the CLI:

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
