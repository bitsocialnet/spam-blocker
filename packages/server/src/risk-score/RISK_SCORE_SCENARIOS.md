# Risk Score Scenarios

_Generated: 2026-03-17_

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

## Dynamic Rate Limiting

Publications are hard-rejected (HTTP 429) when an author exceeds their budget.
Budgets scale dynamically based on `multiplier = ageFactor × reputationFactor` (clamped 0.25–5.0).

**Age Factor:**

| Account Age          | Factor |
| -------------------- | ------ |
| No history / < 1 day | 0.5    |
| 1–7 days             | 0.75   |
| 7–30 days            | 1.0    |
| 30–90 days           | 1.5    |
| 90–365 days          | 2.0    |
| > 365 days           | 3.0    |

**Reputation Factor:**

| Condition                           | Factor |
| ----------------------------------- | ------ |
| Any active bans                     | 0.5    |
| Weighted removal rate > 30%         | 0.5    |
| Weighted removal rate 15–30%        | 0.75   |
| No history or removal rate < 15%    | 1.0    |
| Removal rate < 5% AND > 10 comments | 1.25   |

**Base Limits (at 1.0× multiplier):**

| Type          | Hourly | Daily   |
| ------------- | ------ | ------- |
| Post          | 4      | 20      |
| Reply         | 6      | 60      |
| Vote          | 10     | 200     |
| **Aggregate** | **40** | **250** |

Effective limit = `max(1, floor(base × multiplier))`.

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
| Purge Rate         | No data    | Unknown (neutral)      |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | Google + GitHub verified   | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| VPN         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| Tor         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 20.7%    | 0.21         |
| Karma Score         | 0.60  | no data        | 17.2%    | 0.10         |
| Content/Title Risk  | 0.20  | unique content | 24.1%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 20.7%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 17.2%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.42**     |

**Outcome:** OAuth + more — Raw score 0.42. After CAPTCHA: 0.42 × 0.7 = 0.29 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | 0%               | Low risk                |
| OAuth Verification | google           | Reduced risk (verified) |
| Wallet Activity    | 250 transactions | Very strong activity    |

### Rate Limit Budget

**Budget multiplier:** 1.88×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 7            | 37          |
| Reply         | 11           | 112         |
| Vote          | 18           | 375         |
| **Aggregate** | **75**       | **468**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.18      | —                    | —                           | Auto-accepted  | Account Age (0.50, 90+ days), Content/Title Risk (0.20, unique content)     |
| No IP check | OAuth enabled (unverified) | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified)   |
| No IP check | Google verified            | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified)   |
| No IP check | Google + GitHub verified   | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 90+ days), Social Verification (0.40, google verified)   |
| Residential | OAuth disabled             | 0.18      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 90+ days)                |
| Residential | OAuth enabled (unverified) | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, google verified), IP Risk (0.20, residential IP) |
| Residential | Google verified            | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, google verified), IP Risk (0.20, residential IP) |
| Residential | Google + GitHub verified   | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, google verified), IP Risk (0.20, residential IP) |
| Datacenter  | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 90+ days)                 |
| Datacenter  | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, google verified)  |
| Datacenter  | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, google verified)  |
| Datacenter  | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, google verified)  |
| VPN         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 90+ days)                  |
| VPN         | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, google verified)   |
| VPN         | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, google verified)   |
| VPN         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, google verified)   |
| Tor         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 90+ days)                 |
| Tor         | OAuth enabled (unverified) | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, google verified)  |
| Tor         | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, google verified)  |
| Tor         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, google verified)  |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days             | 13.6%    | 0.07         |
| Karma Score         | 0.10  | positive (+5)        | 11.4%    | 0.01         |
| Content/Title Risk  | 0.20  | unique content       | 15.9%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs              | 13.6%    | 0.03         |
| Velocity            | 0.10  | normal rate          | 11.4%    | 0.01         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | 0.10  | no active bans       | 11.4%    | 0.01         |
| ModQueue Rejection  | 0.10  | 0% rejected          | 6.8%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed           | 9.1%     | 0.01         |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.10  | 250 tx (very strong) | 6.8%     | 0.01         |
| **Total**           |       |                      | **100%** | **0.18**     |

**Outcome:** Auto-accepted — Score 0.18 falls in the auto-accept tier (< 0.2), allowing the publication without any challenge.

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
| Purge Rate         | No data  | Unknown (neutral)     |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)                 |
| No IP check | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)                 |
| No IP check | Google + GitHub verified   | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Karma Score (0.60, no data)                 |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, <1 day old)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)               |
| Datacenter  | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)               |
| Datacenter  | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)               |
| VPN         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)                |
| VPN         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)                |
| VPN         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)                |
| Tor         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)               |
| Tor         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)               |
| Tor         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | <1 day old     | 20.7%    | 0.21         |
| Karma Score         | 0.60  | no data        | 17.2%    | 0.10         |
| Content/Title Risk  | 0.20  | unique content | 24.1%    | 0.05         |
| URL/Link Risk       | 0.20  | 1 unique URL   | 20.7%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 17.2%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.42**     |

**Outcome:** OAuth + more — Raw score 0.42. After CAPTCHA: 0.42 × 0.7 = 0.29 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data  | Unknown (neutral)        |

### Rate Limit Budget

**Budget multiplier:** 0.75×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 3            | 15          |
| Reply         | 4            | 45          |
| Vote          | 7            | 150         |
| **Aggregate** | **30**       | **187**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| No IP check | OAuth enabled (unverified) | 0.61      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | URL/Link Risk (1.00, 5+ same URL), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| No IP check | Google + GitHub verified   | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | OAuth disabled             | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | OAuth enabled (unverified) | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), URL/Link Risk (1.00, 5+ same URL) |
| Residential | Google verified            | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Karma Score (0.90, negative karma)       |
| Residential | Google + GitHub verified   | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | URL/Link Risk (1.00, 5+ same URL), Velocity (0.70, elevated rate)           |
| Datacenter  | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| Datacenter  | OAuth enabled (unverified) | 0.71      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| Datacenter  | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), URL/Link Risk (1.00, 5+ same URL)            |
| VPN         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| VPN         | OAuth enabled (unverified) | 0.71      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| VPN         | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), URL/Link Risk (1.00, 5+ same URL)             |
| Tor         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |
| Tor         | OAuth enabled (unverified) | 0.71      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |
| Tor         | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), URL/Link Risk (1.00, 5+ same URL)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description            | Weight   | Contribution |
| ------------------- | ----- | ---------------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days                | 14.6%    | 0.07         |
| Karma Score         | 0.90  | negative karma         | 12.2%    | 0.11         |
| Content/Title Risk  | 0.20  | unique content         | 17.1%    | 0.03         |
| URL/Link Risk       | 1.00  | 5+ same URL            | 14.6%    | 0.15         |
| Velocity            | 0.40  | elevated rate          | 12.2%    | 0.05         |
| IP Risk             | -     | skipped                | 0%       | (skipped)    |
| Ban History         | 0.50  | 1 active ban in 5 subs | 12.2%    | 0.06         |
| ModQueue Rejection  | 0.50  | 50% rejected           | 7.3%     | 0.04         |
| Removal Rate        | 0.50  | 30% removed            | 9.8%     | 0.05         |
| Social Verification | -     | skipped                | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet              | 0%       | (skipped)    |
| **Total**           |       |                        | **100%** | **0.56**     |

**Outcome:** OAuth + more — Raw score 0.56. After CAPTCHA: 0.56 × 0.7 = 0.39 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data  | Unknown (neutral)        |

### Rate Limit Budget

**Budget multiplier:** 1.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 6            | 30          |
| Reply         | 9            | 90          |
| Vote          | 15           | 300         |
| **Aggregate** | **60**       | **375**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                           |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Account Age (0.50, ~30 days)                |
| No IP check | OAuth enabled (unverified) | 0.48      | 0.33 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.55, 5+ duplicates)    |
| No IP check | Google verified            | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Account Age (0.50, ~30 days)                |
| No IP check | Google + GitHub verified   | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Velocity (0.70, elevated rate)              |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.55, 5+ duplicates)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.55, 5+ duplicates), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Velocity (0.70, elevated rate), Content/Title Risk (0.55, 5+ duplicates)              |
| Datacenter  | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.55, 5+ duplicates)               |
| Datacenter  | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)               |
| Datacenter  | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.55, 5+ duplicates)               |
| Datacenter  | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Velocity (0.70, elevated rate)                         |
| VPN         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.55, 5+ duplicates)                |
| VPN         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)                |
| VPN         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.55, 5+ duplicates)                |
| VPN         | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Velocity (0.70, elevated rate)                          |
| Tor         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.55, 5+ duplicates)               |
| Tor         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)               |
| Tor         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.55, 5+ duplicates)               |
| Tor         | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Velocity (0.70, elevated rate)                         |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~30 days       | 15.8%    | 0.08         |
| Karma Score         | 0.60  | neutral        | 13.2%    | 0.08         |
| Content/Title Risk  | 0.55  | 5+ duplicates  | 18.4%    | 0.10         |
| URL/Link Risk       | 0.20  | no URLs        | 15.8%    | 0.03         |
| Velocity            | 0.40  | elevated rate  | 13.2%    | 0.05         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 13.2%    | 0.04         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 10.5%    | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.39**     |

**Outcome:** OAuth sufficient — Raw score 0.39. After CAPTCHA: 0.39 × 0.7 = 0.28 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data  | Unknown (neutral)         |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| No IP check | OAuth enabled (unverified) | 0.64      | 0.45 ✗               | 0.22 ✓                      | Needs OAuth    | Account Age (1.00, <1 day old), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| No IP check | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | OAuth disabled             | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | OAuth enabled (unverified) | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, <1 day old) |
| Residential | Google verified            | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Residential | Google + GitHub verified   | 0.40      | 0.28 ✓               | —                           | CAPTCHA passes | Account Age (1.00, <1 day old), Velocity (0.95, bot-like rate)           |
| Datacenter  | OAuth disabled             | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | OAuth enabled (unverified) | 0.75      | 0.52 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)  |
| Datacenter  | Google verified            | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| Datacenter  | Google + GitHub verified   | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, <1 day old)            |
| VPN         | OAuth disabled             | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | OAuth enabled (unverified) | 0.75      | 0.52 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)   |
| VPN         | Google verified            | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| VPN         | Google + GitHub verified   | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, <1 day old)             |
| Tor         | OAuth disabled             | 0.70      | 0.49 ✗               | 0.24 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | OAuth enabled (unverified) | 0.75      | 0.52 ✗               | 0.26 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)  |
| Tor         | Google verified            | 0.65      | 0.45 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |
| Tor         | Google + GitHub verified   | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, <1 day old)            |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | <1 day old     | 20.7%    | 0.21         |
| Karma Score         | 0.60  | no data        | 17.2%    | 0.10         |
| Content/Title Risk  | 0.20  | unique content | 24.1%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 20.7%    | 0.04         |
| Velocity            | 0.95  | bot-like rate  | 17.2%    | 0.16         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.56**     |

**Outcome:** OAuth + more — Raw score 0.56. After CAPTCHA: 0.56 × 0.7 = 0.39 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data  | Unknown (neutral)      |

### Rate Limit Budget

**Budget multiplier:** 0.75×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 3            | 15          |
| Reply         | 4            | 45          |
| Vote          | 7            | 150         |
| **Aggregate** | **30**       | **187**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                           |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Ban History (0.70, 3 active bans in 5 subs)       |
| No IP check | OAuth enabled (unverified) | 0.61      | 0.43 ✗               | 0.21 ✓                      | Needs OAuth    | Social Verification (1.00, not verified), Karma Score (0.90, negative karma)          |
| No IP check | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Ban History (0.70, 3 active bans in 5 subs)       |
| No IP check | Google + GitHub verified   | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | Karma Score (0.90, negative karma), Velocity (0.70, elevated rate)                    |
| Residential | OAuth disabled             | 0.46      | 0.32 ✓               | —                           | CAPTCHA passes | Ban History (0.70, 3 active bans in 5 subs), Removal Rate (0.70, 60% removed)         |
| Residential | OAuth enabled (unverified) | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Ban History (0.70, 3 active bans in 5 subs) |
| Residential | Google verified            | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | Ban History (0.70, 3 active bans in 5 subs), Removal Rate (0.70, 60% removed)         |
| Residential | Google + GitHub verified   | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | Velocity (0.70, elevated rate), Ban History (0.70, 3 active bans in 5 subs)           |
| Datacenter  | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Ban History (0.70, 3 active bans in 5 subs)            |
| Datacenter  | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)               |
| Datacenter  | Google verified            | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Ban History (0.70, 3 active bans in 5 subs)            |
| Datacenter  | Google + GitHub verified   | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.70, elevated rate)                         |
| VPN         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Ban History (0.70, 3 active bans in 5 subs)             |
| VPN         | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)                |
| VPN         | Google verified            | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Ban History (0.70, 3 active bans in 5 subs)             |
| VPN         | Google + GitHub verified   | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.70, elevated rate)                          |
| Tor         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Ban History (0.70, 3 active bans in 5 subs)            |
| Tor         | OAuth enabled (unverified) | 0.70      | 0.49 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)               |
| Tor         | Google verified            | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Ban History (0.70, 3 active bans in 5 subs)            |
| Tor         | Google + GitHub verified   | 0.62      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.70, elevated rate)                         |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description             | Weight   | Contribution |
| ------------------- | ----- | ----------------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days                | 14.6%    | 0.07         |
| Karma Score         | 0.90  | negative karma          | 12.2%    | 0.11         |
| Content/Title Risk  | 0.45  | 3 duplicates            | 17.1%    | 0.08         |
| URL/Link Risk       | 0.20  | 1 unique URL            | 14.6%    | 0.03         |
| Velocity            | 0.40  | elevated rate           | 12.2%    | 0.05         |
| IP Risk             | -     | skipped                 | 0%       | (skipped)    |
| Ban History         | 0.70  | 3 active bans in 5 subs | 12.2%    | 0.09         |
| ModQueue Rejection  | 0.90  | 80% rejected            | 7.3%     | 0.07         |
| Removal Rate        | 0.70  | 60% removed             | 9.8%     | 0.07         |
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
| Purge Rate         | No data        | Unknown (neutral)       |
| OAuth Verification | google, github | Reduced risk (verified) |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                    |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | -------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)    |
| No IP check | OAuth enabled (unverified) | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)    |
| No IP check | Google verified            | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)    |
| No IP check | Google + GitHub verified   | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)    |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP) |
| Residential | OAuth enabled (unverified) | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP) |
| Residential | Google verified            | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP) |
| Datacenter  | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)  |
| Datacenter  | OAuth enabled (unverified) | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)  |
| Datacenter  | Google verified            | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)  |
| Datacenter  | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)  |
| VPN         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, no history)   |
| VPN         | OAuth enabled (unverified) | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)   |
| VPN         | Google verified            | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)   |
| VPN         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)   |
| Tor         | OAuth disabled             | 0.59      | 0.41 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)  |
| Tor         | OAuth enabled (unverified) | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)  |
| Tor         | Google verified            | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)  |
| Tor         | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)  |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 20.7%    | 0.21         |
| Karma Score         | 0.60  | no data        | 17.2%    | 0.10         |
| Content/Title Risk  | 0.20  | unique content | 24.1%    | 0.05         |
| URL/Link Risk       | 0.20  | no URLs        | 20.7%    | 0.04         |
| Velocity            | 0.10  | normal rate    | 17.2%    | 0.02         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.42**     |

**Outcome:** OAuth + more — Raw score 0.42. After CAPTCHA: 0.42 × 0.7 = 0.29 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data  | Unknown (neutral)         |

### Rate Limit Budget

**Budget multiplier:** 1.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 6            | 30          |
| Reply         | 9            | 90          |
| Vote          | 15           | 300         |
| **Aggregate** | **60**       | **375**     |

### Results by Configuration

#### Votes

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.51      | 0.35 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Account Age (0.50, ~7 days)                 |
| No IP check | OAuth enabled (unverified) | 0.60      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | Social Verification (1.00, not verified), Velocity (0.95, bot-like rate)    |
| No IP check | Google verified            | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Karma Score (0.60, neutral)                 |
| No IP check | Google + GitHub verified   | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Karma Score (0.60, neutral)                 |
| Residential | OAuth disabled             | 0.39      | 0.27 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Account Age (0.50, ~7 days)                 |
| Residential | OAuth enabled (unverified) | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Velocity (0.95, bot-like rate)    |
| Residential | Google verified            | 0.39      | 0.27 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.35      | 0.25 ✓               | —                           | CAPTCHA passes | Velocity (0.95, bot-like rate), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)               |
| Datacenter  | OAuth enabled (unverified) | 0.72      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)               |
| Datacenter  | Google + GitHub verified   | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Velocity (0.95, bot-like rate)               |
| VPN         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)                |
| VPN         | OAuth enabled (unverified) | 0.72      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)                |
| VPN         | Google + GitHub verified   | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Velocity (0.95, bot-like rate)                |
| Tor         | OAuth disabled             | 0.66      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)               |
| Tor         | OAuth enabled (unverified) | 0.72      | 0.50 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)               |
| Tor         | Google + GitHub verified   | 0.58      | 0.41 ✗               | 0.20 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Velocity (0.95, bot-like rate)               |

### Detailed Factor Breakdown

Configuration: **Vote** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days        | 24.0%    | 0.12         |
| Karma Score         | 0.60  | neutral        | 20.0%    | 0.12         |
| Content/Title Risk  | -     | unique content | 0%       | (skipped)    |
| URL/Link Risk       | -     | no URLs        | 0%       | (skipped)    |
| Velocity            | 0.95  | bot-like rate  | 20.0%    | 0.19         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 20.0%    | 0.06         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 16.0%    | 0.02         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.51**     |

**Outcome:** OAuth + more — Raw score 0.51. After CAPTCHA: 0.51 × 0.7 = 0.35 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | 0%        | Low risk                |

### Rate Limit Budget

**Budget multiplier:** 1.88×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 7            | 37          |
| Reply         | 11           | 112         |
| Vote          | 18           | 375         |
| **Aggregate** | **75**       | **468**     |

### Results by Configuration

#### Replies

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.21      | 0.15 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content)    |
| No IP check | OAuth enabled (unverified) | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (0.50, 365+ days)     |
| No IP check | Google verified            | 0.23      | 0.16 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Social Verification (0.40, Google verified)  |
| No IP check | Google + GitHub verified   | 0.21      | 0.14 ✓               | —                           | CAPTCHA passes | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content)    |
| Residential | OAuth disabled             | 0.20      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)               |
| Residential | OAuth enabled (unverified) | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), IP Risk (0.20, residential IP)    |
| Residential | Google verified            | 0.22      | 0.16 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, Google verified), IP Risk (0.20, residential IP) |
| Residential | Google + GitHub verified   | 0.20      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)               |
| Datacenter  | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)                |
| Datacenter  | OAuth enabled (unverified) | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, Google verified)  |
| Datacenter  | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)                |
| VPN         | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)                 |
| VPN         | OAuth enabled (unverified) | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, Google verified)   |
| VPN         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)                 |
| Tor         | OAuth disabled             | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)                |
| Tor         | OAuth enabled (unverified) | 0.47      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, Google verified)  |
| Tor         | Google + GitHub verified   | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)                |

### Detailed Factor Breakdown

Configuration: **Reply** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | 365+ days      | 14.6%    | 0.07         |
| Karma Score         | 0.20  | positive (+3)  | 12.2%    | 0.02         |
| Content/Title Risk  | 0.20  | unique content | 17.1%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs        | 14.6%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 12.2%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.14  | no active bans | 12.2%    | 0.02         |
| ModQueue Rejection  | 0.10  | 0% rejected    | 7.3%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed     | 9.8%     | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.21**     |

**Outcome:** OAuth sufficient — Raw score 0.21. After CAPTCHA: 0.21 × 0.7 = 0.15 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | 0%      | Low risk                |

### Rate Limit Budget

**Budget multiplier:** 1.88×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 7            | 37          |
| Reply         | 11           | 112         |
| Vote          | 18           | 375         |
| **Aggregate** | **75**       | **468**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.29      | 0.20 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)                   |
| No IP check | OAuth enabled (unverified) | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Karma Score (0.60, neutral)       |
| No IP check | Google verified            | 0.31      | 0.21 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)                   |
| No IP check | Google + GitHub verified   | 0.28      | 0.20 ✓               | —                           | CAPTCHA passes | Karma Score (0.60, neutral), Account Age (0.50, ~30 days)                   |
| Residential | OAuth disabled             | 0.25      | 0.18 ✓               | —                           | CAPTCHA passes | IP Risk (0.20, residential IP), Account Age (0.50, ~30 days)                |
| Residential | OAuth enabled (unverified) | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), IP Risk (0.20, residential IP)    |
| Residential | Google verified            | 0.27      | 0.19 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, Google verified), IP Risk (0.20, residential IP) |
| Residential | Google + GitHub verified   | 0.25      | 0.17 ✓               | —                           | CAPTCHA passes | IP Risk (0.20, residential IP), Account Age (0.50, ~30 days)                |
| Datacenter  | OAuth disabled             | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~30 days)                 |
| Datacenter  | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, Google verified)  |
| Datacenter  | Google + GitHub verified   | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, ~30 days)                 |
| VPN         | OAuth disabled             | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~30 days)                  |
| VPN         | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, Google verified)   |
| VPN         | Google + GitHub verified   | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, ~30 days)                  |
| Tor         | OAuth disabled             | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~30 days)                 |
| Tor         | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, Google verified)  |
| Tor         | Google + GitHub verified   | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, ~30 days)                 |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~30 days       | 14.6%    | 0.07         |
| Karma Score         | 0.60  | neutral        | 12.2%    | 0.07         |
| Content/Title Risk  | 0.20  | unique content | 17.1%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs        | 14.6%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 12.2%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.20  | no active bans | 12.2%    | 0.02         |
| ModQueue Rejection  | 0.50  | 50% rejected   | 7.3%     | 0.04         |
| Removal Rate        | 0.10  | 0% removed     | 9.8%     | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.29**     |

**Outcome:** OAuth sufficient — Raw score 0.29. After CAPTCHA: 0.29 × 0.7 = 0.20 < 0.4 — **CAPTCHA alone passes**.

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
| Purge Rate         | No data | Unknown (neutral)       |

### Rate Limit Budget

**Budget multiplier:** 0.75×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 3            | 15          |
| Reply         | 4            | 45          |
| Vote          | 7            | 150         |
| **Aggregate** | **30**       | **187**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                   |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ----------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)                |
| No IP check | OAuth enabled (unverified) | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Removal Rate (0.90, 60% removed)    |
| No IP check | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)                |
| No IP check | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Account Age (0.50, 90+ days)                |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Removal Rate (0.90, 60% removed)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, 60% removed), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)               |
| Datacenter  | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)       |
| Datacenter  | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)               |
| Datacenter  | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, 60% removed)               |
| VPN         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)                |
| VPN         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)        |
| VPN         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)                |
| VPN         | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, 60% removed)                |
| Tor         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)               |
| Tor         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)       |
| Tor         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)               |
| Tor         | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, 60% removed)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days       | 15.8%    | 0.08         |
| Karma Score         | 0.60  | neutral        | 13.2%    | 0.08         |
| Content/Title Risk  | 0.20  | unique content | 18.4%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs        | 15.8%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 13.2%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.24  | no active bans | 13.2%    | 0.03         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.90  | 60% removed    | 10.5%    | 0.09         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.37**     |

**Outcome:** OAuth sufficient — Raw score 0.37. After CAPTCHA: 0.37 × 0.7 = 0.26 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 13: High Purge Rate

An established user whose content is frequently purged (60%). Purges have 1.5× weight compared to regular removals.

**Example Publication:**

```
title: "Trying to post again"
content: "My posts keep getting purged permanently..."
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
| Removal Rate       | No data | Unknown (neutral)       |
| Purge Rate         | 60%     | High risk (1.5× weight) |

### Rate Limit Budget

**Budget multiplier:** 0.75×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 3            | 15          |
| Reply         | 4            | 45          |
| Vote          | 7            | 150         |
| **Aggregate** | **30**       | **187**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                               |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), Account Age (0.50, 90+ days)                |
| No IP check | OAuth enabled (unverified) | 0.45      | 0.32 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Removal Rate (0.90, no data)    |
| No IP check | Google verified            | 0.37      | 0.26 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), Account Age (0.50, 90+ days)                |
| No IP check | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), Account Age (0.50, 90+ days)                |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Removal Rate (0.90, no data)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Removal Rate (0.90, no data), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, no data)               |
| Datacenter  | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)   |
| Datacenter  | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, no data)               |
| Datacenter  | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Removal Rate (0.90, no data)               |
| VPN         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, no data)                |
| VPN         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)    |
| VPN         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, no data)                |
| VPN         | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Removal Rate (0.90, no data)                |
| Tor         | OAuth disabled             | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, no data)               |
| Tor         | OAuth enabled (unverified) | 0.59      | 0.42 ✗               | 0.21 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)   |
| Tor         | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, no data)               |
| Tor         | Google + GitHub verified   | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Removal Rate (0.90, no data)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | 90+ days       | 15.8%    | 0.08         |
| Karma Score         | 0.60  | neutral        | 13.2%    | 0.08         |
| Content/Title Risk  | 0.20  | unique content | 18.4%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs        | 15.8%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 13.2%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.24  | no active bans | 13.2%    | 0.03         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.90  | no data        | 10.5%    | 0.09         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.37**     |

**Outcome:** OAuth sufficient — Raw score 0.37. After CAPTCHA: 0.37 × 0.7 = 0.26 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 14: New, OAuth Unverified

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
| Purge Rate         | No data            | Unknown (neutral)      |
| OAuth Verification | None (but enabled) | High risk (unverified) |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, skipped)      |
| No IP check | OAuth enabled (unverified) | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google verified            | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| No IP check | Google + GitHub verified   | 0.52      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified) |
| Residential | OAuth disabled             | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, skipped), Account Age (1.00, no history)      |
| Residential | OAuth enabled (unverified) | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history) |
| Residential | Google verified            | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history) |
| Residential | Google + GitHub verified   | 0.44      | 0.31 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history) |
| Datacenter  | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, skipped)       |
| Datacenter  | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)  |
| Datacenter  | Google verified            | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)  |
| Datacenter  | Google + GitHub verified   | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)  |
| VPN         | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, skipped)        |
| VPN         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)   |
| VPN         | Google verified            | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)   |
| VPN         | Google + GitHub verified   | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)   |
| Tor         | OAuth disabled             | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, skipped)       |
| Tor         | OAuth enabled (unverified) | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)  |
| Tor         | Google verified            | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)  |
| Tor         | Google + GitHub verified   | 0.65      | 0.46 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)  |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 1.00  | no history     | 17.1%    | 0.17         |
| Karma Score         | 0.60  | no data        | 14.3%    | 0.09         |
| Content/Title Risk  | 0.20  | unique content | 20.0%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs        | 17.1%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 14.3%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | -     | no active bans | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | -     | no data        | 0%       | (skipped)    |
| Social Verification | 1.00  | skipped        | 17.1%    | 0.17         |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.52**     |

**Outcome:** OAuth + more — Raw score 0.52. After CAPTCHA: 0.52 × 0.7 = 0.36 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 15: Moderate Content Spam

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
| Purge Rate         | No data | Unknown (neutral)       |

### Rate Limit Budget

**Budget multiplier:** 1.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 6            | 30          |
| Reply         | 9            | 90          |
| Vote          | 15           | 300         |
| **Aggregate** | **60**       | **375**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                          |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.34      | 0.23 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.45, 3 duplicates), Account Age (0.50, ~7 days)                 |
| No IP check | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.45, 3 duplicates)    |
| No IP check | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.45, 3 duplicates), Account Age (0.50, ~7 days)                 |
| No IP check | Google + GitHub verified   | 0.32      | 0.22 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.45, 3 duplicates), Account Age (0.50, ~7 days)                 |
| Residential | OAuth disabled             | 0.28      | 0.20 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.45, 3 duplicates), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.38      | 0.27 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Content/Title Risk (0.45, 3 duplicates)    |
| Residential | Google verified            | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Social Verification (0.40, Google verified), Content/Title Risk (0.45, 3 duplicates) |
| Residential | Google + GitHub verified   | 0.27      | 0.19 ✓               | —                           | CAPTCHA passes | Content/Title Risk (0.45, 3 duplicates), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.45, 3 duplicates)               |
| Datacenter  | OAuth enabled (unverified) | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)              |
| Datacenter  | Google verified            | 0.48      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Social Verification (0.40, Google verified)           |
| Datacenter  | Google + GitHub verified   | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Content/Title Risk (0.45, 3 duplicates)               |
| VPN         | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.45, 3 duplicates)                |
| VPN         | OAuth enabled (unverified) | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)               |
| VPN         | Google verified            | 0.48      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Social Verification (0.40, Google verified)            |
| VPN         | Google + GitHub verified   | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Content/Title Risk (0.45, 3 duplicates)                |
| Tor         | OAuth disabled             | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.45, 3 duplicates)               |
| Tor         | OAuth enabled (unverified) | 0.56      | 0.39 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)              |
| Tor         | Google verified            | 0.48      | 0.33 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Social Verification (0.40, Google verified)           |
| Tor         | Google + GitHub verified   | 0.45      | 0.31 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Content/Title Risk (0.45, 3 duplicates)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description    | Weight   | Contribution |
| ------------------- | ----- | -------------- | -------- | ------------ |
| Account Age         | 0.50  | ~7 days        | 15.8%    | 0.08         |
| Karma Score         | 0.60  | neutral        | 13.2%    | 0.08         |
| Content/Title Risk  | 0.45  | 3 duplicates   | 18.4%    | 0.08         |
| URL/Link Risk       | 0.20  | no URLs        | 15.8%    | 0.03         |
| Velocity            | 0.10  | normal rate    | 13.2%    | 0.01         |
| IP Risk             | -     | skipped        | 0%       | (skipped)    |
| Ban History         | 0.30  | no active bans | 13.2%    | 0.04         |
| ModQueue Rejection  | -     | no data        | 0%       | (skipped)    |
| Removal Rate        | 0.10  | no data        | 10.5%    | 0.01         |
| Social Verification | -     | skipped        | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet      | 0%       | (skipped)    |
| **Total**           |       |                | **100%** | **0.34**     |

**Outcome:** OAuth sufficient — Raw score 0.34. After CAPTCHA: 0.34 × 0.7 = 0.23 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 16: Perfect User

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
| Purge Rate         | 0%               | Low risk                |
| OAuth Verification | google, github   | Reduced risk (verified) |
| Wallet Activity    | 500 transactions | Very strong activity    |

### Rate Limit Budget

**Budget multiplier:** 1.88×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 7            | 37          |
| Reply         | 11           | 112         |
| Vote          | 18           | 375         |
| **Aggregate** | **75**       | **468**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                              |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------ |
| No IP check | OAuth disabled             | 0.18      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | OAuth enabled (unverified) | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | Google verified            | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| No IP check | Google + GitHub verified   | 0.19      | —                    | —                           | Auto-accepted  | Account Age (0.50, 365+ days), Content/Title Risk (0.20, unique content) |
| Residential | OAuth disabled             | 0.18      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)            |
| Residential | OAuth enabled (unverified) | 0.18      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)            |
| Residential | Google verified            | 0.18      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)            |
| Residential | Google + GitHub verified   | 0.18      | —                    | —                           | Auto-accepted  | IP Risk (0.20, residential IP), Account Age (0.50, 365+ days)            |
| Datacenter  | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | OAuth enabled (unverified) | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| Datacenter  | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (0.50, 365+ days)             |
| VPN         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | OAuth enabled (unverified) | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| VPN         | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (0.50, 365+ days)              |
| Tor         | OAuth disabled             | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | OAuth enabled (unverified) | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |
| Tor         | Google + GitHub verified   | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (0.50, 365+ days)             |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 0.50  | 365+ days            | 13.6%    | 0.07         |
| Karma Score         | 0.10  | positive (+5)        | 11.4%    | 0.01         |
| Content/Title Risk  | 0.20  | unique content       | 15.9%    | 0.03         |
| URL/Link Risk       | 0.20  | no URLs              | 13.6%    | 0.03         |
| Velocity            | 0.10  | normal rate          | 11.4%    | 0.01         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | 0.10  | no active bans       | 11.4%    | 0.01         |
| ModQueue Rejection  | 0.10  | 0% rejected          | 6.8%     | 0.01         |
| Removal Rate        | 0.10  | 0% removed           | 9.1%     | 0.01         |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.10  | 500 tx (very strong) | 6.8%     | 0.01         |
| **Total**           |       |                      | **100%** | **0.18**     |

**Outcome:** Auto-accepted — Score 0.18 falls in the auto-accept tier (< 0.2), allowing the publication without any challenge.

---

## Scenario 17: New User, Active Wallet

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
| Purge Rate         | No data          | Unknown (neutral)      |
| Wallet Activity    | 150 transactions | Strong activity        |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.39      | 0.27 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | OAuth enabled (unverified) | 0.49      | 0.34 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.39      | 0.28 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | Google + GitHub verified   | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| Residential | OAuth disabled             | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.42      | 0.29 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history)    |
| Residential | Google verified            | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| VPN         | OAuth disabled             | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| Tor         | OAuth disabled             | 0.55      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.53      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description     | Weight   | Contribution |
| ------------------- | ----- | --------------- | -------- | ------------ |
| Account Age         | 1.00  | no history      | 18.8%    | 0.19         |
| Karma Score         | 0.60  | no data         | 15.6%    | 0.09         |
| Content/Title Risk  | 0.20  | unique content  | 21.9%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs         | 18.8%    | 0.04         |
| Velocity            | 0.10  | normal rate     | 15.6%    | 0.02         |
| IP Risk             | -     | skipped         | 0%       | (skipped)    |
| Ban History         | -     | no active bans  | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data         | 0%       | (skipped)    |
| Removal Rate        | -     | no data         | 0%       | (skipped)    |
| Social Verification | -     | skipped         | 0%       | (skipped)    |
| Wallet Activity     | 0.15  | 150 tx (strong) | 9.4%     | 0.01         |
| **Total**           |       |                 | **100%** | **0.39**     |

**Outcome:** OAuth sufficient — Raw score 0.39. After CAPTCHA: 0.39 × 0.7 = 0.27 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 18: New User, Low-Activity Wallet

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
| Purge Rate         | No data        | Unknown (neutral)            |
| Wallet Activity    | 5 transactions | Some activity (modest trust) |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                                 |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| No IP check | Google + GitHub verified   | 0.38      | 0.26 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Karma Score (0.60, no data)                 |
| Residential | OAuth disabled             | 0.33      | 0.23 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.43      | 0.30 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, no history)    |
| Residential | Google verified            | 0.34      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.31      | 0.22 ✓               | —                           | CAPTCHA passes | Account Age (1.00, no history), IP Risk (0.20, residential IP)              |
| Datacenter  | OAuth disabled             | 0.57      | 0.40 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | OAuth enabled (unverified) | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)     |
| Datacenter  | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| Datacenter  | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, no history)               |
| VPN         | OAuth disabled             | 0.57      | 0.40 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | OAuth enabled (unverified) | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)      |
| VPN         | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| VPN         | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, no history)                |
| Tor         | OAuth disabled             | 0.57      | 0.40 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | OAuth enabled (unverified) | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)     |
| Tor         | Google verified            | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |
| Tor         | Google + GitHub verified   | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, no history)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 1.00  | no history           | 18.8%    | 0.19         |
| Karma Score         | 0.60  | no data              | 15.6%    | 0.09         |
| Content/Title Risk  | 0.20  | unique content       | 21.9%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs              | 18.8%    | 0.04         |
| Velocity            | 0.10  | normal rate          | 15.6%    | 0.02         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | -     | no active bans       | 0%       | (skipped)    |
| ModQueue Rejection  | -     | no data              | 0%       | (skipped)    |
| Removal Rate        | -     | no data              | 0%       | (skipped)    |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.35  | 5 tx (some activity) | 9.4%     | 0.03         |
| **Total**           |       |                      | **100%** | **0.41**     |

**Outcome:** OAuth + more — Raw score 0.41. After CAPTCHA: 0.41 × 0.7 = 0.29 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 19: Established User, Pseudonymous Sub

Same profile as Established Trusted User (90+ days, +5 karma, Google verified, 250 tx wallet) but all indexed history is from a pseudonymous sub. Indexer data excluded from author-keyed queries — user appears to have no cross-sub history.

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
| Active Bans        | 0                | Skipped (no history)    |
| Velocity           | normal           | No risk                 |
| Content Duplicates | none             | Low risk (unique)       |
| URL Spam           | no urls          | Low risk                |
| ModQueue Rejection | 0%               | Low risk                |
| Removal Rate       | 0%               | Low risk                |
| Purge Rate         | 0%               | Low risk                |
| OAuth Verification | google           | Reduced risk (verified) |
| Wallet Activity    | 250 transactions | Very strong activity    |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                               |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.35      | 0.24 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Karma Score (0.35, positive (+5))           |
| No IP check | OAuth enabled (unverified) | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| No IP check | Google verified            | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| No IP check | Google + GitHub verified   | 0.36      | 0.25 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| Residential | OAuth disabled             | 0.29      | 0.20 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), IP Risk (0.20, residential IP)              |
| Residential | OAuth enabled (unverified) | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| Residential | Google verified            | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| Residential | Google + GitHub verified   | 0.30      | 0.21 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, google verified) |
| Datacenter  | OAuth disabled             | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| Datacenter  | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| Datacenter  | Google verified            | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| Datacenter  | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| VPN         | OAuth disabled             | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| VPN         | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| VPN         | Google verified            | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| VPN         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| Tor         | OAuth disabled             | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |
| Tor         | OAuth enabled (unverified) | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |
| Tor         | Google verified            | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |
| Tor         | Google + GitHub verified   | 0.50      | 0.35 ✓               | —                           | CAPTCHA passes | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description          | Weight   | Contribution |
| ------------------- | ----- | -------------------- | -------- | ------------ |
| Account Age         | 1.00  | 90+ days             | 18.8%    | 0.19         |
| Karma Score         | 0.35  | positive (+5)        | 15.6%    | 0.05         |
| Content/Title Risk  | 0.20  | unique content       | 21.9%    | 0.04         |
| URL/Link Risk       | 0.20  | no URLs              | 18.8%    | 0.04         |
| Velocity            | 0.10  | normal rate          | 15.6%    | 0.02         |
| IP Risk             | -     | skipped              | 0%       | (skipped)    |
| Ban History         | -     | no active bans       | 0%       | (skipped)    |
| ModQueue Rejection  | -     | 0% rejected          | 0%       | (skipped)    |
| Removal Rate        | -     | 0% removed           | 0%       | (skipped)    |
| Social Verification | -     | skipped              | 0%       | (skipped)    |
| Wallet Activity     | 0.10  | 250 tx (very strong) | 9.4%     | 0.01         |
| **Total**           |       |                      | **100%** | **0.35**     |

**Outcome:** OAuth sufficient — Raw score 0.35. After CAPTCHA: 0.35 × 0.7 = 0.24 < 0.4 — **CAPTCHA alone passes**.

---

## Scenario 20: Serial Offender, Pseudonymous Sub

Same profile as Serial Offender (3 bans, -5 karma, 80% modqueue rejection, 60% removal rate) but indexed history is pseudonymous. Ban/removal history from indexer is invisible — offender appears cleaner than they are.

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
| Active Bans        | 3/5 subs | Skipped (no history)   |
| Velocity           | elevated | Moderate risk          |
| Content Duplicates | 3        | Moderate risk          |
| URL Spam           | 1 unique | Low risk (single URL)  |
| ModQueue Rejection | 80%      | High risk              |
| Removal Rate       | 60%      | High risk              |
| Purge Rate         | No data  | Unknown (neutral)      |

### Rate Limit Budget

**Budget multiplier:** 0.50×

| Type          | Hourly Limit | Daily Limit |
| ------------- | ------------ | ----------- |
| Post          | 2            | 10          |
| Reply         | 3            | 30          |
| Vote          | 5            | 100         |
| **Aggregate** | **20**       | **125**     |

### Results by Configuration

#### Posts

| IP Type     | OAuth Config               | Raw Score | After CAPTCHA (×0.7) | After CAPTCHA+OAuth (×0.35) | Outcome        | Top Factors                                                               |
| ----------- | -------------------------- | --------- | -------------------- | --------------------------- | -------------- | ------------------------------------------------------------------------- |
| No IP check | OAuth disabled             | 0.54      | 0.38 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Karma Score (0.65, negative karma)          |
| No IP check | OAuth enabled (unverified) | 0.62      | 0.43 ✗               | 0.22 ✓                      | Needs OAuth    | Account Age (1.00, 90+ days), Social Verification (1.00, not verified)    |
| No IP check | Google verified            | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Karma Score (0.65, negative karma)          |
| No IP check | Google + GitHub verified   | 0.52      | 0.37 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Velocity (0.70, elevated rate)              |
| Residential | OAuth disabled             | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Content/Title Risk (0.45, 3 duplicates)     |
| Residential | OAuth enabled (unverified) | 0.51      | 0.36 ✓               | —                           | CAPTCHA passes | Social Verification (1.00, not verified), Account Age (1.00, 90+ days)    |
| Residential | Google verified            | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Social Verification (0.40, Google verified) |
| Residential | Google + GitHub verified   | 0.41      | 0.29 ✓               | —                           | CAPTCHA passes | Account Age (1.00, 90+ days), Velocity (0.70, elevated rate)              |
| Datacenter  | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| Datacenter  | OAuth enabled (unverified) | 0.72      | 0.51 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Social Verification (1.00, not verified)   |
| Datacenter  | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| Datacenter  | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, datacenter IP), Account Age (1.00, 90+ days)               |
| VPN         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| VPN         | OAuth enabled (unverified) | 0.72      | 0.51 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Social Verification (1.00, not verified)    |
| VPN         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| VPN         | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, VPN detected), Account Age (1.00, 90+ days)                |
| Tor         | OAuth disabled             | 0.67      | 0.47 ✗               | 0.23 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |
| Tor         | OAuth enabled (unverified) | 0.72      | 0.51 ✗               | 0.25 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Social Verification (1.00, not verified)   |
| Tor         | Google verified            | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |
| Tor         | Google + GitHub verified   | 0.63      | 0.44 ✗               | 0.22 ✓                      | Needs OAuth    | IP Risk (1.00, Tor exit node), Account Age (1.00, 90+ days)               |

### Detailed Factor Breakdown

Configuration: **Post** / **No IP check** / **OAuth disabled**

| Factor              | Score | Description             | Weight   | Contribution |
| ------------------- | ----- | ----------------------- | -------- | ------------ |
| Account Age         | 1.00  | 90+ days                | 20.7%    | 0.21         |
| Karma Score         | 0.65  | negative karma          | 17.2%    | 0.11         |
| Content/Title Risk  | 0.45  | 3 duplicates            | 24.1%    | 0.11         |
| URL/Link Risk       | 0.20  | 1 unique URL            | 20.7%    | 0.04         |
| Velocity            | 0.40  | elevated rate           | 17.2%    | 0.07         |
| IP Risk             | -     | skipped                 | 0%       | (skipped)    |
| Ban History         | -     | 3 active bans in 5 subs | 0%       | (skipped)    |
| ModQueue Rejection  | -     | 80% rejected            | 0%       | (skipped)    |
| Removal Rate        | -     | 60% removed             | 0%       | (skipped)    |
| Social Verification | -     | skipped                 | 0%       | (skipped)    |
| Wallet Activity     | -     | no wallet               | 0%       | (skipped)    |
| **Total**           |       |                         | **100%** | **0.54**     |

**Outcome:** OAuth + more — Raw score 0.54. After CAPTCHA: 0.54 × 0.7 = 0.38 < 0.4 — **CAPTCHA alone passes**.

---

## Summary

Overview of risk score ranges and challenge outcomes for each scenario:

| #   | Scenario                           | Score Range | CAPTCHA Passes? | CAPTCHA+OAuth Passes? | Rate Limit × | Possible Outcomes             |
| --- | ---------------------------------- | ----------- | --------------- | --------------------- | ------------ | ----------------------------- |
| 1   | Brand New User                     | 0.31–0.65   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 2   | Established Trusted User           | 0.18–0.37   | Always          | Always                | 1.88×        | Auto-accepted, CAPTCHA passes |
| 3   | New User with Link                 | 0.31–0.65   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 4   | Repeat Link Spammer                | 0.46–0.71   | Sometimes       | Always                | 0.75×        | CAPTCHA passes, Needs OAuth   |
| 5   | Content Duplicator                 | 0.33–0.59   | Sometimes       | Always                | 1.50×        | CAPTCHA passes, Needs OAuth   |
| 6   | Bot-like Velocity                  | 0.40–0.75   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 7   | Serial Offender                    | 0.45–0.70   | Sometimes       | Always                | 0.75×        | CAPTCHA passes, Needs OAuth   |
| 8   | New User, Dual OAuth               | 0.31–0.59   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 9   | Vote Spammer                       | 0.35–0.72   | Sometimes       | Always                | 1.50×        | CAPTCHA passes, Needs OAuth   |
| 10  | Trusted Reply Author               | 0.20–0.47   | Always          | Always                | 1.88×        | CAPTCHA passes, Auto-accepted |
| 11  | Borderline Modqueue                | 0.25–0.52   | Always          | Always                | 1.88×        | CAPTCHA passes                |
| 12  | High Removal Rate                  | 0.31–0.59   | Sometimes       | Always                | 0.75×        | CAPTCHA passes, Needs OAuth   |
| 13  | High Purge Rate                    | 0.31–0.59   | Sometimes       | Always                | 0.75×        | CAPTCHA passes, Needs OAuth   |
| 14  | New, OAuth Unverified              | 0.44–0.65   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 15  | Moderate Content Spam              | 0.27–0.56   | Always          | Always                | 1.50×        | CAPTCHA passes                |
| 16  | Perfect User                       | 0.18–0.36   | Always          | Always                | 1.88×        | Auto-accepted, CAPTCHA passes |
| 17  | New User, Active Wallet            | 0.30–0.62   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 18  | New User, Low-Activity Wallet      | 0.31–0.63   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |
| 19  | Established User, Pseudonymous Sub | 0.29–0.52   | Always          | Always                | 0.50×        | CAPTCHA passes                |
| 20  | Serial Offender, Pseudonymous Sub  | 0.41–0.72   | Sometimes       | Always                | 0.50×        | CAPTCHA passes, Needs OAuth   |

---

_This document is auto-generated. Run `npm run generate-scenarios` to regenerate._
