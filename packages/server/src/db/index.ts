import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SCHEMA_SQL } from "./schema.js";

/** Challenge tier for tiered challenge selection */
export type ChallengeTierDb = "oauth_sufficient" | "oauth_plus_more";

export interface ChallengeSession {
    sessionId: string;
    /** Ed25519 public key of the subplebbit that created this session. Used to verify the same subplebbit completes the challenge. */
    subplebbitPublicKey: string | null;
    status: "pending" | "completed" | "failed";
    completedAt: number | null;
    expiresAt: number;
    receivedChallengeRequestAt: number;
    /** When the author accessed the iframe */
    authorAccessedIframeAt: number | null;
    /** OAuth identity in format "provider:userId" or JSON array for multiple (e.g., '["github:123","google:456"]') */
    oauthIdentity: string | null;
    /** Challenge tier for tiered challenge selection (null for auto_accept/auto_reject which don't need challenges) */
    challengeTier: ChallengeTierDb | null;
    /** Whether first OAuth is completed (session may still need more verification for oauth_plus_more tier) */
    oauthCompleted: number;
    /** Whether CAPTCHA portion is completed */
    captchaCompleted: number;
    /** The risk score at evaluation time (used for score adjustment after CAPTCHA/OAuth) */
    riskScore: number | null;
}

export interface IframeIpRecord {
    sessionId: string;
    ipAddress: string;
    isVpn: number | null;
    isProxy: number | null;
    isTor: number | null;
    isDatacenter: number | null;
    countryCode: string | null;
    /** When we queried the IP provider */
    timestamp: number;
}

export interface EvaluateCallerIp {
    sessionId: string;
    ipAddress: string;
    /** When the /evaluate endpoint was called */
    timestamp: number;
}

export type OAuthProviderName = "github" | "google" | "twitter" | "yandex" | "tiktok" | "discord" | "reddit";

export interface OAuthState {
    state: string;
    sessionId: string;
    provider: OAuthProviderName;
    /** PKCE code verifier (required for google, twitter) */
    codeVerifier: string | null;
    createdAt: number;
    expiresAt: number;
}

export interface DatabaseConfig {
    /** Path to the SQLite database file. Use ":memory:" for in-memory database. */
    path: string;
    /** Enable WAL mode for better concurrent read performance. Default: true */
    walMode?: boolean;
}

/**
 * Database wrapper for EasyCommunitySpamBlocker.
 * Provides methods for managing challenge sessions and IP records.
 */
export class SpamDetectionDatabase {
    private db: Database.Database;

    constructor(config: DatabaseConfig) {
        this.db = new Database(config.path);

        // Enable WAL mode by default for better performance
        if (config.walMode !== false) {
            this.db.pragma("journal_mode = WAL");
        }

        // Initialize schema
        this.db.exec(SCHEMA_SQL);

        // Register custom SQL functions
        this.registerCustomFunctions();
    }

    /**
     * Register custom SQL functions for use in queries.
     */
    private registerCustomFunctions(): void {
        // Jaccard similarity function for text comparison.
        // Returns a value between 0 (no similarity) and 1 (identical).
        // Uses word tokenization with words > 2 characters.
        //
        // TODO: This runs JS for every row scanned, which may not scale well
        // with millions of comments. If performance becomes an issue, consider:
        // - Pre-computed inverted word index table
        // - MinHash/LSH signatures
        // - External search engine (Meilisearch, OpenSearch)
        this.db.function("jaccard_similarity", (text1: unknown, text2: unknown): number => {
            if (typeof text1 !== "string" || typeof text2 !== "string") return 0;
            if (!text1 || !text2) return 0;

            // Normalize and tokenize: lowercase, remove punctuation, split on whitespace, keep words > 2 chars
            const normalize = (s: string): Set<string> =>
                new Set(
                    s
                        .toLowerCase()
                        .replace(/[^\w\s]/g, " ")
                        .split(/\s+/)
                        .filter((w) => w.length > 2)
                );

            const words1 = normalize(text1);
            const words2 = normalize(text2);

            if (words1.size === 0 || words2.size === 0) return 0;

            // Calculate Jaccard similarity: |intersection| / |union|
            let intersectionSize = 0;
            for (const word of words1) {
                if (words2.has(word)) intersectionSize++;
            }
            const unionSize = words1.size + words2.size - intersectionSize;

            return intersectionSize / unionSize;
        });
    }

    /**
     * Close the database connection.
     */
    close(): void {
        this.db.close();
    }

    /**
     * Get the underlying better-sqlite3 database instance.
     */
    getDb(): Database.Database {
        return this.db;
    }

    // ============================================
    // Challenge Session Methods
    // ============================================

    /**
     * Insert a new challenge session.
     */
    insertChallengeSession(params: {
        sessionId: string;
        /** Ed25519 public key of the subplebbit */
        subplebbitPublicKey: string;
        expiresAt: number;
        /** Challenge tier for tiered challenge selection */
        challengeTier?: ChallengeTierDb;
        /** The risk score at evaluation time */
        riskScore?: number;
    }): ChallengeSession {
        const stmt = this.db.prepare(`
      INSERT INTO challengeSessions (
        sessionId,
        subplebbitPublicKey,
        expiresAt,
        challengeTier,
        riskScore
      )
      VALUES (
        @sessionId,
        @subplebbitPublicKey,
        @expiresAt,
        @challengeTier,
        @riskScore
      )
    `);

        stmt.run({
            ...params,
            challengeTier: params.challengeTier ?? null,
            riskScore: params.riskScore ?? null
        });

        return this.getChallengeSessionBySessionId(params.sessionId)!;
    }

    /**
     * Get a challenge session by its session ID.
     */
    getChallengeSessionBySessionId(sessionId: string): ChallengeSession | undefined {
        const stmt = this.db.prepare(`
      SELECT * FROM challengeSessions WHERE sessionId = ?
    `);
        return stmt.get(sessionId) as ChallengeSession | undefined;
    }

    /**
     * Update the status of a challenge session.
     * @param oauthIdentity - Optional OAuth identity in format "provider:userId" (e.g., "github:12345678")
     */
    updateChallengeSessionStatus(
        sessionId: string,
        status: "pending" | "completed" | "failed",
        completedAt?: number,
        oauthIdentity?: string
    ): boolean {
        const stmt = this.db.prepare(`
      UPDATE challengeSessions
      SET status = @status, completedAt = @completedAt, oauthIdentity = COALESCE(@oauthIdentity, oauthIdentity)
      WHERE sessionId = @sessionId
    `);

        const result = stmt.run({
            sessionId,
            status,
            completedAt: completedAt ?? null,
            oauthIdentity: oauthIdentity ?? null
        });

        return result.changes > 0;
    }

    /**
     * Count how many times a specific OAuth identity has completed challenges.
     * Useful for detecting accounts that verify multiple times.
     *
     * @param oauthIdentity - OAuth identity in format "provider:userId"
     * @param sinceTimestamp - Only count completions after this timestamp (optional)
     */
    countOAuthIdentityCompletions(oauthIdentity: string, sinceTimestamp?: number): number {
        if (sinceTimestamp !== undefined) {
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM challengeSessions
                WHERE oauthIdentity = ? AND status = 'completed' AND completedAt >= ?
            `);
            const result = stmt.get(oauthIdentity, sinceTimestamp) as { count: number };
            return result.count;
        } else {
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM challengeSessions
                WHERE oauthIdentity = ?
            `);
            const result = stmt.get(oauthIdentity) as { count: number };
            return result.count;
        }
    }

    /**
     * Update when the author accessed the iframe.
     */
    updateChallengeSessionIframeAccess(sessionId: string, authorAccessedIframeAt: number): boolean {
        const stmt = this.db.prepare(`
      UPDATE challengeSessions
      SET authorAccessedIframeAt = @authorAccessedIframeAt
      WHERE sessionId = @sessionId
    `);

        const result = stmt.run({
            sessionId,
            authorAccessedIframeAt
        });

        return result.changes > 0;
    }

    /**
     * Mark first OAuth as completed for a session.
     * Does not mark the session as completed — for oauth_plus_more tier, additional verification is needed.
     */
    updateChallengeSessionOAuthCompleted(sessionId: string): boolean {
        const stmt = this.db.prepare(`
      UPDATE challengeSessions
      SET oauthCompleted = 1
      WHERE sessionId = @sessionId
    `);

        const result = stmt.run({ sessionId });

        return result.changes > 0;
    }

    /**
     * Mark CAPTCHA as completed for a session.
     * Does not mark the session as completed — used when CAPTCHA is a fallback or combined step.
     */
    updateChallengeSessionCaptchaCompleted(sessionId: string): boolean {
        const stmt = this.db.prepare(`
      UPDATE challengeSessions
      SET captchaCompleted = 1
      WHERE sessionId = @sessionId
    `);

        const result = stmt.run({ sessionId });

        return result.changes > 0;
    }

    /**
     * Get the author's public key for a challenge session by querying publication tables.
     * The author public key is stored in the signature.publicKey field of publications.
     *
     * @param sessionId - The challenge session ID
     * @returns The author's Ed25519 public key, or undefined if no publication found
     */
    getAuthorPublicKeyBySessionId(sessionId: string): string | undefined {
        // Try each publication table until we find a match
        const tables = ["comments", "votes", "commentEdits", "commentModerations"] as const;

        for (const table of tables) {
            const result = this.db
                .prepare(`SELECT json_extract(signature, '$.publicKey') as publicKey FROM ${table} WHERE sessionId = ? LIMIT 1`)
                .get(sessionId) as { publicKey: string } | undefined;

            if (result?.publicKey) {
                return result.publicKey;
            }
        }

        return undefined;
    }

    // ============================================
    // Iframe IP Record Methods
    // ============================================

    /**
     * Insert an iframe IP record for a challenge (when user accesses the iframe).
     */
    insertIframeIpRecord(params: {
        sessionId: string;
        ipAddress: string;
        isVpn?: boolean;
        isProxy?: boolean;
        isTor?: boolean;
        isDatacenter?: boolean;
        countryCode?: string;
        timestamp: number;
    }): IframeIpRecord {
        const stmt = this.db.prepare(`
      INSERT INTO iframeIpRecords (sessionId, ipAddress, isVpn, isProxy, isTor, isDatacenter, countryCode, timestamp)
      VALUES (@sessionId, @ipAddress, @isVpn, @isProxy, @isTor, @isDatacenter, @countryCode, @timestamp)
    `);

        stmt.run({
            sessionId: params.sessionId,
            ipAddress: params.ipAddress,
            isVpn: params.isVpn !== undefined ? (params.isVpn ? 1 : 0) : null,
            isProxy: params.isProxy !== undefined ? (params.isProxy ? 1 : 0) : null,
            isTor: params.isTor !== undefined ? (params.isTor ? 1 : 0) : null,
            isDatacenter: params.isDatacenter !== undefined ? (params.isDatacenter ? 1 : 0) : null,
            countryCode: params.countryCode ?? null,
            timestamp: params.timestamp
        });

        return this.getIframeIpRecordBySessionId(params.sessionId)!;
    }

    /**
     * Get an iframe IP record by session ID.
     */
    getIframeIpRecordBySessionId(sessionId: string): IframeIpRecord | undefined {
        const stmt = this.db.prepare(`
      SELECT * FROM iframeIpRecords WHERE sessionId = ?
    `);
        return stmt.get(sessionId) as IframeIpRecord | undefined;
    }

    /**
     * Update IP intelligence data for an existing iframe IP record.
     */
    updateIframeIpRecordIntelligence(
        sessionId: string,
        params: {
            isVpn?: boolean;
            isProxy?: boolean;
            isTor?: boolean;
            isDatacenter?: boolean;
            countryCode?: string;
            timestamp: number;
        }
    ): boolean {
        const stmt = this.db.prepare(`
      UPDATE iframeIpRecords SET
        isVpn = COALESCE(@isVpn, isVpn),
        isProxy = COALESCE(@isProxy, isProxy),
        isTor = COALESCE(@isTor, isTor),
        isDatacenter = COALESCE(@isDatacenter, isDatacenter),
        countryCode = COALESCE(@countryCode, countryCode),
        timestamp = @timestamp
      WHERE sessionId = @sessionId
    `);

        const result = stmt.run({
            sessionId,
            isVpn: params.isVpn !== undefined ? (params.isVpn ? 1 : 0) : null,
            isProxy: params.isProxy !== undefined ? (params.isProxy ? 1 : 0) : null,
            isTor: params.isTor !== undefined ? (params.isTor ? 1 : 0) : null,
            isDatacenter: params.isDatacenter !== undefined ? (params.isDatacenter ? 1 : 0) : null,
            countryCode: params.countryCode ?? null,
            timestamp: params.timestamp
        });

        return result.changes > 0;
    }

    // ============================================
    // Evaluate Caller IP Methods
    // ============================================

    /**
     * Insert an evaluate caller IP record (when subplebbit server calls /evaluate).
     */
    insertEvaluateCallerIp(params: { sessionId: string; ipAddress: string; timestamp: number }): EvaluateCallerIp {
        const stmt = this.db.prepare(`
      INSERT INTO evaluateCallerIps (sessionId, ipAddress, timestamp)
      VALUES (@sessionId, @ipAddress, @timestamp)
    `);

        stmt.run(params);

        return this.getEvaluateCallerIpBySessionId(params.sessionId)!;
    }

    /**
     * Get an evaluate caller IP record by session ID.
     */
    getEvaluateCallerIpBySessionId(sessionId: string): EvaluateCallerIp | undefined {
        const stmt = this.db.prepare(`
      SELECT * FROM evaluateCallerIps WHERE sessionId = ?
    `);
        return stmt.get(sessionId) as EvaluateCallerIp | undefined;
    }

    /**
     * Get all evaluate caller IP records for a given IP address.
     * Useful for rate limiting and detecting abuse patterns.
     */
    getEvaluateCallerIpsByAddress(ipAddress: string): EvaluateCallerIp[] {
        const stmt = this.db.prepare(`
      SELECT * FROM evaluateCallerIps WHERE ipAddress = ? ORDER BY timestamp DESC
    `);
        return stmt.all(ipAddress) as EvaluateCallerIp[];
    }

    // ============================================
    // Author Velocity Query Methods (by public key)
    // ============================================

    /**
     * Count publications by author's public key for a specific publication type within a time window.
     * The signature column stores JSON with the author's Ed25519 public key.
     *
     * Note: We use signature.publicKey instead of author.address because
     * author.address can be a domain name and is not cryptographically
     * tied to the author's identity.
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     * @param publicationType - The type of publication to count
     * @param sinceTimestamp - Only count publications after this timestamp
     */
    countPublicationsByAuthorPublicKey(
        authorPublicKey: string,
        publicationType: "post" | "reply" | "vote" | "commentEdit" | "commentModeration",
        sinceTimestamp: number
    ): number {
        let count = 0;

        if (publicationType === "post") {
            // Posts are comments without parentCid
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM comments
                    WHERE json_extract(signature, '$.publicKey') = ? AND parentCid IS NULL AND receivedAt >= ?`
                )
                .get(authorPublicKey, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "reply") {
            // Replies are comments with parentCid
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM comments
                    WHERE json_extract(signature, '$.publicKey') = ? AND parentCid IS NOT NULL AND receivedAt >= ?`
                )
                .get(authorPublicKey, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "vote") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM votes
                    WHERE json_extract(signature, '$.publicKey') = ? AND receivedAt >= ?`
                )
                .get(authorPublicKey, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "commentEdit") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM commentEdits
                    WHERE json_extract(signature, '$.publicKey') = ? AND receivedAt >= ?`
                )
                .get(authorPublicKey, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "commentModeration") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM commentModerations
                    WHERE json_extract(signature, '$.publicKey') = ? AND receivedAt >= ?`
                )
                .get(authorPublicKey, sinceTimestamp) as { count: number };
            count = result.count;
        }

        return count;
    }

    /**
     * Get author velocity stats for a specific publication type.
     * Returns publication counts in the last hour and last 24 hours.
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     * @param publicationType - The type of publication to count
     */
    getAuthorVelocityStats(
        authorPublicKey: string,
        publicationType: "post" | "reply" | "vote" | "commentEdit" | "commentModeration"
    ): { lastHour: number; last24Hours: number } {
        const now = Date.now();
        const oneHourAgo = now - 3600 * 1000;
        const oneDayAgo = now - 86400 * 1000;

        return {
            lastHour: this.countPublicationsByAuthorPublicKey(authorPublicKey, publicationType, oneHourAgo),
            last24Hours: this.countPublicationsByAuthorPublicKey(authorPublicKey, publicationType, oneDayAgo)
        };
    }

    /**
     * Get aggregate author velocity stats across ALL publication types.
     * Returns total publication counts in the last hour and last 24 hours.
     *
     * This is used to detect overall activity bursts regardless of publication type.
     * For example, an author with normal per-type velocity but high aggregate velocity
     * (e.g., 5 posts + 10 replies + 80 votes = 95 total/hour) may still be a spammer.
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     */
    getAuthorAggregateVelocityStats(authorPublicKey: string): { lastHour: number; last24Hours: number } {
        const types: Array<"post" | "reply" | "vote" | "commentEdit" | "commentModeration"> = [
            "post",
            "reply",
            "vote",
            "commentEdit",
            "commentModeration"
        ];

        let lastHour = 0;
        let last24Hours = 0;

        for (const type of types) {
            const stats = this.getAuthorVelocityStats(authorPublicKey, type);
            lastHour += stats.lastHour;
            last24Hours += stats.last24Hours;
        }

        return { lastHour, last24Hours };
    }

    // ============================================
    // Duplicate Publication Check Methods
    // ============================================

    /**
     * Check if a publication with the given signature already exists.
     * Used to prevent replay attacks where the same publication is submitted multiple times.
     *
     * @param signatureValue - The cryptographic signature from publication.signature.signature
     * @returns true if the signature exists in any publication table
     */
    publicationSignatureExists(signatureValue: string): boolean {
        const tables = ["comments", "votes", "commentEdits", "commentModerations"] as const;
        for (const table of tables) {
            const result = this.db
                .prepare(`SELECT 1 FROM ${table} WHERE json_extract(signature, '$.signature') = ? LIMIT 1`)
                .get(signatureValue);
            if (result) return true;
        }
        return false;
    }

    // ============================================
    // Publication Insertion Methods
    // ============================================

    /**
     * Insert a comment publication.
     */
    insertComment(params: {
        sessionId: string;
        publication: {
            author: unknown;
            subplebbitAddress: string;
            parentCid?: string;
            content?: string;
            link?: string;
            linkWidth?: number;
            linkHeight?: number;
            postCid?: string;
            signature: unknown;
            title?: string;
            timestamp: number;
            linkHtmlTagName?: string;
            flair?: unknown;
            spoiler?: boolean;
            protocolVersion: string;
            nsfw?: boolean;
        };
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO comments (
                sessionId, author, subplebbitAddress, parentCid, content, link,
                linkWidth, linkHeight, postCid, signature, title, timestamp,
                linkHtmlTagName, flair, spoiler, protocolVersion, nsfw
            ) VALUES (
                @sessionId, @author, @subplebbitAddress, @parentCid, @content, @link,
                @linkWidth, @linkHeight, @postCid, @signature, @title, @timestamp,
                @linkHtmlTagName, @flair, @spoiler, @protocolVersion, @nsfw
            )
        `);

        stmt.run({
            sessionId: params.sessionId,
            author: JSON.stringify(params.publication.author),
            subplebbitAddress: params.publication.subplebbitAddress,
            parentCid: params.publication.parentCid ?? null,
            content: params.publication.content ?? null,
            link: params.publication.link ?? null,
            linkWidth: params.publication.linkWidth ?? null,
            linkHeight: params.publication.linkHeight ?? null,
            postCid: params.publication.postCid ?? null,
            signature: JSON.stringify(params.publication.signature),
            title: params.publication.title ?? null,
            timestamp: params.publication.timestamp,
            linkHtmlTagName: params.publication.linkHtmlTagName ?? null,
            flair: params.publication.flair ? JSON.stringify(params.publication.flair) : null,
            spoiler: params.publication.spoiler !== undefined ? (params.publication.spoiler ? 1 : 0) : null,
            protocolVersion: params.publication.protocolVersion,
            nsfw: params.publication.nsfw !== undefined ? (params.publication.nsfw ? 1 : 0) : null
        });
    }

    /**
     * Insert a vote publication.
     */
    insertVote(params: {
        sessionId: string;
        publication: {
            author: unknown;
            subplebbitAddress: string;
            commentCid: string;
            signature: unknown;
            protocolVersion: string;
            vote: number;
            timestamp: number;
        };
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO votes (
                sessionId, author, subplebbitAddress, commentCid, signature,
                protocolVersion, vote, timestamp
            ) VALUES (
                @sessionId, @author, @subplebbitAddress, @commentCid, @signature,
                @protocolVersion, @vote, @timestamp
            )
        `);

        stmt.run({
            sessionId: params.sessionId,
            author: JSON.stringify(params.publication.author),
            subplebbitAddress: params.publication.subplebbitAddress,
            commentCid: params.publication.commentCid,
            signature: JSON.stringify(params.publication.signature),
            protocolVersion: params.publication.protocolVersion,
            vote: params.publication.vote,
            timestamp: params.publication.timestamp
        });
    }

    /**
     * Insert a comment edit publication.
     */
    insertCommentEdit(params: {
        sessionId: string;
        publication: {
            author: unknown;
            subplebbitAddress: string;
            commentCid: string;
            signature: unknown;
            protocolVersion: string;
            content?: string;
            reason?: string;
            deleted?: boolean;
            flair?: unknown;
            spoiler?: boolean;
            nsfw?: boolean;
            timestamp: number;
        };
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO commentEdits (
                sessionId, author, subplebbitAddress, commentCid, signature,
                protocolVersion, content, reason, deleted, flair, spoiler, nsfw, timestamp
            ) VALUES (
                @sessionId, @author, @subplebbitAddress, @commentCid, @signature,
                @protocolVersion, @content, @reason, @deleted, @flair, @spoiler, @nsfw, @timestamp
            )
        `);

        stmt.run({
            sessionId: params.sessionId,
            author: JSON.stringify(params.publication.author),
            subplebbitAddress: params.publication.subplebbitAddress,
            commentCid: params.publication.commentCid,
            signature: JSON.stringify(params.publication.signature),
            protocolVersion: params.publication.protocolVersion,
            content: params.publication.content ?? null,
            reason: params.publication.reason ?? null,
            deleted: params.publication.deleted !== undefined ? (params.publication.deleted ? 1 : 0) : null,
            flair: params.publication.flair ? JSON.stringify(params.publication.flair) : null,
            spoiler: params.publication.spoiler !== undefined ? (params.publication.spoiler ? 1 : 0) : null,
            nsfw: params.publication.nsfw !== undefined ? (params.publication.nsfw ? 1 : 0) : null,
            timestamp: params.publication.timestamp
        });
    }

    /**
     * Insert a comment moderation publication.
     */
    insertCommentModeration(params: {
        sessionId: string;
        publication: {
            author: unknown;
            subplebbitAddress: string;
            commentCid: string;
            commentModeration?: unknown;
            signature: unknown;
            protocolVersion?: string;
            timestamp: number;
        };
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO commentModerations (
                sessionId, author, subplebbitAddress, commentCid, commentModeration,
                signature, protocolVersion, timestamp
            ) VALUES (
                @sessionId, @author, @subplebbitAddress, @commentCid, @commentModeration,
                @signature, @protocolVersion, @timestamp
            )
        `);

        stmt.run({
            sessionId: params.sessionId,
            author: JSON.stringify(params.publication.author),
            subplebbitAddress: params.publication.subplebbitAddress,
            commentCid: params.publication.commentCid,
            commentModeration: params.publication.commentModeration ? JSON.stringify(params.publication.commentModeration) : null,
            signature: JSON.stringify(params.publication.signature),
            protocolVersion: params.publication.protocolVersion ?? null,
            timestamp: params.publication.timestamp
        });
    }

    // ============================================
    // Wallet Velocity Query Methods
    // ============================================

    /**
     * Count publications by wallet address for a specific publication type within a time window.
     * Searches for wallet addresses in author.wallets.
     */
    countPublicationsByWallet(
        walletAddress: string,
        publicationType: "post" | "reply" | "vote" | "commentEdit" | "commentModeration",
        sinceTimestamp: number
    ): number {
        // Normalize wallet address to lowercase for case-insensitive comparison
        const normalizedWallet = walletAddress.toLowerCase();

        // Build the wallet matching condition
        // Matches if any wallet in author.wallets.*.address matches
        const walletCondition = `(
            EXISTS (
                SELECT 1 FROM json_each(json_extract(author, '$.wallets'))
                WHERE LOWER(json_extract(value, '$.address')) = ?
            )
        )`;

        let count = 0;

        if (publicationType === "post") {
            // Posts are comments without parentCid
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM comments
                    WHERE ${walletCondition} AND parentCid IS NULL AND receivedAt >= ?`
                )
                .get(normalizedWallet, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "reply") {
            // Replies are comments with parentCid
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM comments
                    WHERE ${walletCondition} AND parentCid IS NOT NULL AND receivedAt >= ?`
                )
                .get(normalizedWallet, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "vote") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM votes
                    WHERE ${walletCondition} AND receivedAt >= ?`
                )
                .get(normalizedWallet, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "commentEdit") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM commentEdits
                    WHERE ${walletCondition} AND receivedAt >= ?`
                )
                .get(normalizedWallet, sinceTimestamp) as { count: number };
            count = result.count;
        } else if (publicationType === "commentModeration") {
            const result = this.db
                .prepare(
                    `SELECT COUNT(*) as count FROM commentModerations
                    WHERE ${walletCondition} AND receivedAt >= ?`
                )
                .get(normalizedWallet, sinceTimestamp) as { count: number };
            count = result.count;
        }

        return count;
    }

    /**
     * Get wallet velocity stats for a specific publication type.
     * Returns publication counts in the last hour and last 24 hours.
     */
    getWalletVelocityStats(
        walletAddress: string,
        publicationType: "post" | "reply" | "vote" | "commentEdit" | "commentModeration"
    ): { lastHour: number; last24Hours: number } {
        const now = Date.now();
        const oneHourAgo = now - 3600 * 1000;
        const oneDayAgo = now - 86400 * 1000;

        return {
            lastHour: this.countPublicationsByWallet(walletAddress, publicationType, oneHourAgo),
            last24Hours: this.countPublicationsByWallet(walletAddress, publicationType, oneDayAgo)
        };
    }

    // ============================================
    // Wallet-Author Exclusivity Methods
    // ============================================

    /**
     * Check if a wallet address is used by any author with a different public key.
     * Enforces strict 1-to-1 mapping between wallets and author public keys.
     * Uses EXISTS + LIMIT 1 for efficiency — stops as soon as one match is found.
     *
     * @param walletAddress - The wallet address to check (case-insensitive)
     * @param authorPublicKey - The current author's public key to exclude
     * @returns true if any publication exists with a different publicKey using this wallet
     */
    isWalletUsedByOtherAuthor({ walletAddress, authorPublicKey }: { walletAddress: string; authorPublicKey: string }): boolean {
        const normalizedWallet = walletAddress.toLowerCase();

        const walletCondition = `EXISTS (
            SELECT 1 FROM json_each(json_extract(author, '$.wallets'))
            WHERE LOWER(json_extract(value, '$.address')) = @wallet
        )`;

        const otherAuthorCondition = `json_extract(signature, '$.publicKey') != @authorPublicKey`;

        const tables = ["comments", "votes", "commentEdits", "commentModerations"] as const;

        for (const table of tables) {
            const result = this.db
                .prepare(`SELECT 1 FROM ${table} WHERE ${walletCondition} AND ${otherAuthorCondition} LIMIT 1`)
                .get({ wallet: normalizedWallet, authorPublicKey });

            if (result) return true;
        }

        return false;
    }

    // ============================================
    // Karma Query Methods (by public key)
    // ============================================

    /**
     * Get the latest karma (postScore + replyScore) per subplebbit for an author.
     * Only counts the most recent karma from each subplebbit to avoid summing duplicates.
     * Returns a map of subplebbitAddress -> { postScore, replyScore, receivedAt }
     *
     * @param authorPublicKey - The Ed25519 public   key from the publication's signature
     */
    getAuthorKarmaBySubplebbit(authorPublicKey: string): Map<string, { postScore: number; replyScore: number; receivedAt: number }> {
        const karmaMap = new Map<string, { postScore: number; replyScore: number; receivedAt: number }>();

        // Helper to update karma map with newer data only
        const updateKarmaMap = (subplebbitAddress: string, postScore: number, replyScore: number, receivedAt: number) => {
            const existing = karmaMap.get(subplebbitAddress);
            if (!existing || receivedAt > existing.receivedAt) {
                karmaMap.set(subplebbitAddress, { postScore, replyScore, receivedAt });
            }
        };

        // Query comments for karma data
        const commentRows = this.db
            .prepare(
                `SELECT
                    subplebbitAddress,
                    COALESCE(json_extract(author, '$.subplebbit.postScore'), 0) as postScore,
                    COALESCE(json_extract(author, '$.subplebbit.replyScore'), 0) as replyScore,
                    receivedAt
                 FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?
                 ORDER BY receivedAt DESC`
            )
            .all(authorPublicKey) as Array<{ subplebbitAddress: string; postScore: number; replyScore: number; receivedAt: number }>;

        for (const row of commentRows) {
            updateKarmaMap(row.subplebbitAddress, row.postScore, row.replyScore, row.receivedAt);
        }

        // Query votes for karma data
        const voteRows = this.db
            .prepare(
                `SELECT
                    subplebbitAddress,
                    COALESCE(json_extract(author, '$.subplebbit.postScore'), 0) as postScore,
                    COALESCE(json_extract(author, '$.subplebbit.replyScore'), 0) as replyScore,
                    receivedAt
                 FROM votes
                 WHERE json_extract(signature, '$.publicKey') = ?
                 ORDER BY receivedAt DESC`
            )
            .all(authorPublicKey) as Array<{ subplebbitAddress: string; postScore: number; replyScore: number; receivedAt: number }>;

        for (const row of voteRows) {
            updateKarmaMap(row.subplebbitAddress, row.postScore, row.replyScore, row.receivedAt);
        }

        // Query comment edits for karma data
        const editRows = this.db
            .prepare(
                `SELECT
                    subplebbitAddress,
                    COALESCE(json_extract(author, '$.subplebbit.postScore'), 0) as postScore,
                    COALESCE(json_extract(author, '$.subplebbit.replyScore'), 0) as replyScore,
                    receivedAt
                 FROM commentEdits
                 WHERE json_extract(signature, '$.publicKey') = ?
                 ORDER BY receivedAt DESC`
            )
            .all(authorPublicKey) as Array<{ subplebbitAddress: string; postScore: number; replyScore: number; receivedAt: number }>;

        for (const row of editRows) {
            updateKarmaMap(row.subplebbitAddress, row.postScore, row.replyScore, row.receivedAt);
        }

        // Query comment moderations for karma data
        const moderationRows = this.db
            .prepare(
                `SELECT
                    subplebbitAddress,
                    COALESCE(json_extract(author, '$.subplebbit.postScore'), 0) as postScore,
                    COALESCE(json_extract(author, '$.subplebbit.replyScore'), 0) as replyScore,
                    receivedAt
                 FROM commentModerations
                 WHERE json_extract(signature, '$.publicKey') = ?
                 ORDER BY receivedAt DESC`
            )
            .all(authorPublicKey) as Array<{ subplebbitAddress: string; postScore: number; replyScore: number; receivedAt: number }>;

        for (const row of moderationRows) {
            updateKarmaMap(row.subplebbitAddress, row.postScore, row.replyScore, row.receivedAt);
        }

        return karmaMap;
    }

    /**
     * Get the total aggregated karma for an author across all subplebbits in our database.
     * Only counts the latest karma from each subplebbit to avoid summing duplicates.
     * Returns { totalPostScore, totalReplyScore, subplebbitCount }
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     */
    getAuthorAggregatedKarma(authorPublicKey: string): { totalPostScore: number; totalReplyScore: number; subplebbitCount: number } {
        const karmaMap = this.getAuthorKarmaBySubplebbit(authorPublicKey);

        let totalPostScore = 0;
        let totalReplyScore = 0;

        for (const karma of karmaMap.values()) {
            totalPostScore += karma.postScore;
            totalReplyScore += karma.replyScore;
        }

        return {
            totalPostScore,
            totalReplyScore,
            subplebbitCount: karmaMap.size
        };
    }

    // ============================================
    // Similar Content Query Methods
    // ============================================

    /**
     * Find comments with similar or identical content and/or title.
     * Used for detecting duplicate/spam content.
     *
     * @param params.content - The content to search for similarity
     * @param params.title - The title to search for similarity
     * @param params.excludeChallengeId - Challenge ID to exclude from results (current publication)
     * @param params.sinceTimestamp - Only search comments after this timestamp
     * @param params.limit - Maximum number of results to return
     * @returns Array of similar comments with their content/title and author public key
     */
    findSimilarComments(params: {
        content?: string;
        title?: string;
        excludeChallengeId?: string;
        sinceTimestamp?: number;
        limit?: number;
    }): Array<{
        sessionId: string;
        authorPublicKey: string;
        content: string | null;
        title: string | null;
        subplebbitAddress: string;
        receivedAt: number;
    }> {
        const { content, title, excludeChallengeId, sinceTimestamp, limit = 50 } = params;

        // Build query conditions
        const conditions: string[] = [];
        const queryParams: Record<string, unknown> = {};

        if (excludeChallengeId) {
            conditions.push("sessionId != @excludeChallengeId");
            queryParams.excludeChallengeId = excludeChallengeId;
        }

        if (sinceTimestamp) {
            conditions.push("receivedAt >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        // Build content/title matching conditions
        const contentConditions: string[] = [];

        if (content && content.trim().length > 0) {
            // Exact match or very similar (normalized whitespace, case-insensitive)
            contentConditions.push("LOWER(TRIM(content)) = LOWER(TRIM(@content))");
            queryParams.content = content;
        }

        if (title && title.trim().length > 0) {
            // Exact match on title (normalized)
            contentConditions.push("LOWER(TRIM(title)) = LOWER(TRIM(@title))");
            queryParams.title = title;
        }

        if (contentConditions.length === 0) {
            return [];
        }

        // We want comments that match content OR title
        conditions.push(`(${contentConditions.join(" OR ")})`);

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const query = `
            SELECT
                sessionId,
                json_extract(signature, '$.publicKey') as authorPublicKey,
                content,
                title,
                subplebbitAddress,
                receivedAt
            FROM comments
            ${whereClause}
            ORDER BY receivedAt DESC
            LIMIT @limit
        `;

        queryParams.limit = limit;

        return this.db.prepare(query).all(queryParams) as Array<{
            sessionId: string;
            authorPublicKey: string;
            content: string | null;
            title: string | null;
            subplebbitAddress: string;
            receivedAt: number;
        }>;
    }

    /**
     * Find similar comments by content or title from the same author.
     * Uses Jaccard similarity (word overlap) to find similar content.
     *
     * Returns comments with their similarity scores. The caller should
     * filter by the desired threshold (e.g., 0.6 for 60% similarity).
     *
     * Used to detect self-spamming with slight variations.
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature
     */
    findSimilarContentByAuthor(params: {
        authorPublicKey: string;
        content?: string;
        title?: string;
        sinceTimestamp?: number;
        similarityThreshold?: number;
        limit?: number;
    }): Array<{
        sessionId: string;
        content: string | null;
        title: string | null;
        subplebbitAddress: string;
        receivedAt: number;
        contentSimilarity: number;
        titleSimilarity: number;
    }> {
        const { authorPublicKey, content, title, sinceTimestamp, similarityThreshold = 0.6, limit = 100 } = params;

        const conditions: string[] = ["json_extract(signature, '$.publicKey') = @authorPublicKey"];
        // Always include content and title params (even if null) since they're used in SELECT clause
        const queryParams: Record<string, unknown> = {
            authorPublicKey,
            limit,
            similarityThreshold,
            content: content || null,
            title: title || null
        };

        if (sinceTimestamp) {
            conditions.push("receivedAt >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        // Need at least content or title to search
        if ((!content || content.trim().length <= 10) && (!title || title.trim().length <= 5)) {
            return [];
        }

        // Build similarity conditions - match if either content OR title is similar
        const similarityConditions: string[] = [];

        if (content && content.trim().length > 10) {
            similarityConditions.push("jaccard_similarity(content, @content) >= @similarityThreshold");
        }

        if (title && title.trim().length > 5) {
            similarityConditions.push("jaccard_similarity(title, @title) >= @similarityThreshold");
        }

        conditions.push(`(${similarityConditions.join(" OR ")})`);

        const query = `
            SELECT
                sessionId,
                content,
                title,
                subplebbitAddress,
                receivedAt,
                jaccard_similarity(content, @content) as contentSimilarity,
                jaccard_similarity(title, @title) as titleSimilarity
            FROM comments
            WHERE ${conditions.join(" AND ")}
            ORDER BY receivedAt DESC
            LIMIT @limit
        `;

        return this.db.prepare(query).all(queryParams) as Array<{
            sessionId: string;
            content: string | null;
            title: string | null;
            subplebbitAddress: string;
            receivedAt: number;
            contentSimilarity: number;
            titleSimilarity: number;
        }>;
    }

    /**
     * Find similar comments by content or title from different authors.
     * Uses Jaccard similarity (word overlap) to find similar content.
     *
     * Returns comments with their similarity scores. The caller should
     * filter by the desired threshold (e.g., 0.6 for 60% similarity).
     *
     * Used to detect coordinated spam campaigns.
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature (to exclude)
     */
    findSimilarContentByOthers(params: {
        authorPublicKey: string;
        content?: string;
        title?: string;
        sinceTimestamp?: number;
        similarityThreshold?: number;
        limit?: number;
    }): Array<{
        sessionId: string;
        authorPublicKey: string;
        content: string | null;
        title: string | null;
        subplebbitAddress: string;
        receivedAt: number;
        contentSimilarity: number;
        titleSimilarity: number;
    }> {
        const { authorPublicKey, content, title, sinceTimestamp, similarityThreshold = 0.6, limit = 100 } = params;

        const conditions: string[] = ["json_extract(signature, '$.publicKey') != @authorPublicKey"];
        // Always include content and title params (even if null) since they're used in SELECT clause
        const queryParams: Record<string, unknown> = {
            authorPublicKey,
            limit,
            similarityThreshold,
            content: content || null,
            title: title || null
        };

        if (sinceTimestamp) {
            conditions.push("receivedAt >= @sinceTimestamp");
            queryParams.sinceTimestamp = sinceTimestamp;
        }

        // Need at least content or title to search
        if ((!content || content.trim().length <= 10) && (!title || title.trim().length <= 5)) {
            return [];
        }

        // Build similarity conditions - match if either content OR title is similar
        const similarityConditions: string[] = [];

        if (content && content.trim().length > 10) {
            similarityConditions.push("jaccard_similarity(content, @content) >= @similarityThreshold");
        }

        if (title && title.trim().length > 5) {
            similarityConditions.push("jaccard_similarity(title, @title) >= @similarityThreshold");
        }

        conditions.push(`(${similarityConditions.join(" OR ")})`);

        const query = `
            SELECT
                sessionId,
                json_extract(signature, '$.publicKey') as authorPublicKey,
                content,
                title,
                subplebbitAddress,
                receivedAt,
                jaccard_similarity(content, @content) as contentSimilarity,
                jaccard_similarity(title, @title) as titleSimilarity
            FROM comments
            WHERE ${conditions.join(" AND ")}
            ORDER BY receivedAt DESC
            LIMIT @limit
        `;

        return this.db.prepare(query).all(queryParams) as Array<{
            sessionId: string;
            authorPublicKey: string;
            content: string | null;
            title: string | null;
            subplebbitAddress: string;
            receivedAt: number;
            contentSimilarity: number;
            titleSimilarity: number;
        }>;
    }

    /**
     * Get the earliest receivedAt timestamp for an author across all publication types.
     * This represents when we first saw this author in our own database.
     * Returns undefined if the author has no publications in our database.
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     */
    getAuthorFirstSeenTimestamp(authorPublicKey: string): number | undefined {
        // Query each publication type for the minimum receivedAt
        const commentMin = this.db
            .prepare(
                `SELECT MIN(receivedAt) as minTime FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { minTime: number | null };

        const voteMin = this.db
            .prepare(
                `SELECT MIN(receivedAt) as minTime FROM votes
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { minTime: number | null };

        const editMin = this.db
            .prepare(
                `SELECT MIN(receivedAt) as minTime FROM commentEdits
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { minTime: number | null };

        const moderationMin = this.db
            .prepare(
                `SELECT MIN(receivedAt) as minTime FROM commentModerations
                 WHERE json_extract(signature, '$.publicKey') = ?`
            )
            .get(authorPublicKey) as { minTime: number | null };

        // Collect all non-null timestamps
        const timestamps = [commentMin.minTime, voteMin.minTime, editMin.minTime, moderationMin.minTime].filter(
            (t): t is number => t !== null
        );

        if (timestamps.length === 0) {
            return undefined;
        }

        return Math.min(...timestamps);
    }

    // ============================================
    // Link/URL Query Methods (by public key)
    // ============================================

    /**
     * Count how many times a specific link has been posted by a given author.
     * Used to detect link spam from the same author.
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature
     * @param params.link - The normalized link URL to search for
     * @param params.sinceTimestamp - Only count links posted after this timestamp
     * @returns Number of times this link has been posted by this author
     */
    findLinksByAuthor(params: { authorPublicKey: string; link: string; sinceTimestamp?: number }): number {
        const { authorPublicKey, link, sinceTimestamp } = params;

        let query = `SELECT COUNT(*) as count FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?
                 AND link IS NOT NULL
                 AND LOWER(link) = LOWER(?)`;
        const queryParams: unknown[] = [authorPublicKey, link];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        const result = this.db.prepare(query).get(...queryParams) as { count: number };

        return result.count;
    }

    /**
     * Count how many times a specific link has been posted by other authors.
     * Used to detect coordinated link spam campaigns.
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature (excluded from results)
     * @param params.link - The normalized link URL to search for
     * @param params.sinceTimestamp - Only count links posted after this timestamp
     * @returns Object with count of posts and unique authors (by public key)
     */
    findLinksByOthers(params: { authorPublicKey: string; link: string; sinceTimestamp?: number }): {
        count: number;
        uniqueAuthors: number;
    } {
        const { authorPublicKey, link, sinceTimestamp } = params;

        let query = `SELECT
                    COUNT(*) as count,
                    COUNT(DISTINCT json_extract(signature, '$.publicKey')) as uniqueAuthors
                 FROM comments
                 WHERE json_extract(signature, '$.publicKey') != ?
                 AND link IS NOT NULL
                 AND LOWER(link) = LOWER(?)`;
        const queryParams: unknown[] = [authorPublicKey, link];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        const result = this.db.prepare(query).get(...queryParams) as { count: number; uniqueAuthors: number };

        return result;
    }

    // ============================================
    // Similar URL Detection Methods
    // ============================================

    /**
     * Find comments with similar URLs (matching prefix) from the same author.
     * Used to detect link spam with URL variations (e.g., same domain/path with different query params).
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature
     * @param params.urlPrefix - The URL prefix to match (e.g., "spam.com/promo/deal")
     * @param params.sinceTimestamp - Only count links posted after this timestamp (milliseconds)
     * @returns Number of comments with similar URLs from this author
     */
    findSimilarUrlsByAuthor(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number {
        const { authorPublicKey, urlPrefix, sinceTimestamp } = params;

        // Use LIKE to match URLs that start with the prefix pattern
        // We need to escape special LIKE characters in the prefix
        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        let query = `SELECT COUNT(*) as count FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?
                 AND link IS NOT NULL
                 AND LOWER(link) LIKE LOWER(?) ESCAPE '\\'`;
        const queryParams: unknown[] = [authorPublicKey, likePattern];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        const result = this.db.prepare(query).get(...queryParams) as { count: number };

        return result.count;
    }

    /**
     * Find comments with similar URLs (matching prefix) from other authors.
     * Used to detect coordinated link spam with URL variations.
     *
     * @param params.authorPublicKey - The Ed25519 public key to exclude
     * @param params.urlPrefix - The URL prefix to match
     * @param params.sinceTimestamp - Only count links posted after this timestamp (milliseconds)
     * @returns Object with count of posts and unique authors
     */
    findSimilarUrlsByOthers(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): {
        count: number;
        uniqueAuthors: number;
    } {
        const { authorPublicKey, urlPrefix, sinceTimestamp } = params;

        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        let query = `SELECT
                    COUNT(*) as count,
                    COUNT(DISTINCT json_extract(signature, '$.publicKey')) as uniqueAuthors
                 FROM comments
                 WHERE json_extract(signature, '$.publicKey') != ?
                 AND link IS NOT NULL
                 AND LOWER(link) LIKE LOWER(?) ESCAPE '\\'`;
        const queryParams: unknown[] = [authorPublicKey, likePattern];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        const result = this.db.prepare(query).get(...queryParams) as { count: number; uniqueAuthors: number };

        return result;
    }

    /**
     * Find similar URLs from the same author and return their publication timestamps.
     * Used for time clustering analysis to detect rapid-fire URL spam.
     *
     * @param params.authorPublicKey - The Ed25519 public key to match
     * @param params.urlPrefix - The URL prefix to match
     * @param params.sinceTimestamp - Only include posts after this timestamp (milliseconds)
     * @returns Array of publication timestamps (in seconds, from the protocol)
     */
    findSimilarUrlTimestampsByAuthor(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number[] {
        const { authorPublicKey, urlPrefix, sinceTimestamp } = params;

        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        let query = `SELECT timestamp
                 FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?
                 AND link IS NOT NULL
                 AND LOWER(link) LIKE LOWER(?) ESCAPE '\\'`;
        const queryParams: unknown[] = [authorPublicKey, likePattern];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        query += ` ORDER BY timestamp LIMIT 100`;

        const rows = this.db.prepare(query).all(...queryParams) as Array<{ timestamp: number }>;

        return rows.map((row) => row.timestamp);
    }

    /**
     * Find similar URLs from other authors and return their publication timestamps.
     * Used for time clustering analysis to detect coordinated spam campaigns.
     *
     * @param params.authorPublicKey - The Ed25519 public key to exclude
     * @param params.urlPrefix - The URL prefix to match
     * @param params.sinceTimestamp - Only include posts after this timestamp (milliseconds)
     * @returns Array of publication timestamps (in seconds, from the protocol)
     */
    findSimilarUrlTimestampsByOthers(params: { authorPublicKey: string; urlPrefix: string; sinceTimestamp?: number }): number[] {
        const { authorPublicKey, urlPrefix, sinceTimestamp } = params;

        const escapedPrefix = urlPrefix.replace(/[%_]/g, "\\$&");
        const likePattern = `%${escapedPrefix}%`;

        let query = `SELECT timestamp
                 FROM comments
                 WHERE json_extract(signature, '$.publicKey') != ?
                 AND link IS NOT NULL
                 AND LOWER(link) LIKE LOWER(?) ESCAPE '\\'`;
        const queryParams: unknown[] = [authorPublicKey, likePattern];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        query += ` ORDER BY timestamp LIMIT 100`;

        const rows = this.db.prepare(query).all(...queryParams) as Array<{ timestamp: number }>;

        return rows.map((row) => row.timestamp);
    }

    // ============================================
    // OAuth State Methods
    // ============================================

    /**
     * Insert a new OAuth state for CSRF protection.
     */
    insertOAuthState(params: {
        state: string;
        sessionId: string;
        provider: OAuthProviderName;
        codeVerifier?: string;
        createdAt: number;
        expiresAt: number;
    }): OAuthState {
        const stmt = this.db.prepare(`
            INSERT INTO oauthStates (state, sessionId, provider, codeVerifier, createdAt, expiresAt)
            VALUES (@state, @sessionId, @provider, @codeVerifier, @createdAt, @expiresAt)
        `);

        stmt.run({
            ...params,
            codeVerifier: params.codeVerifier ?? null
        });

        return { ...params, codeVerifier: params.codeVerifier ?? null } as OAuthState;
    }

    /**
     * Get an OAuth state by its state parameter.
     */
    getOAuthState(state: string): OAuthState | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM oauthStates WHERE state = ?
        `);
        return stmt.get(state) as OAuthState | undefined;
    }

    /**
     * Delete an OAuth state (after successful use or expiry).
     */
    deleteOAuthState(state: string): boolean {
        const stmt = this.db.prepare(`
            DELETE FROM oauthStates WHERE state = ?
        `);
        const result = stmt.run(state);
        return result.changes > 0;
    }

    /**
     * Clean up expired OAuth states.
     */
    cleanupExpiredOAuthStates(): number {
        const now = Date.now();
        const stmt = this.db.prepare(`
            DELETE FROM oauthStates WHERE expiresAt < ?
        `);
        const result = stmt.run(now);
        return result.changes;
    }

    // ============================================
    // Author OAuth Identity Methods
    // ============================================

    /**
     * Get all OAuth identities linked to an author (across all publication types).
     * Returns array of OAuth identities in format "provider:userId" (e.g., ["google:123", "github:456"]).
     *
     * This queries challenge sessions that have completed successfully and are linked
     * to publications by the author's public key.
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     * @returns Array of unique OAuth identity strings
     */
    getAuthorOAuthIdentities(authorPublicKey: string): string[] {
        // Query across all publication tables to find OAuth identities linked to this author
        const query = `
            SELECT DISTINCT cs.oauthIdentity
            FROM challengeSessions cs
            WHERE cs.oauthIdentity IS NOT NULL
              AND cs.status = 'completed'
              AND (
                EXISTS (SELECT 1 FROM comments c WHERE c.sessionId = cs.sessionId AND json_extract(c.signature, '$.publicKey') = @authorPublicKey)
                OR EXISTS (SELECT 1 FROM votes v WHERE v.sessionId = cs.sessionId AND json_extract(v.signature, '$.publicKey') = @authorPublicKey)
                OR EXISTS (SELECT 1 FROM commentEdits ce WHERE ce.sessionId = cs.sessionId AND json_extract(ce.signature, '$.publicKey') = @authorPublicKey)
                OR EXISTS (SELECT 1 FROM commentModerations cm WHERE cm.sessionId = cs.sessionId AND json_extract(cm.signature, '$.publicKey') = @authorPublicKey)
              )
        `;

        const rows = this.db.prepare(query).all({ authorPublicKey }) as Array<{ oauthIdentity: string }>;
        return rows.map((row) => row.oauthIdentity);
    }

    /**
     * Get the OAuth provider names that an author has previously used for verification.
     * Extracts provider names from the OAuth identities (format "provider:userId").
     *
     * @param authorPublicKey - The Ed25519 public key from the publication's signature
     * @returns Array of unique provider names (e.g., ["google", "github"])
     */
    getAuthorOAuthProviders(authorPublicKey: string): string[] {
        const identities = this.getAuthorOAuthIdentities(authorPublicKey);
        const providers = new Set<string>();
        for (const identity of identities) {
            const colonIndex = identity.indexOf(":");
            if (colonIndex > 0) {
                providers.add(identity.substring(0, colonIndex));
            }
        }
        return Array.from(providers);
    }

    /**
     * Count how many unique authors are linked to an OAuth identity.
     * Used to apply diminishing returns when same OAuth account is linked to multiple authors.
     *
     * @param oauthIdentity - OAuth identity in format "provider:userId"
     * @returns Number of unique author public keys linked to this OAuth identity
     */
    countAuthorsWithOAuthIdentity(oauthIdentity: string): number {
        // Query across all publication tables to count unique authors linked to this OAuth identity
        const query = `
            SELECT COUNT(DISTINCT authorPublicKey) as count FROM (
                SELECT json_extract(c.signature, '$.publicKey') as authorPublicKey
                FROM challengeSessions cs
                JOIN comments c ON c.sessionId = cs.sessionId
                WHERE cs.oauthIdentity = @oauthIdentity AND cs.status = 'completed'
                UNION
                SELECT json_extract(v.signature, '$.publicKey') as authorPublicKey
                FROM challengeSessions cs
                JOIN votes v ON v.sessionId = cs.sessionId
                WHERE cs.oauthIdentity = @oauthIdentity AND cs.status = 'completed'
                UNION
                SELECT json_extract(ce.signature, '$.publicKey') as authorPublicKey
                FROM challengeSessions cs
                JOIN commentEdits ce ON ce.sessionId = cs.sessionId
                WHERE cs.oauthIdentity = @oauthIdentity AND cs.status = 'completed'
                UNION
                SELECT json_extract(cm.signature, '$.publicKey') as authorPublicKey
                FROM challengeSessions cs
                JOIN commentModerations cm ON cm.sessionId = cs.sessionId
                WHERE cs.oauthIdentity = @oauthIdentity AND cs.status = 'completed'
            )
        `;

        const result = this.db.prepare(query).get({ oauthIdentity }) as { count: number };
        return result.count;
    }

    // ============================================
    // OAuth Account Age Methods
    // ============================================

    /**
     * Store the OAuth account creation date for a challenge session.
     *
     * @param sessionId - The challenge session ID
     * @param accountCreatedAt - OAuth account creation timestamp in Unix seconds
     */
    updateChallengeSessionOAuthAccountCreatedAt(sessionId: string, accountCreatedAt: number): boolean {
        const stmt = this.db.prepare(`
            UPDATE challengeSessions
            SET oauthAccountCreatedAt = @accountCreatedAt
            WHERE sessionId = @sessionId
        `);

        const result = stmt.run({ sessionId, accountCreatedAt });
        return result.changes > 0;
    }

    /**
     * Get the OAuth account creation date for a specific OAuth identity.
     * Retrieves from the most recent completed session that has this data.
     *
     * @param oauthIdentity - OAuth identity in format "provider:userId"
     * @returns OAuth account creation timestamp in Unix seconds, or null if not available
     */
    getOAuthAccountCreatedAt(oauthIdentity: string): number | null {
        const stmt = this.db.prepare(`
            SELECT oauthAccountCreatedAt
            FROM challengeSessions
            WHERE oauthIdentity = @oauthIdentity
              AND status = 'completed'
              AND oauthAccountCreatedAt IS NOT NULL
            ORDER BY completedAt DESC
            LIMIT 1
        `);

        const result = stmt.get({ oauthIdentity }) as { oauthAccountCreatedAt: number } | undefined;
        return result?.oauthAccountCreatedAt ?? null;
    }

    // ============================================
    // Link/URL Query Methods (by public key)
    // ============================================

    /**
     * Count how many links to a specific domain have been posted by a given author.
     * Used to detect domain-focused spam (posting many different pages from same domain).
     *
     * @param params.authorPublicKey - The Ed25519 public key from the publication's signature
     * @param params.domain - The domain to search for (e.g., "example.com")
     * @param params.sinceTimestamp - Only count links posted after this timestamp
     * @returns Number of links to this domain from this author
     */
    countLinkDomainByAuthor(params: { authorPublicKey: string; domain: string; sinceTimestamp?: number }): number {
        const { authorPublicKey, domain, sinceTimestamp } = params;

        // Match domain in link URL - handles both with and without www prefix
        // The link column stores URLs like "https://example.com/path"
        // We use LIKE to match the domain portion
        let query = `SELECT COUNT(*) as count FROM comments
                 WHERE json_extract(signature, '$.publicKey') = ?
                 AND link IS NOT NULL
                 AND (
                     LOWER(link) LIKE '%://' || LOWER(?) || '/%'
                     OR LOWER(link) LIKE '%://' || LOWER(?) || '?%'
                     OR LOWER(link) LIKE '%://' || LOWER(?) || '#%'
                     OR LOWER(link) LIKE '%://www.' || LOWER(?) || '/%'
                     OR LOWER(link) LIKE '%://www.' || LOWER(?) || '?%'
                     OR LOWER(link) LIKE '%://www.' || LOWER(?) || '#%'
                     OR LOWER(link) = '%://' || LOWER(?)
                     OR LOWER(link) = '%://www.' || LOWER(?)
                 )`;
        const queryParams: unknown[] = [authorPublicKey, domain, domain, domain, domain, domain, domain, domain, domain];

        if (sinceTimestamp !== undefined) {
            query += ` AND receivedAt >= ?`;
            queryParams.push(sinceTimestamp);
        }

        const result = this.db.prepare(query).get(...queryParams) as { count: number };

        return result.count;
    }
}

/**
 * Create a database instance.
 */
export function createDatabase(dbPath: string): SpamDetectionDatabase {
    // Create the parent directory if it doesn't exist (unless it's an in-memory database)
    if (dbPath !== ":memory:") {
        const dir = path.dirname(dbPath);
        if (dir && dir !== "." && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    return new SpamDetectionDatabase({ path: dbPath });
}

export { SCHEMA_SQL } from "./schema.js";
