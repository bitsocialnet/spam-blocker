# Risk Score Scenarios

_Generated: 2026-02-07_

This document shows how risk scores are calculated for various user scenarios across different
configuration combinations. Each scenario represents a realistic user profile with specific
behavioral patterns.

## Configuration Variables

Each scenario is tested against all combinations of:

**IP Intelligence:**

- No IP check (disabled)
- Residential IP (low risk)
- Datacenter IP (elevated risk)
- VPN detected (high risk)
- Tor exit node (very high risk)

**OAuth Configuration:**

- OAuth disabled
- OAuth enabled but user not verified
- Google verified
- Google + GitHub verified

**Publication Types:** Posts, Replies, Votes

**Total: 5 IP types × 4 OAuth configs × 3 publication types = 60 configurations per scenario**

## Challenge Tier Thresholds

| Score Range | Tier          | Action                                                                 |
| ----------- | ------------- | ---------------------------------------------------------------------- |
| 0.0 - 0.2   | Auto-accepted | No challenge required                                                  |
| 0.2 - 0.8   | Challenge     | CAPTCHA always required; OAuth may be needed based on score adjustment |
| 0.8 - 1.0   | Auto-rejected | Publication automatically rejected                                     |

## Score Adjustment Model

After evaluation, CAPTCHA is always the first challenge. The score is then adjusted:

| Stage                 | Multiplier | Formula           | Pass if |
| --------------------- | ---------- | ----------------- | ------- |
| After CAPTCHA         | ×0.7       | score × 0.7       | < 0.4   |
| After CAPTCHA + OAuth | ×0.35      | score × 0.7 × 0.5 | < 0.4   |

- **CAPTCHA alone sufficient** when raw score < 0.57
- **CAPTCHA + OAuth sufficient** when raw score < 1.14
- Scores ≥ 0.8 are auto-rejected regardless

---

## Scenario 1: Brand New User

A completely new user making their first post with no history.

**Example Publication:**

```
title: "First time posting here!"
content: "Hey everyone, just discovered plebbit and wanted to introduce myself..."
```

**Author Profile:**

| Attribute          | Value      | Risk Implication       |
| ------------------ | ---------- | ---------------------- |
| Account Age        | no history | High risk (no history) |
| Karma              | no data    | Unknown (neutral)      |
| Active Bans        | 0          | Skipped (no history)   |
| Velocity           | normal     | No risk                |
| Content Duplicates | none       | Low risk (unique)      |
| URL Spam           | no urls    | Low risk               |
| ModQueue Rejection | No data    | Unknown (neutral)      |
| Removal Rate       | No data    | Unknown (neutral)      |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | OAuth enabled (unverified) | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | Google + GitHub verified   | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Datacenter  | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| VPN         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| Tor         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 22.6%    | 0.23         |
| Karma Score         | 0.60  | no data        | 19.4%    | 0.12         |
| Content/Title Risk  | 0.20  | unique content | 22.6%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 19.4%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 16.1%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.44**     |

**Outcome:** OAuth + more — Raw score 0.44. After CAPTCHA: 0.44 × 0.7 = 0.31 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 2: Established Trusted User

A well-established user with 90+ days history, positive karma, Google verification, and an active wallet (250+ tx).

**Example Publication:**

```
title: "Question about plebbit development"
content: "Has anyone figured out how to run a subplebbit on a VPS? I've been here a while and still learning..."
```

**Author Profile:**

| Attribute          | Value            | Risk Implication        |
| ------------------ | ---------------- | ----------------------- |
| Account Age        | 90 days          | Low risk (established)  |
| Karma              | +5               | Low risk (positive)     |
| Active Bans        | 0                | Low risk (clean record) |
| Velocity           | normal           | No risk                 |
| Content Duplicates | none             | Low risk (unique)       |
| URL Spam           | no urls          | Low risk                |
| ModQueue Rejection | 0%               | Low risk                |
| Removal Rate       | 0%               | Low risk                |
| OAuth Verification | google           | Reduced risk (verified) |
| Wallet Activity    | 250 transactions | Very strong activity    |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                               |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 90+ days), Content/Title Risk (0.20, unique content)   |
| No IP check | OAuth enabled (unverified) | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified) |
| No IP check | Google verified            | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified) |
| No IP check | Google + GitHub verified   | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified) |
| Residential | OAuth disabled             | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 90+ days), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.21      | 0.14 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), IP Risk (0.20, residential IP)              |
| Residential | Google verified            | 0.21      | 0.14 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), IP Risk (0.20, residential IP)              |
| Residential | Google + GitHub verified   | 0.21      | 0.14 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 90+ days)               |
| Datacenter  | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 90+ days)               |
| Datacenter  | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 90+ days)               |
| Datacenter  | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 90+ days)               |
| VPN         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 90+ days)                |
| VPN         | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 90+ days)                |
| VPN         | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 90+ days)                |
| VPN         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 90+ days)                |
| Tor         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 90+ days)               |
| Tor         | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 90+ days)               |
| Tor         | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 90+ days)               |
| Tor         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 90+ days)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days             | 15.2%    | 0.08         |
| Karma Score         | 0.10  | positive (+5)        | 13.0%    | 0.01         |
| Content/Title Risk  | 0.20  | unique content       | 15.2%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs              | 13.0%    | 0.03         |
| Velocity            | 0.10  | normal rate          | 10.9%    | 0.01         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | 0.12  | no active bans       | 10.9%    | 0.01         |
| ModQueue Rejection  | 0.10  | 0% rejected          | 6.5%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed           | 8.7%     | 0.01         |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.10  | 250 tx (very strong) | 6.5%     | 0.01         |
| **Total**           |       |                      | **100%** | **0.19**     |

**Outcome:** Auto-accepted — Score 0.19 falls in the auto-accept tier (< 0.2), allowing the publication without any challenge.

---

## Scenario 3: New User with Link

A very new user (<1 day) posting with a single URL.

**Example Publication:**

```
link: "https://myblog.example.com/decentralization-thoughts"
title: "I wrote about my experience with decentralized social media"
content: "Check out my thoughts on the future of social platforms..."
```

**Author Profile:**

| Attribute          | Value    | Risk Implication      |
| ------------------ | -------- | --------------------- |
| Account Age        | <1 day   | High risk (very new)  |
| Karma              | no data  | Unknown (neutral)     |
| Active Bans        | 0        | Skipped (no history)  |
| Velocity           | normal   | No risk               |
| Content Duplicates | none     | Low risk (unique)     |
| URL Spam           | 1 unique | Low risk (single URL) |
| ModQueue Rejection | No data  | Unknown (neutral)     |
| Removal Rate       | No data  | Unknown (neutral)     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| No IP check | OAuth enabled (unverified) | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| No IP check | Google + GitHub verified   | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| Residential | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| Residential | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| Residential | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)              |
| Datacenter  | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| VPN         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| Tor         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | Google verified            | 0.58      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | <1 day old     | 22.6%    | 0.23         |
| Karma Score         | 0.60  | no data        | 19.4%    | 0.12         |
| Content/Title Risk  | 0.20  | unique content | 22.6%    | 0.05         |
| URL/Link Risk       | 0.20  | 1 unique URL   | 19.4%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 16.1%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.44**     |

**Outcome:** OAuth + more — Raw score 0.44. After CAPTCHA: 0.44 × 0.7 = 0.31 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 4: Repeat Link Spammer

A user with negative karma, 1 active ban out of 5 subs, posting the same link repeatedly.

**Example Publication:**

```
link: "https://sketchy.io/buy/crypto?ref=abc123"
title: "FREE CRYPTO - Don't miss out!!!"
content: "Click here for FREE money!!!"
```

**Author Profile:**

| Attribute          | Value    | Risk Implication         |
| ------------------ | -------- | ------------------------ |
| Account Age        | 7 days   | Moderate risk            |
| Karma              | -5       | High risk (negative)     |
| Active Bans        | 1/5 subs | Moderate risk            |
| Velocity           | elevated | Moderate risk            |
| Content Duplicates | none     | Low risk (unique)        |
| URL Spam           | 5+ same  | High risk (repeated URL) |
| ModQueue Rejection | 50%      | Moderate risk            |
| Removal Rate       | 30%      | Moderate risk            |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.57      | 0.40 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| No IP check | OAuth enabled (unverified) | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| No IP check | Google verified            | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| No IP check | Google + GitHub verified   | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | OAuth disabled             | 0.48      | 0.34 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | OAuth enabled (unverified) | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | Google + GitHub verified   | 0.48      | 0.34 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Datacenter  | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| Datacenter  | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| Datacenter  | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| Datacenter  | Google + GitHub verified   | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| VPN         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| VPN         | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| VPN         | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| VPN         | Google + GitHub verified   | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| Tor         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |
| Tor         | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |
| Tor         | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |
| Tor         | Google + GitHub verified   | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description            | Weight   | Contribution |
| ------------------- | ----- | ---------------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days                | 16.3%    | 0.08         |
| Karma Score         | 0.90  | negative karma         | 14.0%    | 0.13         |
| Content/Title Risk  | 0.20  | unique content         | 16.3%    | 0.03         |
| URL/Link Risk       | 1.00  | 5+ same URL            | 14.0%    | 0.14         |
| Velocity            | 0.40  | elevated rate          | 11.6%    | 0.05         |
| IP Risk             | -     | skipped                | 0%       | (skipped)    |
| Ban History         | 0.50  | 1 active ban in 5 subs | 11.6%    | 0.06         |
| ModQueue Rejection  | 0.50  | 50% rejected           | 7.0%     | 0.03         |
| Removal Rate        | 0.50  | 30% removed            | 9.3%     | 0.05         |
| Social Verification | -     | skipped                | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet              | 0%       | (skipped)    |
| **Total**           |       |                        | **100%** | **0.57**     |

**Outcome:** OAuth + more — Raw score 0.57. After CAPTCHA: 0.57 × 0.7 = 0.40 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 5: Content Duplicator

A user spamming the same content across multiple posts.

**Example Publication:**

```
title: "Amazing opportunity you can't miss"
content: "This is duplicate spam content that appears multiple times."
```

**Author Profile:**

| Attribute          | Value    | Risk Implication         |
| ------------------ | -------- | ------------------------ |
| Account Age        | 30 days  | Low-moderate risk        |
| Karma              | 0        | Neutral                  |
| Active Bans        | 0        | Low risk (clean record)  |
| Velocity           | elevated | Moderate risk            |
| Content Duplicates | 5+       | High risk (spam pattern) |
| URL Spam           | no urls  | Low risk                 |
| ModQueue Rejection | No data  | Unknown (neutral)        |
| Removal Rate       | No data  | Unknown (neutral)        |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                        |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Karma Score (0.60, neutral)              |
| No IP check | OAuth enabled (unverified) | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.55, 5+ duplicates) |
| No IP check | Google verified            | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Karma Score (0.60, neutral)              |
| No IP check | Google + GitHub verified   | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Karma Score (0.60, neutral)              |
| Residential | OAuth disabled             | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Account Age (0.50, ~30 days)             |
| Residential | OAuth enabled (unverified) | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.55, 5+ duplicates) |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Account Age (0.50, ~30 days)             |
| Residential | Google + GitHub verified   | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | Velocity (0.70, elevated rate), Content/Title Risk (0.55, 5+ duplicates)           |
| Datacenter  | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.55, 5+ duplicates)            |
| Datacenter  | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)            |
| Datacenter  | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.55, 5+ duplicates)            |
| Datacenter  | Google + GitHub verified   | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Velocity (0.70, elevated rate)                      |
| VPN         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.55, 5+ duplicates)             |
| VPN         | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)             |
| VPN         | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.55, 5+ duplicates)             |
| VPN         | Google + GitHub verified   | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Velocity (0.70, elevated rate)                       |
| Tor         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.55, 5+ duplicates)            |
| Tor         | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)            |
| Tor         | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.55, 5+ duplicates)            |
| Tor         | Google + GitHub verified   | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Velocity (0.70, elevated rate)                      |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~30 days       | 17.5%    | 0.09         |
| Karma Score         | 0.60  | neutral        | 15.0%    | 0.09         |
| Content/Title Risk  | 0.55  | 5+ duplicates  | 17.5%    | 0.10         |
| URL/Link Risk       | 0.20  | no URLs        | 15.0%    | 0.03         |
| Velocity            | 0.40  | elevated rate  | 12.5%    | 0.05         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 12.5%    | 0.04         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 10.0%    | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.40**     |

**Outcome:** OAuth + more — Raw score 0.40. After CAPTCHA: 0.40 × 0.7 = 0.28 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 6: Bot-like Velocity

A very new user posting at automated/bot-like rates.

**Example Publication:**

```
title: "Post #47 in the last hour"
content: "Automated content generation test message..."
```

**Author Profile:**

| Attribute          | Value    | Risk Implication          |
| ------------------ | -------- | ------------------------- |
| Account Age        | <1 day   | High risk (very new)      |
| Karma              | no data  | Unknown (neutral)         |
| Active Bans        | 0        | Skipped (no history)      |
| Velocity           | bot_like | Very high risk (bot-like) |
| Content Duplicates | none     | Low risk (unique)         |
| URL Spam           | no urls  | Low risk                  |
| ModQueue Rejection | No data  | Unknown (neutral)         |
| Removal Rate       | No data  | Unknown (neutral)         |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| No IP check | OAuth enabled (unverified) | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| No IP check | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| No IP check | Google + GitHub verified   | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | OAuth disabled             | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | Google + GitHub verified   | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Datacenter  | OAuth disabled             | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | OAuth enabled (unverified) | 0.74      | 0.51 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | Google verified            | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| VPN         | OAuth disabled             | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | OAuth enabled (unverified) | 0.74      | 0.51 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | Google verified            | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| Tor         | OAuth disabled             | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | OAuth enabled (unverified) | 0.74      | 0.51 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | Google verified            | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | <1 day old     | 22.6%    | 0.23         |
| Karma Score         | 0.60  | no data        | 19.4%    | 0.12         |
| Content/Title Risk  | 0.20  | unique content | 22.6%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 19.4%    | 0.04         |
| Velocity            | 0.95  | bot-like rate  | 16.1%    | 0.15         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.58**     |

**Outcome:** OAuth + more — Raw score 0.58. After CAPTCHA: 0.58 × 0.7 = 0.41 >= 0.4 — CAPTCHA not sufficient. After CAPTCHA+OAuth: 0.58 × 0.35 = 0.20 < 0.4 — **CAPTCHA + OAuth passes**.

---

## Scenario 7: Serial Offender

A known bad actor with 3 active bans out of 5 subs, negative karma, and moderate spam history.

**Example Publication:**

```
link: "https://192.168.1.100/download.exe"
title: "FREE SOFTWARE DOWNLOAD NOW"
content: "CLICK HERE NOW!!! DON'T MISS OUT!!!"
```

**Author Profile:**

| Attribute          | Value    | Risk Implication       |
| ------------------ | -------- | ---------------------- |
| Account Age        | 90 days  | Low risk (established) |
| Karma              | -5       | High risk (negative)   |
| Active Bans        | 3/5 subs | High risk              |
| Velocity           | elevated | Moderate risk          |
| Content Duplicates | 3        | Moderate risk          |
| URL Spam           | 1 unique | Low risk (single URL)  |
| ModQueue Rejection | 80%      | High risk              |
| Removal Rate       | 60%      | High risk              |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                     |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Account Age (0.50, 90+ days)                |
| No IP check | OAuth enabled (unverified) | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | Karma Score (0.90, negative karma), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Account Age (0.50, 90+ days)                |
| No IP check | Google + GitHub verified   | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Account Age (0.50, 90+ days)                |
| Residential | OAuth disabled             | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Ban History (0.70, 3 active bans in 5 subs) |
| Residential | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Karma Score (0.90, negative karma)    |
| Residential | Google verified            | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Ban History (0.70, 3 active bans in 5 subs) |
| Residential | Google + GitHub verified   | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Velocity (0.70, elevated rate)              |
| Datacenter  | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Karma Score (0.90, negative karma)               |
| Datacenter  | OAuth enabled (unverified) | 0.69      | 0.48 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)         |
| Datacenter  | Google verified            | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Karma Score (0.90, negative karma)               |
| Datacenter  | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Karma Score (0.90, negative karma)               |
| VPN         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Karma Score (0.90, negative karma)                |
| VPN         | OAuth enabled (unverified) | 0.69      | 0.48 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)          |
| VPN         | Google verified            | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Karma Score (0.90, negative karma)                |
| VPN         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Karma Score (0.90, negative karma)                |
| Tor         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Karma Score (0.90, negative karma)               |
| Tor         | OAuth enabled (unverified) | 0.69      | 0.48 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)         |
| Tor         | Google verified            | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Karma Score (0.90, negative karma)               |
| Tor         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Karma Score (0.90, negative karma)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description             | Weight   | Contribution |
| ------------------- | ----- | ----------------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days                | 16.3%    | 0.08         |
| Karma Score         | 0.90  | negative karma          | 14.0%    | 0.13         |
| Content/Title Risk  | 0.45  | 3 duplicates            | 16.3%    | 0.07         |
| URL/Link Risk       | 0.20  | 1 unique URL            | 14.0%    | 0.03         |
| Velocity            | 0.40  | elevated rate           | 11.6%    | 0.05         |
| IP Risk             | -     | skipped                 | 0%       | (skipped)    |
| Ban History         | 0.70  | 3 active bans in 5 subs | 11.6%    | 0.08         |
| ModQueue Rejection  | 0.90  | 80% rejected            | 7.0%     | 0.06         |
| Removal Rate        | 0.70  | 60% removed             | 9.3%     | 0.07         |
| Social Verification | -     | skipped                 | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet               | 0%       | (skipped)    |
| **Total**           |       |                         | **100%** | **0.56**     |

**Outcome:** OAuth + more — Raw score 0.56. After CAPTCHA: 0.56 × 0.7 = 0.39 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 8: New User, Dual OAuth

A brand new user verified via both Google and GitHub OAuth.

**Example Publication:**

```
title: "Excited to join the community!"
content: "Hi all, I'm a developer interested in decentralized platforms. Verified my accounts to show I'm legit!"
```

**Author Profile:**

| Attribute          | Value          | Risk Implication        |
| ------------------ | -------------- | ----------------------- |
| Account Age        | no history     | High risk (no history)  |
| Karma              | no data        | Unknown (neutral)       |
| Active Bans        | 0              | Skipped (no history)    |
| Velocity           | normal         | No risk                 |
| Content Duplicates | none           | Low risk (unique)       |
| URL Spam           | no urls        | Low risk                |
| ModQueue Rejection | No data        | Unknown (neutral)       |
| Removal Rate       | No data        | Unknown (neutral)       |
| OAuth Verification | google, github | Reduced risk (verified) |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                   |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| No IP check | OAuth enabled (unverified) | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| No IP check | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| No IP check | Google + GitHub verified   | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| Residential | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| Residential | OAuth enabled (unverified) | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| Residential | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)   |
| Datacenter  | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history) |
| Datacenter  | OAuth enabled (unverified) | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history) |
| Datacenter  | Google verified            | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history) |
| Datacenter  | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history) |
| VPN         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)  |
| VPN         | OAuth enabled (unverified) | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)  |
| VPN         | Google verified            | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)  |
| VPN         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)  |
| Tor         | OAuth disabled             | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history) |
| Tor         | OAuth enabled (unverified) | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history) |
| Tor         | Google verified            | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history) |
| Tor         | Google + GitHub verified   | 0.55      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history) |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 22.6%    | 0.23         |
| Karma Score         | 0.60  | no data        | 19.4%    | 0.12         |
| Content/Title Risk  | 0.20  | unique content | 22.6%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 19.4%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 16.1%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.44**     |

**Outcome:** OAuth + more — Raw score 0.44. After CAPTCHA: 0.44 × 0.7 = 0.31 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 9: Vote Spammer

A user with bot-like voting velocity.

**Example Publication:**

```
vote: +1
commentCid: "QmTargetComment123..."
# (vote: +1 on target comment - 110th vote in the last hour)
```

**Author Profile:**

| Attribute          | Value    | Risk Implication          |
| ------------------ | -------- | ------------------------- |
| Account Age        | 7 days   | Moderate risk             |
| Karma              | 0        | Neutral                   |
| Active Bans        | 0        | Low risk (clean record)   |
| Velocity           | bot_like | Very high risk (bot-like) |
| Content Duplicates | —        | N/A (skipped)             |
| URL Spam           | —        | N/A (skipped)             |
| ModQueue Rejection | No data  | Unknown (neutral)         |
| Removal Rate       | No data  | Unknown (neutral)         |

### Results by Configuration

#### Votes

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Karma Score (0.60, neutral)              |
| No IP check | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | Velocity (0.95, bot-like rate), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Karma Score (0.60, neutral)              |
| No IP check | Google + GitHub verified   | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Karma Score (0.60, neutral)              |
| Residential | OAuth disabled             | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Account Age (0.50, ~7 days)              |
| Residential | OAuth enabled (unverified) | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Velocity (0.95, bot-like rate) |
| Residential | Google verified            | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Account Age (0.50, ~7 days)              |
| Residential | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Account Age (0.50, ~7 days)              |
| Datacenter  | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)            |
| Datacenter  | OAuth enabled (unverified) | 0.69      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)  |
| Datacenter  | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)            |
| Datacenter  | Google + GitHub verified   | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)            |
| VPN         | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)             |
| VPN         | OAuth enabled (unverified) | 0.69      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)   |
| VPN         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)             |
| VPN         | Google + GitHub verified   | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)             |
| Tor         | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)            |
| Tor         | OAuth enabled (unverified) | 0.69      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)  |
| Tor         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)            |
| Tor         | Google + GitHub verified   | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)            |

### Detailed Factor Breakdown

Configuration: **Vote** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days        | 25.9%    | 0.13         |
| Karma Score         | 0.60  | neutral        | 22.2%    | 0.13         |
| Content/Title Risk  | -     | unique content | 0%       | (skipped)    |
| URL/Link Risk       | -     | no URLs        | 0%       | (skipped)    |
| Velocity            | 0.95  | bot-like rate  | 18.5%    | 0.18         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 18.5%    | 0.06         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 14.8%    | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.51**     |

**Outcome:** OAuth + more — Raw score 0.51. After CAPTCHA: 0.51 × 0.7 = 0.36 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 10: Trusted Reply Author

An established user making a reply with positive karma.

**Example Publication:**

```
content: "Great question! Based on my experience over the past year, I'd recommend checking out the documentation first..."
parentCid: "QmParentComment..."
```

**Author Profile:**

| Attribute          | Value     | Risk Implication        |
| ------------------ | --------- | ----------------------- |
| Account Age        | 365+ days | Low risk (established)  |
| Karma              | +3        | Low risk (positive)     |
| Active Bans        | 0         | Low risk (clean record) |
| Velocity           | normal    | No risk                 |
| Content Duplicates | none      | Low risk (unique)       |
| URL Spam           | no urls   | Low risk                |
| ModQueue Rejection | 0%        | Low risk                |
| Removal Rate       | 0%        | Low risk                |

### Results by Configuration

#### Replies

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | -------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.22      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content)   |
| No IP check | OAuth enabled (unverified) | 0.28      | 0.20 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (0.50, 365+ days)    |
| No IP check | Google verified            | 0.23      | 0.16 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Social Verification (0.40, Google verified) |
| No IP check | Google + GitHub verified   | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content)   |
| Residential | OAuth disabled             | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.28      | 0.19 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (0.50, 365+ days)    |
| Residential | Google verified            | 0.23      | 0.16 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)              |
| Residential | Google + GitHub verified   | 0.20      | 0.14 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)               |
| Datacenter  | OAuth enabled (unverified) | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)    |
| Datacenter  | Google verified            | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)               |
| Datacenter  | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)               |
| VPN         | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)                |
| VPN         | OAuth enabled (unverified) | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)     |
| VPN         | Google verified            | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)                |
| VPN         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)                |
| Tor         | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)               |
| Tor         | OAuth enabled (unverified) | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)    |
| Tor         | Google verified            | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)               |
| Tor         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)               |

### Detailed Factor Breakdown

Configuration: **Reply** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | 365+ days      | 16.3%    | 0.08         |
| Karma Score         | 0.20  | positive (+3)  | 14.0%    | 0.03         |
| Content/Title Risk  | 0.20  | unique content | 16.3%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs        | 14.0%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 11.6%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.17  | no active bans | 11.6%    | 0.02         |
| ModQueue Rejection  | 0.10  | 0% rejected    | 7.0%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed     | 9.3%     | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.22**     |

**Outcome:** OAuth sufficient — Raw score 0.22. After CAPTCHA: 0.22 × 0.7 = 0.15 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 11: Borderline Modqueue

A moderately established user with 50% modqueue rejection rate.

**Example Publication:**

```
title: "Another attempt at posting"
content: "Half of my submissions keep getting rejected, not sure why..."
```

**Author Profile:**

| Attribute          | Value   | Risk Implication        |
| ------------------ | ------- | ----------------------- |
| Account Age        | 30 days | Low-moderate risk       |
| Karma              | 0       | Neutral                 |
| Active Bans        | 0       | Low risk (clean record) |
| Velocity           | normal  | No risk                 |
| Content Duplicates | none    | Low risk (unique)       |
| URL Spam           | no urls | Low risk                |
| ModQueue Rejection | 50%     | Moderate risk           |
| Removal Rate       | 0%      | Low risk                |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                             |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ----------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)               |
| No IP check | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Karma Score (0.60, neutral)   |
| No IP check | Google verified            | 0.32      | 0.22 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)               |
| No IP check | Google + GitHub verified   | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)               |
| Residential | OAuth disabled             | 0.27      | 0.19 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~30 days), Karma Score (0.60, neutral)               |
| Residential | OAuth enabled (unverified) | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (0.50, ~30 days)  |
| Residential | Google verified            | 0.28      | 0.20 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~30 days), Karma Score (0.60, neutral)               |
| Residential | Google + GitHub verified   | 0.26      | 0.18 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~30 days), Karma Score (0.60, neutral)               |
| Datacenter  | OAuth disabled             | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~30 days)             |
| Datacenter  | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified) |
| Datacenter  | Google verified            | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~30 days)             |
| Datacenter  | Google + GitHub verified   | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~30 days)             |
| VPN         | OAuth disabled             | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~30 days)              |
| VPN         | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)  |
| VPN         | Google verified            | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~30 days)              |
| VPN         | Google + GitHub verified   | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~30 days)              |
| Tor         | OAuth disabled             | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~30 days)             |
| Tor         | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified) |
| Tor         | Google verified            | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~30 days)             |
| Tor         | Google + GitHub verified   | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~30 days)             |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~30 days       | 16.3%    | 0.08         |
| Karma Score         | 0.60  | neutral        | 14.0%    | 0.08         |
| Content/Title Risk  | 0.20  | unique content | 16.3%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs        | 14.0%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 11.6%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.24  | no active bans | 11.6%    | 0.03         |
| ModQueue Rejection  | 0.50  | 50% rejected   | 7.0%     | 0.03         |
| Removal Rate        | 0.10  | 0% removed     | 9.3%     | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.31**     |

**Outcome:** OAuth sufficient — Raw score 0.31. After CAPTCHA: 0.31 × 0.7 = 0.22 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 12: High Removal Rate

An established user whose content is frequently removed (60%).

**Example Publication:**

```
title: "Trying again with this post"
content: "Mods keep removing my content but I'm not sure what rules I'm breaking..."
```

**Author Profile:**

| Attribute          | Value   | Risk Implication        |
| ------------------ | ------- | ----------------------- |
| Account Age        | 90 days | Low risk (established)  |
| Karma              | 0       | Neutral                 |
| Active Bans        | 0       | Low risk (clean record) |
| Velocity           | normal  | No risk                 |
| Content Duplicates | none    | Low risk (unique)       |
| URL Spam           | no urls | Low risk                |
| ModQueue Rejection | No data | Unknown (neutral)       |
| Removal Rate       | 60%     | High risk               |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | -------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.38      | 0.26 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Karma Score (0.60, neutral)              |
| No IP check | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Karma Score (0.60, neutral)      |
| No IP check | Google verified            | 0.38      | 0.26 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Removal Rate (0.90, 60% removed)              |
| No IP check | Google + GitHub verified   | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Removal Rate (0.90, 60% removed)              |
| Residential | OAuth disabled             | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)             |
| Residential | OAuth enabled (unverified) | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Removal Rate (0.90, 60% removed) |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)             |
| Residential | Google + GitHub verified   | 0.32      | 0.23 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)             |
| Datacenter  | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)            |
| Datacenter  | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)    |
| Datacenter  | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)            |
| Datacenter  | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)            |
| VPN         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)             |
| VPN         | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)     |
| VPN         | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)             |
| VPN         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)             |
| Tor         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)            |
| Tor         | OAuth enabled (unverified) | 0.57      | 0.40 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)    |
| Tor         | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)            |
| Tor         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days       | 17.5%    | 0.09         |
| Karma Score         | 0.60  | neutral        | 15.0%    | 0.09         |
| Content/Title Risk  | 0.20  | unique content | 17.5%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs        | 15.0%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 12.5%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.24  | no active bans | 12.5%    | 0.03         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.90  | 60% removed    | 10.0%    | 0.09         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.38**     |

**Outcome:** OAuth sufficient — Raw score 0.38. After CAPTCHA: 0.38 × 0.7 = 0.26 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 13: New, OAuth Unverified

A new user where OAuth is enabled but they haven't verified.

**Example Publication:**

```
title: "New here, skipped the verification"
content: "Decided not to link my social accounts, is that okay?"
```

**Author Profile:**

| Attribute          | Value              | Risk Implication       |
| ------------------ | ------------------ | ---------------------- |
| Account Age        | no history         | High risk (no history) |
| Karma              | no data            | Unknown (neutral)      |
| Active Bans        | 0                  | Skipped (no history)   |
| Velocity           | normal             | No risk                |
| Content Duplicates | none               | Low risk (unique)      |
| URL Spam           | no urls            | Low risk               |
| ModQueue Rejection | No data            | Unknown (neutral)      |
| Removal Rate       | No data            | Unknown (neutral)      |
| OAuth Verification | None (but enabled) | High risk (unverified) |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, skipped)      |
| No IP check | OAuth enabled (unverified) | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google + GitHub verified   | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | OAuth disabled             | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, skipped)      |
| Residential | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | Google + GitHub verified   | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Datacenter  | OAuth disabled             | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| VPN         | OAuth disabled             | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| Tor         | OAuth disabled             | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google verified            | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google + GitHub verified   | 0.64      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 20.0%    | 0.20         |
| Karma Score         | 0.60  | no data        | 17.1%    | 0.10         |
| Content/Title Risk  | 0.20  | unique content | 20.0%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs        | 17.1%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 14.3%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | 1.00  | skipped        | 11.4%    | 0.11         |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.51**     |

**Outcome:** OAuth + more — Raw score 0.51. After CAPTCHA: 0.51 × 0.7 = 0.35 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 14: Moderate Content Spam

A user with 3 duplicate content posts.

**Example Publication:**

```
title: "Check this out (posted 3 times)"
content: "This is duplicate spam content that appears multiple times."
```

**Author Profile:**

| Attribute          | Value   | Risk Implication        |
| ------------------ | ------- | ----------------------- |
| Account Age        | 7 days  | Moderate risk           |
| Karma              | 0       | Neutral                 |
| Active Bans        | 0       | Low risk (clean record) |
| Velocity           | normal  | No risk                 |
| Content Duplicates | 3       | Moderate risk           |
| URL Spam           | no urls | Low risk                |
| ModQueue Rejection | No data | Unknown (neutral)       |
| Removal Rate       | No data | Unknown (neutral)       |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                             |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ----------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~7 days)                |
| No IP check | OAuth enabled (unverified) | 0.41      | 0.28 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Karma Score (0.60, neutral)   |
| No IP check | Google verified            | 0.35      | 0.25 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~7 days)                |
| No IP check | Google + GitHub verified   | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~7 days)                |
| Residential | OAuth disabled             | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~7 days), Karma Score (0.60, neutral)                |
| Residential | OAuth enabled (unverified) | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (0.50, ~7 days)   |
| Residential | Google verified            | 0.31      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~7 days), Karma Score (0.60, neutral)                |
| Residential | Google + GitHub verified   | 0.28      | 0.20 ✓               | —                           | CAPTCHA passes | Account Age (0.50, ~7 days), Karma Score (0.60, neutral)                |
| Datacenter  | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~7 days)              |
| Datacenter  | OAuth enabled (unverified) | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified) |
| Datacenter  | Google verified            | 0.48      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~7 days)              |
| Datacenter  | Google + GitHub verified   | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~7 days)              |
| VPN         | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~7 days)               |
| VPN         | OAuth enabled (unverified) | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)  |
| VPN         | Google verified            | 0.48      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~7 days)               |
| VPN         | Google + GitHub verified   | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~7 days)               |
| Tor         | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~7 days)              |
| Tor         | OAuth enabled (unverified) | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified) |
| Tor         | Google verified            | 0.48      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~7 days)              |
| Tor         | Google + GitHub verified   | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~7 days)              |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days        | 17.5%    | 0.09         |
| Karma Score         | 0.60  | neutral        | 15.0%    | 0.09         |
| Content/Title Risk  | 0.45  | 3 duplicates   | 17.5%    | 0.08         |
| URL/Link Risk       | 0.20  | no URLs        | 15.0%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 12.5%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 12.5%    | 0.04         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 10.0%    | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.35**     |

**Outcome:** OAuth sufficient — Raw score 0.35. After CAPTCHA: 0.35 × 0.7 = 0.24 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 15: Perfect User

An ideal user with 365+ days history, +5 karma, dual OAuth, active wallet (500+ tx), and clean record.

**Example Publication:**

```
title: "Comprehensive guide to running your own subplebbit"
content: "After over a year on the platform, I've compiled everything I've learned..."
```

**Author Profile:**

| Attribute          | Value            | Risk Implication        |
| ------------------ | ---------------- | ----------------------- |
| Account Age        | 365+ days        | Low risk (established)  |
| Karma              | +5               | Low risk (positive)     |
| Active Bans        | 0                | Low risk (clean record) |
| Velocity           | normal           | No risk                 |
| Content Duplicates | none             | Low risk (unique)       |
| URL Spam           | no urls          | Low risk                |
| ModQueue Rejection | 0%               | Low risk                |
| Removal Rate       | 0%               | Low risk                |
| OAuth Verification | google, github   | Reduced risk (verified) |
| Wallet Activity    | 500 transactions | Very strong activity    |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | OAuth enabled (unverified) | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | Google verified            | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | Google + GitHub verified   | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| Residential | OAuth disabled             | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)            |
| Residential | OAuth enabled (unverified) | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)            |
| Residential | Google verified            | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)            |
| Residential | Google + GitHub verified   | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), IP Risk (0.20, residential IP)            |
| Datacenter  | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | OAuth enabled (unverified) | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | Google verified            | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | Google + GitHub verified   | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| VPN         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | OAuth enabled (unverified) | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | Google verified            | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | Google + GitHub verified   | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| Tor         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | OAuth enabled (unverified) | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | Google verified            | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | Google + GitHub verified   | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 0.50  | 365+ days            | 15.2%    | 0.08         |
| Karma Score         | 0.10  | positive (+5)        | 13.0%    | 0.01         |
| Content/Title Risk  | 0.20  | unique content       | 15.2%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs              | 13.0%    | 0.03         |
| Velocity            | 0.10  | normal rate          | 10.9%    | 0.01         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | 0.12  | no active bans       | 10.9%    | 0.01         |
| ModQueue Rejection  | 0.10  | 0% rejected          | 6.5%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed           | 8.7%     | 0.01         |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.10  | 500 tx (very strong) | 6.5%     | 0.01         |
| **Total**           |       |                      | **100%** | **0.19**     |

**Outcome:** Auto-accepted — Score 0.19 falls in the auto-accept tier (< 0.2), allowing the publication without any challenge.

---

## Scenario 16: New User, Active Wallet

A brand new user with no history but a verified wallet with 150 transactions.

**Example Publication:**

```
title: "Been using crypto for years, just found plebbit"
content: "Excited to finally have a decentralized alternative to Reddit..."
```

**Author Profile:**

| Attribute          | Value            | Risk Implication       |
| ------------------ | ---------------- | ---------------------- |
| Account Age        | no history       | High risk (no history) |
| Karma              | no data          | Unknown (neutral)      |
| Active Bans        | 0                | Skipped (no history)   |
| Velocity           | normal           | No risk                |
| Content Duplicates | none             | Low risk (unique)      |
| URL Spam           | no urls          | Low risk               |
| ModQueue Rejection | No data          | Unknown (neutral)      |
| Removal Rate       | No data          | Unknown (neutral)      |
| Wallet Activity    | 150 transactions | Strong activity        |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | OAuth enabled (unverified) | 0.48      | 0.33 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | Google + GitHub verified   | 0.39      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth disabled             | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth enabled (unverified) | 0.41      | 0.28 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | Google + GitHub verified   | 0.32      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Datacenter  | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | OAuth enabled (unverified) | 0.61      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google verified            | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| VPN         | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | OAuth enabled (unverified) | 0.61      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google verified            | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| Tor         | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | OAuth enabled (unverified) | 0.61      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google verified            | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description     | Weight   | Contribution |
| ------------------- | ----- | --------------- | -------- | ------------ |
| Account Age         | 1.00  | no history      | 20.6%    | 0.21         |
| Karma Score         | 0.60  | no data         | 17.6%    | 0.11         |
| Content/Title Risk  | 0.20  | unique content  | 20.6%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs         | 17.6%    | 0.04         |
| Velocity            | 0.10  | normal rate     | 14.7%    | 0.01         |
| IP Risk             | -     | skipped         | 0%       | (skipped)    |
| Ban History         | -     | no active bans  | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data         | 0%       | (skipped)    |
| Removal Rate        | -     | no data         | 0%       | (skipped)    |
| Social Verification | -     | skipped         | 0%       | (skipped)    |
| Wallet Activity     | 0.15  | 150 tx (strong) | 8.8%     | 0.01         |
| **Total**           |       |                 | **100%** | **0.42**     |

**Outcome:** OAuth + more — Raw score 0.42. After CAPTCHA: 0.42 × 0.7 = 0.29 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 17: New User, Low-Activity Wallet

A new user with a wallet that has very few transactions (5 tx).

**Example Publication:**

```
title: "Just getting started with crypto and plebbit"
content: "New to both but excited to learn..."
```

**Author Profile:**

| Attribute          | Value          | Risk Implication             |
| ------------------ | -------------- | ---------------------------- |
| Account Age        | no history     | High risk (no history)       |
| Karma              | no data        | Unknown (neutral)            |
| Active Bans        | 0              | Skipped (no history)         |
| Velocity           | normal         | No risk                      |
| Content Duplicates | none           | Low risk (unique)            |
| URL Spam           | no urls        | Low risk                     |
| ModQueue Rejection | No data        | Unknown (neutral)            |
| Removal Rate       | No data        | Unknown (neutral)            |
| Wallet Activity    | 5 transactions | Some activity (modest trust) |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | OAuth enabled (unverified) | 0.49      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| No IP check | Google + GitHub verified   | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | OAuth enabled (unverified) | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | Google verified            | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Residential | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)              |
| Datacenter  | OAuth disabled             | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| Datacenter  | Google + GitHub verified   | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)            |
| VPN         | OAuth disabled             | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| VPN         | Google + GitHub verified   | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)             |
| Tor         | OAuth disabled             | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |
| Tor         | Google + GitHub verified   | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 1.00  | no history           | 20.6%    | 0.21         |
| Karma Score         | 0.60  | no data              | 17.6%    | 0.11         |
| Content/Title Risk  | 0.20  | unique content       | 20.6%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs              | 17.6%    | 0.04         |
| Velocity            | 0.10  | normal rate          | 14.7%    | 0.01         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | -     | no active bans       | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data              | 0%       | (skipped)    |
| Removal Rate        | -     | no data              | 0%       | (skipped)    |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.35  | 5 tx (some activity) | 8.8%     | 0.03         |
| **Total**           |       |                      | **100%** | **0.43**     |

**Outcome:** OAuth + more — Raw score 0.43. After CAPTCHA: 0.43 × 0.7 = 0.30 < 0.4 — **CAPTCHA alone passes**.

---

## Summary

Overview of risk score ranges and challenge outcomes for each scenario:

| #   | Scenario                      | Score Range | CAPTCHA Passes? | CAPTCHA+OAuth Passes? | Possible Outcomes             |
| --- | ----------------------------- | ----------- | --------------- | --------------------- | ----------------------------- |
| 1   | Brand New User                | 0.34–0.64   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 2   | Established Trusted User      | 0.19–0.37   | Always          | Always                | Auto-accepted, CAPTCHA passes |
| 3   | New User with Link            | 0.34–0.64   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 4   | Repeat Link Spammer           | 0.47–0.70   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 5   | Content Duplicator            | 0.34–0.57   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 6   | Bot-like Velocity             | 0.43–0.74   | Sometimes       | Always                | Needs OAuth, CAPTCHA passes   |
| 7   | Serial Offender               | 0.47–0.69   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 8   | New User, Dual OAuth          | 0.34–0.60   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 9   | Vote Spammer                  | 0.37–0.69   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 10  | Trusted Reply Author          | 0.20–0.45   | Always          | Always                | CAPTCHA passes                |
| 11  | Borderline Modqueue           | 0.26–0.50   | Always          | Always                | CAPTCHA passes                |
| 12  | High Removal Rate             | 0.32–0.57   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 13  | New, OAuth Unverified         | 0.43–0.64   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 14  | Moderate Content Spam         | 0.28–0.54   | Always          | Always                | CAPTCHA passes                |
| 15  | Perfect User                  | 0.19–0.36   | Always          | Always                | Auto-accepted, CAPTCHA passes |
| 16  | New User, Active Wallet       | 0.32–0.61   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |
| 17  | New User, Low-Activity Wallet | 0.34–0.62   | Sometimes       | Always                | CAPTCHA passes, Needs OAuth   |

---

_This document is auto-generated. Run `npm run generate-scenarios` to regenerate._
