/**
 * Risk Score Scenario Generator
 *
 * Generates a markdown file with worked examples showing risk scores
 * across all configuration combinations for various scenarios.
 *
 * Usage: npm run generate-scenarios
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SpamDetectionDatabase } from "../src/db/index.js";
import { calculateRiskScore, type CalculateRiskScoreOptions } from "../src/risk-score/index.js";
import { determineChallengeTier, type ChallengeTier } from "../src/risk-score/challenge-tier.js";

// Score adjustment config: reads from env vars, falls back to same defaults as routes/complete.ts
const CAPTCHA_SCORE_MULTIPLIER = process.env.CAPTCHA_SCORE_MULTIPLIER ? parseFloat(process.env.CAPTCHA_SCORE_MULTIPLIER) : 0.7;
const OAUTH_SCORE_MULTIPLIER = process.env.OAUTH_SCORE_MULTIPLIER ? parseFloat(process.env.OAUTH_SCORE_MULTIPLIER) : 0.5;
const CHALLENGE_PASS_THRESHOLD = process.env.CHALLENGE_PASS_THRESHOLD ? parseFloat(process.env.CHALLENGE_PASS_THRESHOLD) : 0.4;
import type { IpIntelligence } from "../src/risk-score/factors/ip-risk.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

type IpType = "disabled" | "residential" | "datacenter" | "vpn" | "tor";
type OAuthConfig = "disabled" | "enabled-unverified" | "google-verified" | "google+github-verified";
type PublicationType = "post" | "reply" | "vote";

interface ExampleContent {
    link?: string;
    title?: string;
    content?: string;
}

interface ScenarioConfig {
    name: string;
    description: string;
    publicationType: PublicationType;
    accountAge: "no_history" | "<1_day" | "7_days" | "30_days" | "90_days" | "365+_days";
    karma: "no_data" | "-5" | "0" | "+3" | "+5";
    velocity: "normal" | "elevated" | "suspicious" | "bot_like";
    banCount: 0 | 1 | 3;
    /** Total distinct subs the author has posted to (including banned ones).
     *  When undefined, defaults to the count of subs seeded by other factors. */
    distinctSubs?: number;
    modqueueRejection: "no_data" | "0%" | "50%" | "80%";
    removalRate: "no_data" | "0%" | "30%" | "60%";
    contentDuplicates: "none" | "3" | "5+";
    urlSpam: "no_urls" | "1_unique" | "5+_same";
    hasOAuthVerification?: string[]; // Provider names, empty means unverified
    /** Wallet nonce (transaction count). undefined = no wallet, 0 = wallet with no tx */
    walletNonce?: number;
    /** Wallet address to use when walletNonce is set */
    walletAddress?: string;
    exampleContent?: ExampleContent;
}

interface ScenarioResult {
    riskScore: number;
    tier: ChallengeTier;
    /** Score after CAPTCHA adjustment (riskScore × captchaMultiplier) */
    afterCaptcha: number;
    /** Score after CAPTCHA + OAuth adjustment (riskScore × captchaMultiplier × oauthMultiplier) */
    afterCaptchaAndOAuth: number;
    /** Whether CAPTCHA alone is sufficient (afterCaptcha < passThreshold) */
    captchaSufficient: boolean;
    /** Whether CAPTCHA + OAuth is sufficient (afterCaptchaAndOAuth < passThreshold) */
    captchaAndOAuthSufficient: boolean;
    factors: Array<{
        name: string;
        score: number;
        weight: number;
        effectiveWeight: number;
        contribution: number;
        explanation: string;
    }>;
}

// ============================================================================
// Configuration Dimensions
// ============================================================================

const IP_TYPES: IpType[] = ["disabled", "residential", "datacenter", "vpn", "tor"];

const OAUTH_CONFIGS: OAuthConfig[] = ["disabled", "enabled-unverified", "google-verified", "google+github-verified"];

const PUBLICATION_TYPES: PublicationType[] = ["post", "reply", "vote"];

// ============================================================================
// Human-Friendly Display Names
// ============================================================================

const FACTOR_DISPLAY_NAMES: Record<string, string> = {
    accountAge: "Account Age",
    karmaScore: "Karma Score",
    commentContentTitleRisk: "Content/Title Risk",
    commentUrlRisk: "URL/Link Risk",
    velocityRisk: "Velocity",
    ipRisk: "IP Risk",
    networkBanHistory: "Ban History",
    modqueueRejectionRate: "ModQueue Rejection",
    networkRemovalRate: "Removal Rate",
    socialVerification: "Social Verification",
    walletVerification: "Wallet Activity"
};

const TIER_DISPLAY_NAMES: Record<ChallengeTier, string> = {
    auto_accept: "Auto-accepted",
    oauth_sufficient: "OAuth sufficient",
    oauth_plus_more: "OAuth + more",
    auto_reject: "Auto-rejected"
};

const IP_TYPE_DISPLAY_NAMES: Record<IpType, string> = {
    disabled: "No IP check",
    residential: "Residential",
    datacenter: "Datacenter",
    vpn: "VPN",
    tor: "Tor"
};

const OAUTH_CONFIG_DISPLAY_NAMES: Record<OAuthConfig, string> = {
    disabled: "OAuth disabled",
    "enabled-unverified": "OAuth enabled (unverified)",
    "google-verified": "Google verified",
    "google+github-verified": "Google + GitHub verified"
};

// ============================================================================
// Score Description Helpers
// ============================================================================

function getAccountAgeScoreDescription(scenario: ScenarioConfig): string {
    switch (scenario.accountAge) {
        case "no_history":
            return "no history";
        case "<1_day":
            return "<1 day old";
        case "7_days":
            return "~7 days";
        case "30_days":
            return "~30 days";
        case "90_days":
            return "90+ days";
        case "365+_days":
            return "365+ days";
    }
}

function getKarmaScoreDescription(scenario: ScenarioConfig): string {
    switch (scenario.karma) {
        case "no_data":
            return "no data";
        case "-5":
            return "negative karma";
        case "0":
            return "neutral";
        case "+3":
            return "positive (+3)";
        case "+5":
            return "positive (+5)";
    }
}

function getVelocityScoreDescription(scenario: ScenarioConfig): string {
    switch (scenario.velocity) {
        case "normal":
            return "normal rate";
        case "elevated":
            return "elevated rate";
        case "suspicious":
            return "suspicious rate";
        case "bot_like":
            return "bot-like rate";
    }
}

function getBanHistoryScoreDescription(scenario: ScenarioConfig): string {
    if (scenario.banCount === 0) return "no active bans";
    const subsInfo = scenario.distinctSubs ? ` in ${scenario.distinctSubs} subs` : "";
    if (scenario.banCount === 1) return `1 active ban${subsInfo}`;
    return `${scenario.banCount} active bans${subsInfo}`;
}

function getModqueueScoreDescription(scenario: ScenarioConfig): string {
    if (scenario.modqueueRejection === "no_data") return "no data";
    return `${scenario.modqueueRejection} rejected`;
}

function getRemovalRateScoreDescription(scenario: ScenarioConfig): string {
    if (scenario.removalRate === "no_data") return "no data";
    return `${scenario.removalRate} removed`;
}

function getContentRiskScoreDescription(scenario: ScenarioConfig): string {
    if (scenario.contentDuplicates === "none") return "unique content";
    if (scenario.contentDuplicates === "3") return "3 duplicates";
    return "5+ duplicates";
}

function getUrlRiskScoreDescription(scenario: ScenarioConfig): string {
    switch (scenario.urlSpam) {
        case "no_urls":
            return "no URLs";
        case "1_unique":
            return "1 unique URL";
        case "5+_same":
            return "5+ same URL";
    }
}

function getIpRiskScoreDescription(ipType: IpType): string {
    switch (ipType) {
        case "disabled":
            return "skipped";
        case "residential":
            return "residential IP";
        case "datacenter":
            return "datacenter IP";
        case "vpn":
            return "VPN detected";
        case "tor":
            return "Tor exit node";
    }
}

function getSocialVerificationScoreDescription(oauthConfig: OAuthConfig, scenario: ScenarioConfig): string {
    if (oauthConfig === "disabled") return "skipped";

    // Check if scenario has explicit OAuth verification
    if (scenario.hasOAuthVerification !== undefined) {
        if (scenario.hasOAuthVerification.length === 0) return "not verified";
        if (scenario.hasOAuthVerification.length === 1) return `${scenario.hasOAuthVerification[0]} verified`;
        return scenario.hasOAuthVerification.join(" + ") + " verified";
    }

    switch (oauthConfig) {
        case "enabled-unverified":
            return "not verified";
        case "google-verified":
            return "Google verified";
        case "google+github-verified":
            return "Google + GitHub verified";
        default:
            return "unknown";
    }
}

function getWalletActivityScoreDescription(scenario: ScenarioConfig): string {
    if (scenario.walletNonce === undefined) return "no wallet";
    if (scenario.walletNonce === 0) return "0 tx (skipped)";
    if (scenario.walletNonce <= 10) return `${scenario.walletNonce} tx (some activity)`;
    if (scenario.walletNonce <= 50) return `${scenario.walletNonce} tx (moderate)`;
    if (scenario.walletNonce <= 200) return `${scenario.walletNonce} tx (strong)`;
    return `${scenario.walletNonce} tx (very strong)`;
}

function getFactorScoreDescription(
    factorName: string,
    score: number,
    scenario: ScenarioConfig,
    ipType: IpType,
    oauthConfig: OAuthConfig
): string {
    switch (factorName) {
        case "accountAge":
            return getAccountAgeScoreDescription(scenario);
        case "karmaScore":
            return getKarmaScoreDescription(scenario);
        case "velocityRisk":
            return getVelocityScoreDescription(scenario);
        case "networkBanHistory":
            return getBanHistoryScoreDescription(scenario);
        case "modqueueRejectionRate":
            return getModqueueScoreDescription(scenario);
        case "networkRemovalRate":
            return getRemovalRateScoreDescription(scenario);
        case "commentContentTitleRisk":
            return getContentRiskScoreDescription(scenario);
        case "commentUrlRisk":
            return getUrlRiskScoreDescription(scenario);
        case "ipRisk":
            return getIpRiskScoreDescription(ipType);
        case "socialVerification":
            return getSocialVerificationScoreDescription(oauthConfig, scenario);
        case "walletVerification":
            return getWalletActivityScoreDescription(scenario);
        default:
            return "";
    }
}

// ============================================================================
// Scenarios
// ============================================================================

const SCENARIOS: ScenarioConfig[] = [
    {
        name: "Brand New User",
        description: "A completely new user making their first post with no history.",
        publicationType: "post",
        accountAge: "no_history",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            title: "First time posting here!",
            content: "Hey everyone, just discovered plebbit and wanted to introduce myself..."
        }
    },
    {
        name: "Established Trusted User",
        description: "A well-established user with 90+ days history, positive karma, Google verification, and an active wallet (250+ tx).",
        publicationType: "post",
        accountAge: "90_days",
        karma: "+5",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "0%",
        removalRate: "0%",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        hasOAuthVerification: ["google"],
        walletNonce: 250,
        exampleContent: {
            title: "Question about plebbit development",
            content: "Has anyone figured out how to run a subplebbit on a VPS? I've been here a while and still learning..."
        }
    },
    {
        name: "New User with Link",
        description: "A very new user (<1 day) posting with a single URL.",
        publicationType: "post",
        accountAge: "<1_day",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "1_unique",
        exampleContent: {
            link: "https://myblog.example.com/decentralization-thoughts",
            title: "I wrote about my experience with decentralized social media",
            content: "Check out my thoughts on the future of social platforms..."
        }
    },
    {
        name: "Repeat Link Spammer",
        description: "A user with negative karma, 1 active ban out of 5 subs, posting the same link repeatedly.",
        publicationType: "post",
        accountAge: "7_days",
        karma: "-5",
        velocity: "elevated",
        banCount: 1,
        distinctSubs: 5,
        modqueueRejection: "50%",
        removalRate: "30%",
        contentDuplicates: "none",
        urlSpam: "5+_same",
        exampleContent: {
            link: "https://sketchy.io/buy/crypto?ref=abc123",
            title: "FREE CRYPTO - Don't miss out!!!",
            content: "Click here for FREE money!!!"
        }
    },
    {
        name: "Content Duplicator",
        description: "A user spamming the same content across multiple posts.",
        publicationType: "post",
        accountAge: "30_days",
        karma: "0",
        velocity: "elevated",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "5+",
        urlSpam: "no_urls",
        exampleContent: {
            title: "Amazing opportunity you can't miss",
            content: "This is duplicate spam content that appears multiple times."
        }
    },
    {
        name: "Bot-like Velocity",
        description: "A very new user posting at automated/bot-like rates.",
        publicationType: "post",
        accountAge: "<1_day",
        karma: "no_data",
        velocity: "bot_like",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            title: "Post #47 in the last hour",
            content: "Automated content generation test message..."
        }
    },
    {
        name: "Serial Offender",
        description: "A known bad actor with 3 active bans out of 5 subs, negative karma, and moderate spam history.",
        publicationType: "post",
        accountAge: "90_days",
        karma: "-5",
        velocity: "elevated",
        banCount: 3,
        distinctSubs: 5,
        modqueueRejection: "80%",
        removalRate: "60%",
        contentDuplicates: "3",
        urlSpam: "1_unique",
        exampleContent: {
            link: "https://192.168.1.100/download.exe",
            title: "FREE SOFTWARE DOWNLOAD NOW",
            content: "CLICK HERE NOW!!! DON'T MISS OUT!!!"
        }
    },
    {
        name: "New User, Dual OAuth",
        description: "A brand new user verified via both Google and GitHub OAuth.",
        publicationType: "post",
        accountAge: "no_history",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        hasOAuthVerification: ["google", "github"],
        exampleContent: {
            title: "Excited to join the community!",
            content: "Hi all, I'm a developer interested in decentralized platforms. Verified my accounts to show I'm legit!"
        }
    },
    {
        name: "Vote Spammer",
        description: "A user with bot-like voting velocity.",
        publicationType: "vote",
        accountAge: "7_days",
        karma: "0",
        velocity: "bot_like",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            content: "(vote: +1 on target comment - 110th vote in the last hour)"
        }
    },
    {
        name: "Trusted Reply Author",
        description: "An established user making a reply with positive karma.",
        publicationType: "reply",
        accountAge: "365+_days",
        karma: "+3",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "0%",
        removalRate: "0%",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            content: "Great question! Based on my experience over the past year, I'd recommend checking out the documentation first..."
        }
    },
    {
        name: "Borderline Modqueue",
        description: "A moderately established user with 50% modqueue rejection rate.",
        publicationType: "post",
        accountAge: "30_days",
        karma: "0",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "50%",
        removalRate: "0%",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            title: "Another attempt at posting",
            content: "Half of my submissions keep getting rejected, not sure why..."
        }
    },
    {
        name: "High Removal Rate",
        description: "An established user whose content is frequently removed (60%).",
        publicationType: "post",
        accountAge: "90_days",
        karma: "0",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "60%",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        exampleContent: {
            title: "Trying again with this post",
            content: "Mods keep removing my content but I'm not sure what rules I'm breaking..."
        }
    },
    {
        name: "New, OAuth Unverified",
        description: "A new user where OAuth is enabled but they haven't verified.",
        publicationType: "post",
        accountAge: "no_history",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        hasOAuthVerification: [], // OAuth enabled but unverified
        exampleContent: {
            title: "New here, skipped the verification",
            content: "Decided not to link my social accounts, is that okay?"
        }
    },
    {
        name: "Moderate Content Spam",
        description: "A user with 3 duplicate content posts.",
        publicationType: "post",
        accountAge: "7_days",
        karma: "0",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "3",
        urlSpam: "no_urls",
        exampleContent: {
            title: "Check this out (posted 3 times)",
            content: "This is duplicate spam content that appears multiple times."
        }
    },
    {
        name: "Perfect User",
        description: "An ideal user with 365+ days history, +5 karma, dual OAuth, active wallet (500+ tx), and clean record.",
        publicationType: "post",
        accountAge: "365+_days",
        karma: "+5",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "0%",
        removalRate: "0%",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        hasOAuthVerification: ["google", "github"],
        walletNonce: 500,
        exampleContent: {
            title: "Comprehensive guide to running your own subplebbit",
            content: "After over a year on the platform, I've compiled everything I've learned..."
        }
    },
    {
        name: "New User, Active Wallet",
        description: "A brand new user with no history but a verified wallet with 150 transactions.",
        publicationType: "post",
        accountAge: "no_history",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        walletNonce: 150,
        exampleContent: {
            title: "Been using crypto for years, just found plebbit",
            content: "Excited to finally have a decentralized alternative to Reddit..."
        }
    },
    {
        name: "New User, Low-Activity Wallet",
        description: "A new user with a wallet that has very few transactions (5 tx).",
        publicationType: "post",
        accountAge: "no_history",
        karma: "no_data",
        velocity: "normal",
        banCount: 0,
        modqueueRejection: "no_data",
        removalRate: "no_data",
        contentDuplicates: "none",
        urlSpam: "no_urls",
        walletNonce: 5,
        exampleContent: {
            title: "Just getting started with crypto and plebbit",
            content: "New to both but excited to learn..."
        }
    }
];

// ============================================================================
// Helper Functions
// ============================================================================

function getIpIntelligence(ipType: IpType): IpIntelligence | undefined {
    switch (ipType) {
        case "disabled":
            return undefined;
        case "residential":
            return { isVpn: false, isProxy: false, isTor: false, isDatacenter: false };
        case "datacenter":
            return { isVpn: false, isProxy: false, isTor: false, isDatacenter: true };
        case "vpn":
            return { isVpn: true, isProxy: false, isTor: false, isDatacenter: false };
        case "tor":
            return { isVpn: false, isProxy: false, isTor: true, isDatacenter: false };
    }
}

function getEnabledOAuthProviders(oauthConfig: OAuthConfig): string[] {
    switch (oauthConfig) {
        case "disabled":
            return [];
        case "enabled-unverified":
            return ["google", "github"];
        case "google-verified":
            return ["google", "github"];
        case "google+github-verified":
            return ["google", "github"];
    }
}

function getAccountAgeTimestamp(accountAge: ScenarioConfig["accountAge"], now: number): number | undefined {
    const DAY = 86400;
    switch (accountAge) {
        case "no_history":
            return undefined;
        case "<1_day":
            return now - DAY * 0.5;
        case "7_days":
            return now - DAY * 10;
        case "30_days":
            return now - DAY * 45;
        case "90_days":
            return now - DAY * 120;
        case "365+_days":
            return now - DAY * 400;
    }
}

function generateUniqueId(): string {
    return Math.random().toString(36).substring(2, 15);
}

// ============================================================================
// Database Seeding
// ============================================================================

function seedDatabase(
    db: SpamDetectionDatabase,
    scenario: ScenarioConfig,
    authorPublicKey: string,
    now: number,
    oauthConfig: OAuthConfig
): void {
    const nowMs = now * 1000;
    const subplebbitAddress = "test-sub.eth";

    // Helper to create sessions and publications
    const createSession = (sessionId: string) => {
        db.insertChallengeSession({
            sessionId,
            subplebbitPublicKey: "test-subplebbit-pubkey",
            expiresAt: nowMs + 3600000
        });
    };

    // Seed account age by adding historical comments
    const accountAgeTimestamp = getAccountAgeTimestamp(scenario.accountAge, now);
    if (accountAgeTimestamp !== undefined) {
        const sessionId = `seed-age-${generateUniqueId()}`;
        createSession(sessionId);

        const db_raw = db.getDb();
        db_raw
            .prepare(
                `
            INSERT INTO comments (sessionId, author, subplebbitAddress, content, signature, timestamp, protocolVersion, receivedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
            )
            .run(
                sessionId,
                JSON.stringify({ address: "seed-author" }),
                subplebbitAddress,
                "Historical comment for account age",
                JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                accountAgeTimestamp,
                "1",
                accountAgeTimestamp * 1000
            );
    }

    // Seed karma by adding historical karma data in indexed tables
    if (scenario.karma !== "no_data") {
        const karmaValue = scenario.karma === "+5" ? 5 : scenario.karma === "+3" ? 3 : scenario.karma === "-5" ? -5 : 0;

        // Add karma to multiple domain-addressed subplebbits
        const karmaSubsCount = Math.abs(karmaValue) > 0 ? Math.abs(karmaValue) : 1;
        for (let i = 0; i < karmaSubsCount; i++) {
            const subAddr = `karma-sub-${i}.eth`;
            const db_raw = db.getDb();

            // Insert indexed subplebbit
            db_raw
                .prepare(
                    `
                INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
                VALUES (?, 'manual', ?, 1)
            `
                )
                .run(subAddr, nowMs);

            // Insert indexed comment IPFS
            const cid = `Qm${generateUniqueId()}`;
            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                VALUES (?, ?, ?, ?, ?, ?, '1')
            `
                )
                .run(
                    cid,
                    subAddr,
                    JSON.stringify({ address: "seed-author" }),
                    JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                    now - 86400 * 30,
                    nowMs - 86400000 * 30
                );

            // Insert indexed comment update with karma
            const postScore = karmaValue > 0 ? 10 : karmaValue < 0 ? -10 : 0;
            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_update (cid, author, updatedAt, fetchedAt)
                VALUES (?, ?, ?, ?)
            `
                )
                .run(cid, JSON.stringify({ subplebbit: { postScore, replyScore: 0 } }), now - 86400, nowMs - 86400000);
        }
    }

    // Seed velocity by adding recent publications
    if (scenario.velocity !== "normal") {
        const pubType = scenario.publicationType;
        let count = 0;
        switch (scenario.velocity) {
            case "elevated":
                count = pubType === "vote" ? 30 : pubType === "reply" ? 8 : 4;
                break;
            case "suspicious":
                count = pubType === "vote" ? 50 : pubType === "reply" ? 12 : 7;
                break;
            case "bot_like":
                count = pubType === "vote" ? 110 : pubType === "reply" ? 30 : 15;
                break;
        }

        for (let i = 0; i < count; i++) {
            const sessionId = `seed-vel-${generateUniqueId()}`;
            createSession(sessionId);

            const receivedAt = nowMs - (3600000 * i) / count; // Spread across last hour

            if (pubType === "vote") {
                db.insertVote({
                    sessionId,
                    publication: {
                        author: { address: "seed-author" },
                        subplebbitAddress,
                        commentCid: `Qm${generateUniqueId()}`,
                        signature: { publicKey: authorPublicKey, signature: "dummy", type: "ed25519" },
                        protocolVersion: "1",
                        vote: 1,
                        timestamp: Math.floor(receivedAt / 1000)
                    }
                });
                // Update receivedAt
                db.getDb().prepare("UPDATE votes SET receivedAt = ? WHERE sessionId = ?").run(receivedAt, sessionId);
            } else {
                const publication: Parameters<typeof db.insertComment>[0]["publication"] = {
                    author: { address: "seed-author" },
                    subplebbitAddress,
                    signature: { publicKey: authorPublicKey, signature: "dummy", type: "ed25519" },
                    protocolVersion: "1",
                    content: `Velocity test content ${i}`,
                    timestamp: Math.floor(receivedAt / 1000)
                };
                if (pubType === "reply") {
                    publication.parentCid = `QmParent${generateUniqueId()}`;
                }
                db.insertComment({ sessionId, publication });
                // Update receivedAt
                db.getDb().prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?").run(receivedAt, sessionId);
            }
        }
    }

    // Seed ban history
    if (scenario.banCount > 0) {
        const db_raw = db.getDb();
        for (let i = 0; i < scenario.banCount; i++) {
            const subAddr = `ban-sub-${i}.eth`;

            // Insert indexed subplebbit
            db_raw
                .prepare(
                    `
                INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
                VALUES (?, 'manual', ?, 1)
            `
                )
                .run(subAddr, nowMs);

            // Insert indexed comment with ban
            const cid = `QmBan${generateUniqueId()}`;
            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                VALUES (?, ?, ?, ?, ?, ?, '1')
            `
                )
                .run(
                    cid,
                    subAddr,
                    JSON.stringify({ address: "seed-author" }),
                    JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                    now - 86400 * 30,
                    nowMs - 86400000 * 30
                );

            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_update (cid, author, updatedAt, fetchedAt)
                VALUES (?, ?, ?, ?)
            `
                )
                .run(cid, JSON.stringify({ subplebbit: { banExpiresAt: now + 86400 * 365 } }), now - 86400, nowMs - 86400000);
        }
    }

    // Seed additional distinct subs if distinctSubs is specified and exceeds what's already been created
    if (scenario.distinctSubs !== undefined) {
        const db_raw = db.getDb();
        // Count how many distinct subs already exist for this author in indexed_comments_ipfs
        const existingCount = (
            db_raw
                .prepare(
                    `SELECT COUNT(DISTINCT subplebbitAddress) as cnt FROM indexed_comments_ipfs
                     WHERE json_extract(signature, '$.publicKey') = ?`
                )
                .get(authorPublicKey) as { cnt: number }
        ).cnt;

        const needed = scenario.distinctSubs - existingCount;
        for (let i = 0; i < needed; i++) {
            const subAddr = `extra-sub-${i}.eth`;
            const cid = `QmExtra${generateUniqueId()}`;

            db_raw
                .prepare(
                    `INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
                     VALUES (?, 'manual', ?, 1)`
                )
                .run(subAddr, nowMs);

            db_raw
                .prepare(
                    `INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                     VALUES (?, ?, ?, ?, ?, ?, '1')`
                )
                .run(
                    cid,
                    subAddr,
                    JSON.stringify({ address: "seed-author" }),
                    JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                    now - 86400 * 30,
                    nowMs - 86400000 * 30
                );

            db_raw
                .prepare(
                    `INSERT INTO indexed_comments_update (cid, updatedAt, fetchedAt)
                     VALUES (?, ?, ?)`
                )
                .run(cid, now - 86400, nowMs - 86400000);
        }
    }

    // Seed modqueue rejection rate
    if (scenario.modqueueRejection !== "no_data") {
        const db_raw = db.getDb();
        const totalSubmissions = 10;
        let rejectedCount = 0;
        switch (scenario.modqueueRejection) {
            case "0%":
                rejectedCount = 0;
                break;
            case "50%":
                rejectedCount = 5;
                break;
            case "80%":
                rejectedCount = 8;
                break;
        }

        const modqueueSubAddr = "modqueue-sub.eth";
        db_raw
            .prepare(
                `
            INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
            VALUES (?, 'manual', ?, 1)
        `
            )
            .run(modqueueSubAddr, nowMs);

        for (let i = 0; i < totalSubmissions; i++) {
            const cid = `QmMod${generateUniqueId()}`;
            const accepted = i >= rejectedCount;

            db_raw
                .prepare(
                    `
                INSERT INTO modqueue_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, firstSeenAt, protocolVersion)
                VALUES (?, ?, ?, ?, ?, ?, '1')
            `
                )
                .run(
                    cid,
                    modqueueSubAddr,
                    JSON.stringify({ address: "seed-author" }),
                    JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                    now - 86400 * 10,
                    nowMs - 86400000 * 10
                );

            db_raw
                .prepare(
                    `
                INSERT INTO modqueue_comments_update (cid, pendingApproval, lastSeenAt, resolved, resolvedAt, accepted)
                VALUES (?, 1, ?, 1, ?, ?)
            `
                )
                .run(cid, nowMs - 86400000 * 5, nowMs - 86400000, accepted ? 1 : 0);
        }
    }

    // Seed removal rate
    if (scenario.removalRate !== "no_data") {
        const db_raw = db.getDb();
        const totalComments = 10;
        let removedCount = 0;
        switch (scenario.removalRate) {
            case "0%":
                removedCount = 0;
                break;
            case "30%":
                removedCount = 3;
                break;
            case "60%":
                removedCount = 6;
                break;
        }

        const removalSubAddr = "removal-sub.eth";
        db_raw
            .prepare(
                `
            INSERT OR IGNORE INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
            VALUES (?, 'manual', ?, 1)
        `
            )
            .run(removalSubAddr, nowMs);

        for (let i = 0; i < totalComments; i++) {
            const cid = `QmRemove${generateUniqueId()}`;
            const removed = i < removedCount;

            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_ipfs (cid, subplebbitAddress, author, signature, timestamp, fetchedAt, protocolVersion)
                VALUES (?, ?, ?, ?, ?, ?, '1')
            `
                )
                .run(
                    cid,
                    removalSubAddr,
                    JSON.stringify({ address: "seed-author" }),
                    JSON.stringify({ publicKey: authorPublicKey, signature: "dummy", type: "ed25519" }),
                    now - 86400 * 10,
                    nowMs - 86400000 * 10
                );

            db_raw
                .prepare(
                    `
                INSERT INTO indexed_comments_update (cid, removed, updatedAt, fetchedAt)
                VALUES (?, ?, ?, ?)
            `
                )
                .run(cid, removed ? 1 : 0, now - 86400, nowMs - 86400000);
        }
    }

    // Seed content duplicates
    if (scenario.contentDuplicates !== "none") {
        const dupContent = "This is duplicate spam content that appears multiple times.";
        const dupCount = scenario.contentDuplicates === "3" ? 3 : 6;

        for (let i = 0; i < dupCount; i++) {
            const sessionId = `seed-dup-${generateUniqueId()}`;
            createSession(sessionId);

            db.insertComment({
                sessionId,
                publication: {
                    author: { address: "seed-author" },
                    subplebbitAddress,
                    signature: { publicKey: authorPublicKey, signature: `dup-${i}`, type: "ed25519" },
                    protocolVersion: "1",
                    content: dupContent,
                    timestamp: now - 3600 * (i + 1)
                }
            });
            // Update receivedAt to be within 24 hours
            db.getDb()
                .prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?")
                .run(nowMs - 3600000 * (i + 1), sessionId);
        }
    }

    // Seed URL spam
    if (scenario.urlSpam !== "no_urls") {
        const spamUrl = "https://spam.example.com/buy-now";

        if (scenario.urlSpam === "1_unique") {
            // Just one unique URL - no seeding needed, the test publication will have it
        } else if (scenario.urlSpam === "5+_same") {
            // Add 5 previous posts with the same URL
            for (let i = 0; i < 5; i++) {
                const sessionId = `seed-url-${generateUniqueId()}`;
                createSession(sessionId);

                db.insertComment({
                    sessionId,
                    publication: {
                        author: { address: "seed-author" },
                        subplebbitAddress,
                        signature: { publicKey: authorPublicKey, signature: `url-${i}`, type: "ed25519" },
                        protocolVersion: "1",
                        content: "Check out this link",
                        link: spamUrl,
                        timestamp: now - 3600 * (i + 1)
                    }
                });
                // Update receivedAt
                db.getDb()
                    .prepare("UPDATE comments SET receivedAt = ? WHERE sessionId = ?")
                    .run(nowMs - 3600000 * (i + 1), sessionId);
            }
        }
    }

    // Seed OAuth verification based on oauthConfig parameter
    // This determines what OAuth verification the author has for this test configuration
    let providersToSeed: string[] = [];

    if (oauthConfig === "google-verified") {
        providersToSeed = ["google"];
    } else if (oauthConfig === "google+github-verified") {
        providersToSeed = ["google", "github"];
    }
    // For "disabled" and "enabled-unverified", don't seed any OAuth

    // Also consider scenario-specific OAuth verification (for scenarios that explicitly define it)
    // If scenario has explicit hasOAuthVerification, use it instead (takes precedence)
    if (scenario.hasOAuthVerification !== undefined) {
        providersToSeed = scenario.hasOAuthVerification;
    }

    for (const provider of providersToSeed) {
        const sessionId = `seed-oauth-${generateUniqueId()}`;
        createSession(sessionId);

        // Insert a comment linked to this session
        db.insertComment({
            sessionId,
            publication: {
                author: { address: "seed-author" },
                subplebbitAddress,
                signature: { publicKey: authorPublicKey, signature: `oauth-${provider}`, type: "ed25519" },
                protocolVersion: "1",
                content: "OAuth verified comment",
                timestamp: now - 86400
            }
        });

        // Mark session as completed with OAuth identity
        db.updateChallengeSessionStatus(sessionId, "completed", nowMs - 86400000, `${provider}:user123`);
    }
}

// ============================================================================
// Challenge Request Creation
// ============================================================================

function createMockChallengeRequest(
    scenario: ScenarioConfig,
    authorPublicKey: string,
    now: number
): DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
    const subplebbitAddress = "test-sub.eth";

    // Build author object
    const author: Record<string, unknown> = {
        address: "12D3KooWAuthorAddress"
    };

    // Add subplebbit author data for karma
    if (scenario.karma !== "no_data") {
        const karmaValue = scenario.karma === "+5" ? 10 : scenario.karma === "+3" ? 5 : scenario.karma === "-5" ? -10 : 0;
        author.subplebbit = {
            postScore: karmaValue,
            replyScore: 0
        };
    } else {
        author.subplebbit = {
            postScore: 0,
            replyScore: 0
        };
    }

    // Add wallet data if scenario has wallet nonce
    if (scenario.walletNonce !== undefined) {
        const walletAddress = scenario.walletAddress || "0x742d35Cc6634C0532925a3b844Bc9e7595f6Cb61";
        author.wallets = {
            eth: {
                address: walletAddress,
                timestamp: now - 86400,
                signature: { signature: "mock-wallet-sig", type: "eip191" }
            }
        };
    }

    const signature = {
        publicKey: authorPublicKey,
        signature: "mock-signature",
        type: "ed25519",
        signedPropertyNames: ["author", "subplebbitAddress", "timestamp", "protocolVersion", "content"]
    };

    const basePublication = {
        author,
        subplebbitAddress,
        timestamp: now,
        protocolVersion: "1",
        signature
    };

    // Create the appropriate publication type
    if (scenario.publicationType === "vote") {
        return {
            vote: {
                ...basePublication,
                commentCid: "QmVoteTarget",
                vote: 1
            }
        } as unknown as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
    }

    // Comment (post or reply)
    const comment: Record<string, unknown> = {
        ...basePublication,
        content:
            scenario.contentDuplicates !== "none" ? "This is duplicate spam content that appears multiple times." : "Test comment content"
    };

    if (scenario.publicationType === "reply") {
        comment.parentCid = "QmParentComment";
    }

    if (scenario.urlSpam === "1_unique") {
        comment.link = "https://unique-blog.example.com/article";
    } else if (scenario.urlSpam === "5+_same") {
        comment.link = "https://spam.example.com/buy-now";
    }

    return {
        comment
    } as unknown as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
}

// ============================================================================
// Scenario Execution
// ============================================================================

function runScenario(scenario: ScenarioConfig, ipType: IpType, oauthConfig: OAuthConfig): ScenarioResult {
    // Create fresh in-memory database for this scenario
    const db = new SpamDetectionDatabase({ path: ":memory:" });
    const now = Math.floor(Date.now() / 1000);
    const authorPublicKey = `scenario-author-${generateUniqueId()}`;

    try {
        // Seed the database with appropriate historical data
        seedDatabase(db, scenario, authorPublicKey, now, oauthConfig);

        // Create the mock challenge request
        const challengeRequest = createMockChallengeRequest(scenario, authorPublicKey, now);

        // Get IP intelligence
        const ipIntelligence = getIpIntelligence(ipType);

        // Get enabled OAuth providers
        let enabledOAuthProviders = getEnabledOAuthProviders(oauthConfig);

        // If scenario has explicit hasOAuthVerification = [] (meaning oauth enabled but not verified),
        // we still need providers enabled
        if (scenario.hasOAuthVerification !== undefined && scenario.hasOAuthVerification.length === 0) {
            enabledOAuthProviders = ["google", "github"];
        }

        // Build wallet transaction counts if scenario has wallet data
        let walletTransactionCounts: Record<string, number> | undefined;
        if (scenario.walletNonce !== undefined) {
            const walletAddress = scenario.walletAddress || "0x742d35Cc6634C0532925a3b844Bc9e7595f6Cb61";
            walletTransactionCounts = { [walletAddress.toLowerCase()]: scenario.walletNonce };
        }

        // Calculate risk score
        const options: CalculateRiskScoreOptions = {
            challengeRequest,
            db,
            ipIntelligence,
            enabledOAuthProviders,
            walletTransactionCounts,
            now
        };

        const result = calculateRiskScore(options);
        const tier = determineChallengeTier(result.score);

        // Compute adjusted scores
        const afterCaptcha = result.score * CAPTCHA_SCORE_MULTIPLIER;
        const afterCaptchaAndOAuth = afterCaptcha * OAUTH_SCORE_MULTIPLIER;
        const captchaSufficient = afterCaptcha < CHALLENGE_PASS_THRESHOLD;
        const captchaAndOAuthSufficient = afterCaptchaAndOAuth < CHALLENGE_PASS_THRESHOLD;

        // Build factor breakdown
        const factors = result.factors.map((f) => ({
            name: f.name,
            score: f.score,
            weight: f.weight,
            effectiveWeight: f.effectiveWeight ?? 0,
            contribution: f.score * (f.effectiveWeight ?? 0),
            explanation: f.explanation
        }));

        return {
            riskScore: result.score,
            tier,
            afterCaptcha,
            afterCaptchaAndOAuth,
            captchaSufficient,
            captchaAndOAuthSufficient,
            factors
        };
    } finally {
        db.close();
    }
}

// ============================================================================
// Markdown Generation
// ============================================================================

function formatScore(score: number): string {
    return score.toFixed(2);
}

function formatPercentage(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function getTopFactors(
    factors: ScenarioResult["factors"],
    scenario: ScenarioConfig,
    ipType: IpType,
    oauthConfig: OAuthConfig,
    count: number = 3
): string {
    const sorted = [...factors]
        .filter((f) => f.weight > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, count);

    return sorted
        .map((f) => {
            const displayName = FACTOR_DISPLAY_NAMES[f.name] || f.name;
            const desc = getFactorScoreDescription(f.name, f.score, scenario, ipType, oauthConfig);
            return `${displayName} (${formatScore(f.score)}, ${desc})`;
        })
        .join(", ");
}

function generateExamplePublicationBlock(scenario: ScenarioConfig): string[] {
    const lines: string[] = [];

    if (!scenario.exampleContent) {
        return lines;
    }

    lines.push("**Example Publication:**");
    lines.push("");
    lines.push("```");

    if (scenario.publicationType === "vote") {
        lines.push(`vote: +1`);
        lines.push(`commentCid: "QmTargetComment123..."`);
        if (scenario.exampleContent.content) {
            lines.push(`# ${scenario.exampleContent.content}`);
        }
    } else {
        if (scenario.exampleContent.link) {
            lines.push(`link: "${scenario.exampleContent.link}"`);
        }
        if (scenario.exampleContent.title) {
            lines.push(`title: "${scenario.exampleContent.title}"`);
        }
        if (scenario.exampleContent.content) {
            lines.push(`content: "${scenario.exampleContent.content}"`);
        }
        if (scenario.publicationType === "reply") {
            lines.push(`parentCid: "QmParentComment..."`);
        }
    }

    lines.push("```");
    lines.push("");

    return lines;
}

function generateAuthorProfileTable(scenario: ScenarioConfig, sampleResult?: ScenarioResult): string[] {
    // Helper to check if a factor was skipped in the sample result
    const isFactorSkipped = (factorName: string): boolean => {
        if (!sampleResult) return false;
        const factor = sampleResult.factors.find((f) => f.name === factorName);
        return factor ? factor.weight === 0 : false;
    };
    const lines: string[] = [];

    lines.push("**Author Profile:**");
    lines.push("");
    lines.push("| Attribute | Value | Risk Implication |");
    lines.push("|-----------|-------|------------------|");

    // Account Age
    const accountAgeDisplay = scenario.accountAge.replace(/_/g, " ");
    const accountAgeRisk =
        scenario.accountAge === "no_history"
            ? "High risk (no history)"
            : scenario.accountAge === "<1_day"
              ? "High risk (very new)"
              : scenario.accountAge === "7_days"
                ? "Moderate risk"
                : scenario.accountAge === "30_days"
                  ? "Low-moderate risk"
                  : "Low risk (established)";
    lines.push(`| Account Age | ${accountAgeDisplay} | ${accountAgeRisk} |`);

    // Karma
    const karmaDisplay = scenario.karma.replace(/_/g, " ");
    const karmaRisk =
        scenario.karma === "no_data"
            ? "Unknown (neutral)"
            : scenario.karma === "-5"
              ? "High risk (negative)"
              : scenario.karma === "0"
                ? "Neutral"
                : "Low risk (positive)";
    lines.push(`| Karma | ${karmaDisplay} | ${karmaRisk} |`);

    // Bans
    const banDisplay = scenario.distinctSubs ? `${scenario.banCount}/${scenario.distinctSubs} subs` : `${scenario.banCount}`;
    const banRisk = isFactorSkipped("networkBanHistory")
        ? "Skipped (no history)"
        : scenario.banCount === 0
          ? "Low risk (clean record)"
          : scenario.banCount === 1
            ? "Moderate risk"
            : "High risk";
    lines.push(`| Active Bans | ${banDisplay} | ${banRisk} |`);

    // Velocity
    const velocityRisk =
        scenario.velocity === "normal"
            ? "No risk"
            : scenario.velocity === "elevated"
              ? "Moderate risk"
              : scenario.velocity === "suspicious"
                ? "High risk"
                : "Very high risk (bot-like)";
    lines.push(`| Velocity | ${scenario.velocity} | ${velocityRisk} |`);

    // Content Duplicates
    const contentRisk = isFactorSkipped("commentContentTitleRisk")
        ? "N/A (skipped)"
        : scenario.contentDuplicates === "none"
          ? "Low risk (unique)"
          : scenario.contentDuplicates === "3"
            ? "Moderate risk"
            : "High risk (spam pattern)";
    const contentDisplay = isFactorSkipped("commentContentTitleRisk") ? "—" : scenario.contentDuplicates;
    lines.push(`| Content Duplicates | ${contentDisplay} | ${contentRisk} |`);

    // URL Spam
    const urlRisk = isFactorSkipped("commentUrlRisk")
        ? "N/A (skipped)"
        : scenario.urlSpam === "no_urls"
          ? "Low risk"
          : scenario.urlSpam === "1_unique"
            ? "Low risk (single URL)"
            : "High risk (repeated URL)";
    const urlDisplay = isFactorSkipped("commentUrlRisk") ? "—" : scenario.urlSpam.replace(/_/g, " ");
    lines.push(`| URL Spam | ${urlDisplay} | ${urlRisk} |`);

    // Modqueue Rejection
    const modqueueDisplay = scenario.modqueueRejection === "no_data" ? "No data" : scenario.modqueueRejection;
    const modqueueRisk =
        scenario.modqueueRejection === "no_data"
            ? "Unknown (neutral)"
            : scenario.modqueueRejection === "0%"
              ? "Low risk"
              : scenario.modqueueRejection === "50%"
                ? "Moderate risk"
                : "High risk";
    lines.push(`| ModQueue Rejection | ${modqueueDisplay} | ${modqueueRisk} |`);

    // Removal Rate
    const removalDisplay = scenario.removalRate === "no_data" ? "No data" : scenario.removalRate;
    const removalRisk =
        scenario.removalRate === "no_data"
            ? "Unknown (neutral)"
            : scenario.removalRate === "0%"
              ? "Low risk"
              : scenario.removalRate === "30%"
                ? "Moderate risk"
                : "High risk";
    lines.push(`| Removal Rate | ${removalDisplay} | ${removalRisk} |`);

    // OAuth Verification (if applicable)
    if (scenario.hasOAuthVerification !== undefined) {
        const oauthDisplay = scenario.hasOAuthVerification.length > 0 ? scenario.hasOAuthVerification.join(", ") : "None (but enabled)";
        const oauthRisk = scenario.hasOAuthVerification.length > 0 ? "Reduced risk (verified)" : "High risk (unverified)";
        lines.push(`| OAuth Verification | ${oauthDisplay} | ${oauthRisk} |`);
    }

    // Wallet Activity (if applicable)
    if (scenario.walletNonce !== undefined) {
        const walletDisplay = `${scenario.walletNonce} transactions`;
        const walletRisk =
            scenario.walletNonce === 0
                ? "Skipped (no transactions)"
                : scenario.walletNonce <= 10
                  ? "Some activity (modest trust)"
                  : scenario.walletNonce <= 50
                    ? "Moderate activity"
                    : scenario.walletNonce <= 200
                      ? "Strong activity"
                      : "Very strong activity";
        lines.push(`| Wallet Activity | ${walletDisplay} | ${walletRisk} |`);
    }

    lines.push("");

    return lines;
}

function getAdjustedOutcome(result: ScenarioResult): string {
    if (result.tier === "auto_accept") return "Auto-accepted";
    if (result.tier === "auto_reject") return "Auto-rejected";
    if (result.captchaSufficient) return "CAPTCHA passes";
    if (result.captchaAndOAuthSufficient) return "Needs OAuth";
    return "Auto-rejected*";
}

function generatePublicationTypeResults(
    pubType: PublicationType,
    results: Array<{
        pubType: PublicationType;
        ipType: IpType;
        oauthConfig: OAuthConfig;
        result: ScenarioResult;
    }>,
    scenario: ScenarioConfig
): string[] {
    const lines: string[] = [];
    // Handle pluralization correctly (reply -> Replies, not Replys)
    const pubTypeDisplay = pubType === "reply" ? "Replies" : pubType.charAt(0).toUpperCase() + pubType.slice(1) + "s";

    lines.push(`#### ${pubTypeDisplay}`);
    lines.push("");
    const combinedMultiplier = CAPTCHA_SCORE_MULTIPLIER * OAUTH_SCORE_MULTIPLIER;
    lines.push(
        `| IP Type | OAuth Config | Raw Score | After CAPTCHA (×${CAPTCHA_SCORE_MULTIPLIER}) | After CAPTCHA+OAuth (×${combinedMultiplier}) | Outcome | Top Factors |`
    );
    lines.push("|---------|--------------|-----------|----------------------|-----------------------------|---------|-------------|");

    const pubTypeResults = results.filter((r) => r.pubType === pubType);

    for (const { ipType, oauthConfig, result } of pubTypeResults) {
        const ipDisplay = IP_TYPE_DISPLAY_NAMES[ipType];
        const oauthDisplay = OAUTH_CONFIG_DISPLAY_NAMES[oauthConfig];
        const outcome = getAdjustedOutcome(result);
        const topFactors = getTopFactors(result.factors, scenario, ipType, oauthConfig, 2);

        // Show adjusted scores with pass/fail indicators
        const captchaScore =
            result.tier === "auto_accept" || result.tier === "auto_reject"
                ? "—"
                : `${formatScore(result.afterCaptcha)} ${result.captchaSufficient ? "✓" : "✗"}`;
        const oauthScore =
            result.tier === "auto_accept" || result.tier === "auto_reject"
                ? "—"
                : result.captchaSufficient
                  ? "—"
                  : `${formatScore(result.afterCaptchaAndOAuth)} ${result.captchaAndOAuthSufficient ? "✓" : "✗"}`;

        lines.push(
            `| ${ipDisplay} | ${oauthDisplay} | ${formatScore(result.riskScore)} | ${captchaScore} | ${oauthScore} | ${outcome} | ${topFactors} |`
        );
    }

    lines.push("");

    return lines;
}

function generateFactorBreakdownTable(
    result: ScenarioResult,
    scenario: ScenarioConfig,
    ipType: IpType,
    oauthConfig: OAuthConfig,
    pubType: PublicationType
): string[] {
    const lines: string[] = [];

    const pubTypeDisplay = pubType.charAt(0).toUpperCase() + pubType.slice(1);
    const ipDisplay = IP_TYPE_DISPLAY_NAMES[ipType];
    const oauthDisplay = OAUTH_CONFIG_DISPLAY_NAMES[oauthConfig];

    lines.push(`### Detailed Factor Breakdown`);
    lines.push("");
    lines.push(`Configuration: **${pubTypeDisplay}** / **${ipDisplay}** / **${oauthDisplay}**`);
    lines.push("");
    lines.push("| Factor | Score | Description | Weight | Contribution |");
    lines.push("|--------|-------|-------------|--------|--------------|");

    for (const factor of result.factors) {
        const displayName = FACTOR_DISPLAY_NAMES[factor.name] || factor.name;
        const desc = getFactorScoreDescription(factor.name, factor.score, scenario, ipType, oauthConfig);

        if (factor.weight === 0) {
            lines.push(`| ${displayName} | - | ${desc} | 0% | (skipped) |`);
        } else {
            lines.push(
                `| ${displayName} | ${formatScore(factor.score)} | ${desc} | ${formatPercentage(factor.effectiveWeight)} | ${formatScore(factor.contribution)} |`
            );
        }
    }

    lines.push(`| **Total** | | | **100%** | **${formatScore(result.riskScore)}** |`);
    lines.push("");

    // Add outcome explanation with adjusted scores
    const tierDisplay = TIER_DISPLAY_NAMES[result.tier];
    let outcomeExplanation = "";

    switch (result.tier) {
        case "auto_accept":
            outcomeExplanation = `Score ${formatScore(result.riskScore)} falls in the auto-accept tier (< 0.2), allowing the publication without any challenge.`;
            break;
        case "auto_reject":
            outcomeExplanation = `Score ${formatScore(result.riskScore)} falls in the auto-reject tier (>= 0.8), automatically rejecting the publication.`;
            break;
        default: {
            // Show the score adjustment path
            outcomeExplanation = `Raw score ${formatScore(result.riskScore)}.`;
            outcomeExplanation += ` After CAPTCHA: ${formatScore(result.riskScore)} × ${CAPTCHA_SCORE_MULTIPLIER} = ${formatScore(result.afterCaptcha)}`;
            if (result.captchaSufficient) {
                outcomeExplanation += ` < ${CHALLENGE_PASS_THRESHOLD} — **CAPTCHA alone passes**.`;
            } else {
                outcomeExplanation += ` >= ${CHALLENGE_PASS_THRESHOLD} — CAPTCHA not sufficient.`;
                const combinedMultiplier = CAPTCHA_SCORE_MULTIPLIER * OAUTH_SCORE_MULTIPLIER;
                outcomeExplanation += ` After CAPTCHA+OAuth: ${formatScore(result.riskScore)} × ${combinedMultiplier} = ${formatScore(result.afterCaptchaAndOAuth)}`;
                if (result.captchaAndOAuthSufficient) {
                    outcomeExplanation += ` < ${CHALLENGE_PASS_THRESHOLD} — **CAPTCHA + OAuth passes**.`;
                } else {
                    outcomeExplanation += ` >= ${CHALLENGE_PASS_THRESHOLD} — still fails (effectively rejected).`;
                }
            }
            break;
        }
    }

    lines.push(`**Outcome:** ${tierDisplay} — ${outcomeExplanation}`);
    lines.push("");

    return lines;
}

function generateMarkdown(): string {
    const lines: string[] = [];
    const generatedDate = new Date().toISOString().split("T")[0];

    lines.push("# Risk Score Scenarios");
    lines.push("");
    lines.push(`*Generated: ${generatedDate}*`);
    lines.push("");
    lines.push("This document shows how risk scores are calculated for various user scenarios across different");
    lines.push("configuration combinations. Each scenario represents a realistic user profile with specific");
    lines.push("behavioral patterns.");
    lines.push("");
    lines.push("## Configuration Variables");
    lines.push("");
    lines.push("Each scenario is tested against all combinations of:");
    lines.push("");
    lines.push("**IP Intelligence:**");
    lines.push("- No IP check (disabled)");
    lines.push("- Residential IP (low risk)");
    lines.push("- Datacenter IP (elevated risk)");
    lines.push("- VPN detected (high risk)");
    lines.push("- Tor exit node (very high risk)");
    lines.push("");
    lines.push("**OAuth Configuration:**");
    lines.push("- OAuth disabled");
    lines.push("- OAuth enabled but user not verified");
    lines.push("- Google verified");
    lines.push("- Google + GitHub verified");
    lines.push("");
    lines.push("**Publication Types:** Posts, Replies, Votes");
    lines.push("");
    lines.push(
        `**Total: ${IP_TYPES.length} IP types × ${OAUTH_CONFIGS.length} OAuth configs × ${PUBLICATION_TYPES.length} publication types = ${IP_TYPES.length * OAUTH_CONFIGS.length * PUBLICATION_TYPES.length} configurations per scenario**`
    );
    lines.push("");
    lines.push("## Challenge Tier Thresholds");
    lines.push("");
    lines.push("| Score Range | Tier | Action |");
    lines.push("|-------------|------|--------|");
    lines.push("| 0.0 - 0.2 | Auto-accepted | No challenge required |");
    lines.push("| 0.2 - 0.8 | Challenge | CAPTCHA always required; OAuth may be needed based on score adjustment |");
    lines.push("| 0.8 - 1.0 | Auto-rejected | Publication automatically rejected |");
    lines.push("");
    lines.push("## Score Adjustment Model");
    lines.push("");
    lines.push("After evaluation, CAPTCHA is always the first challenge. The score is then adjusted:");
    lines.push("");
    const combinedMul = CAPTCHA_SCORE_MULTIPLIER * OAUTH_SCORE_MULTIPLIER;
    const crossover = CHALLENGE_PASS_THRESHOLD / CAPTCHA_SCORE_MULTIPLIER;
    lines.push(`| Stage | Multiplier | Formula | Pass if |`);
    lines.push(`|-------|------------|---------|---------|`);
    lines.push(`| After CAPTCHA | ×${CAPTCHA_SCORE_MULTIPLIER} | score × ${CAPTCHA_SCORE_MULTIPLIER} | < ${CHALLENGE_PASS_THRESHOLD} |`);
    lines.push(
        `| After CAPTCHA + OAuth | ×${combinedMul} | score × ${CAPTCHA_SCORE_MULTIPLIER} × ${OAUTH_SCORE_MULTIPLIER} | < ${CHALLENGE_PASS_THRESHOLD} |`
    );
    lines.push("");
    lines.push(`- **CAPTCHA alone sufficient** when raw score < ${formatScore(crossover)}`);
    lines.push(`- **CAPTCHA + OAuth sufficient** when raw score < ${formatScore(CHALLENGE_PASS_THRESHOLD / combinedMul)}`);
    lines.push(`- Scores ≥ 0.8 are auto-rejected regardless`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Process each scenario
    for (let scenarioIdx = 0; scenarioIdx < SCENARIOS.length; scenarioIdx++) {
        const scenario = SCENARIOS[scenarioIdx];

        lines.push(`## Scenario ${scenarioIdx + 1}: ${scenario.name}`);
        lines.push("");
        lines.push(scenario.description);
        lines.push("");

        // Add example publication
        lines.push(...generateExamplePublicationBlock(scenario));

        // Store results for all configurations
        const scenarioResults: Array<{
            pubType: PublicationType;
            ipType: IpType;
            oauthConfig: OAuthConfig;
            result: ScenarioResult;
        }> = [];

        // Run all configurations
        for (const pubType of PUBLICATION_TYPES) {
            const modifiedScenario = { ...scenario, publicationType: pubType };

            for (const ipType of IP_TYPES) {
                for (const oauthConfig of OAUTH_CONFIGS) {
                    const result = runScenario(modifiedScenario, ipType, oauthConfig);
                    scenarioResults.push({ pubType, ipType, oauthConfig, result });
                }
            }
        }

        // Get a sample result for the author profile table (use base config: no IP, OAuth disabled)
        const sampleResult = scenarioResults.find(
            (r) => r.pubType === scenario.publicationType && r.ipType === "disabled" && r.oauthConfig === "disabled"
        );

        // Add author profile table (with sample result to detect skipped factors)
        lines.push(...generateAuthorProfileTable(scenario, sampleResult?.result));

        // Generate results grouped by publication type
        lines.push("### Results by Configuration");
        lines.push("");

        lines.push(...generatePublicationTypeResults(scenario.publicationType, scenarioResults, scenario));

        // Add detailed factor breakdown for the base configuration
        const baseResult = scenarioResults.find(
            (r) => r.pubType === scenario.publicationType && r.ipType === "disabled" && r.oauthConfig === "disabled"
        );

        if (baseResult) {
            lines.push(
                ...generateFactorBreakdownTable(baseResult.result, scenario, baseResult.ipType, baseResult.oauthConfig, baseResult.pubType)
            );
        }

        lines.push("---");
        lines.push("");
    }

    // Summary table
    lines.push("## Summary");
    lines.push("");
    lines.push("Overview of risk score ranges and challenge outcomes for each scenario:");
    lines.push("");
    lines.push("| # | Scenario | Score Range | CAPTCHA Passes? | CAPTCHA+OAuth Passes? | Possible Outcomes |");
    lines.push("|---|----------|-------------|-----------------|----------------------|-------------------|");

    for (let scenarioIdx = 0; scenarioIdx < SCENARIOS.length; scenarioIdx++) {
        const scenario = SCENARIOS[scenarioIdx];

        let minScore = 1;
        let maxScore = 0;
        const outcomes = new Set<string>();
        let anyCaptchaSufficient = false;
        let allCaptchaSufficient = true;
        let anyCaptchaOAuthSufficient = false;
        let allCaptchaOAuthSufficient = true;

        for (const ipType of IP_TYPES) {
            for (const oauthConfig of OAUTH_CONFIGS) {
                const result = runScenario(scenario, ipType, oauthConfig);
                minScore = Math.min(minScore, result.riskScore);
                maxScore = Math.max(maxScore, result.riskScore);
                outcomes.add(getAdjustedOutcome(result));

                if (result.tier !== "auto_accept" && result.tier !== "auto_reject") {
                    if (result.captchaSufficient) anyCaptchaSufficient = true;
                    else allCaptchaSufficient = false;
                    if (result.captchaAndOAuthSufficient) anyCaptchaOAuthSufficient = true;
                    else allCaptchaOAuthSufficient = false;
                }
            }
        }

        const captchaStatus = allCaptchaSufficient ? "Always" : anyCaptchaSufficient ? "Sometimes" : "Never";
        const oauthStatus = allCaptchaOAuthSufficient ? "Always" : anyCaptchaOAuthSufficient ? "Sometimes" : "Never";
        const outcomeList = Array.from(outcomes).join(", ");
        lines.push(
            `| ${scenarioIdx + 1} | ${scenario.name} | ${formatScore(minScore)}–${formatScore(maxScore)} | ${captchaStatus} | ${oauthStatus} | ${outcomeList} |`
        );
    }

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("*This document is auto-generated. Run `npm run generate-scenarios` to regenerate.*");
    lines.push("");

    return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    console.log("Generating risk score scenarios...");
    console.log(
        `Processing ${SCENARIOS.length} scenarios x ${IP_TYPES.length * OAUTH_CONFIGS.length * PUBLICATION_TYPES.length} configurations each`
    );
    console.log(
        `Score adjustment: CAPTCHA ×${CAPTCHA_SCORE_MULTIPLIER}, OAuth ×${OAUTH_SCORE_MULTIPLIER}, threshold ${CHALLENGE_PASS_THRESHOLD}`
    );
    console.log("");

    const markdown = generateMarkdown();

    const outputPath = path.join(__dirname, "..", "src", "risk-score", "RISK_SCORE_SCENARIOS.md");
    fs.writeFileSync(outputPath, markdown, "utf-8");

    console.log(`Generated: ${outputPath}`);
    console.log("Done!");
}

main().catch((err) => {
    console.error("Error generating scenarios:", err);
    process.exit(1);
});
