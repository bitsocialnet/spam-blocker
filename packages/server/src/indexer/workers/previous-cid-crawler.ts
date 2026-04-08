/**
 * Worker for crawling author.previousCommentCid chains.
 * Discovers new communities and validates author history.
 */

import type { Database } from "better-sqlite3";
import { getCommunityAddressFromRecord } from "@pkcprotocol/pkc-js/dist/node/publications/publication-community.js";
import { IndexerQueries } from "../db/queries.js";
import { storeRawComment } from "./comment-fetcher.js";
import { DEFAULT_INDEXER_CONFIG } from "../types.js";
import type { PkcInstance } from "../pkc-manager.js";

// Derive Comment type from PKC instance method
type Comment = Awaited<ReturnType<PkcInstance["createComment"]>>;

/**
 * Result of crawling a previous comment CID.
 */
interface CrawlResult {
    /** Whether the crawl was successful */
    success: boolean;
    /** The CID that was crawled */
    cid: string;
    /** The community address (if found) */
    communityAddress?: string;
    /** The next previousCommentCid to crawl (if any) */
    nextPreviousCid?: string;
    /** Whether the CommentUpdate was available */
    hasCommentUpdate: boolean;
    /** Error message if crawl failed */
    error?: string;
}

/**
 * Crawls author.previousCommentCid chains to discover new communities
 * and validate author history.
 */
export class PreviousCidCrawler {
    private pkc: PkcInstance;
    private db: Database;
    private queries: IndexerQueries;
    private crawlTimeout: number;
    private maxDepth: number;

    /** Set of CIDs currently being crawled (to prevent duplicates) */
    private crawlingCids: Set<string> = new Set();

    /** Queue of CIDs to crawl */
    private crawlQueue: Array<{ cid: string; depth: number }> = [];

    /** Whether the crawler is running */
    private isRunning = false;

    /** Callback when a new community is discovered */
    private onNewCommunity?: (address: string) => void;

    constructor(
        pkc: PkcInstance,
        db: Database,
        options: {
            crawlTimeout?: number;
            maxDepth?: number;
            onNewCommunity?: (address: string) => void;
        } = {}
    ) {
        this.pkc = pkc;
        this.db = db;
        this.queries = new IndexerQueries(db);
        this.crawlTimeout = options.crawlTimeout ?? DEFAULT_INDEXER_CONFIG.previousCidCrawlTimeout;
        this.maxDepth = options.maxDepth ?? DEFAULT_INDEXER_CONFIG.maxPreviousCidDepth;
        this.onNewCommunity = options.onNewCommunity;
    }

    /**
     * Start the crawler background process.
     */
    start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        console.log("[PreviousCidCrawler] Started");

        // Start processing the queue
        this.processQueue();
    }

    /**
     * Stop the crawler.
     */
    stop(): void {
        this.isRunning = false;
        this.crawlQueue = [];
        this.crawlingCids.clear();
        console.log("[PreviousCidCrawler] Stopped");
    }

    /**
     * Add a CID to the crawl queue.
     * Called when a previousCommentCid is found that we haven't indexed yet.
     */
    queueCrawl(previousCid: string): void {
        // Don't queue if we already have this comment indexed
        if (this.queries.hasIndexedCommentIpfs(previousCid)) {
            return;
        }

        // Don't queue if already crawling or in queue
        if (this.crawlingCids.has(previousCid)) {
            return;
        }

        this.crawlQueue.push({ cid: previousCid, depth: 0 });
        console.log(`[PreviousCidCrawler] Queued ${previousCid} for crawling`);
    }

    /**
     * Process the crawl queue continuously.
     */
    private async processQueue(): Promise<void> {
        while (this.isRunning) {
            if (this.crawlQueue.length === 0) {
                // Wait a bit before checking again
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            const item = this.crawlQueue.shift();
            if (!item) continue;

            // Skip if already crawling or indexed
            if (this.crawlingCids.has(item.cid) || this.queries.hasIndexedCommentIpfs(item.cid)) {
                continue;
            }

            // Skip if at max depth
            if (item.depth >= this.maxDepth) {
                console.log(`[PreviousCidCrawler] Max depth reached for chain at ${item.cid}`);
                continue;
            }

            this.crawlingCids.add(item.cid);

            try {
                const result = await this.crawlCid(item.cid);

                if (result.success) {
                    // Check if this is a new community
                    if (result.communityAddress) {
                        const existingCommunity = this.queries.getIndexedCommunity(result.communityAddress);
                        if (!existingCommunity) {
                            console.log(`[PreviousCidCrawler] Discovered new community: ${result.communityAddress}`);
                            this.queries.upsertIndexedCommunity({
                                address: result.communityAddress,
                                discoveredVia: "previous_comment_cid"
                            });
                            this.onNewCommunity?.(result.communityAddress);
                        }
                    }

                    // Queue the next previousCommentCid if valid and not already indexed
                    if (result.nextPreviousCid && result.hasCommentUpdate && !this.queries.hasIndexedCommentIpfs(result.nextPreviousCid)) {
                        this.crawlQueue.push({
                            cid: result.nextPreviousCid,
                            depth: item.depth + 1
                        });
                    }
                }
            } catch (error) {
                console.error(`[PreviousCidCrawler] Error crawling ${item.cid}:`, error);
            } finally {
                this.crawlingCids.delete(item.cid);
            }
        }
    }

    /**
     * Crawl a single CID with timeout.
     * Returns the result with CommentIpfs and optionally CommentUpdate.
     */
    async crawlCid(cid: string): Promise<CrawlResult> {
        let comment: Comment | null = null;

        try {
            comment = await this.pkc.createComment({ cid });

            // Start the update process
            await comment.update();

            // Wait for update event with timeout
            const updateReceived = await Promise.race([
                new Promise<boolean>((resolve) => {
                    comment!.on("update", () => {
                        // Check if we got a full CommentUpdate
                        if (comment!.raw?.commentUpdate?.updatedAt !== undefined) {
                            resolve(true);
                        }
                    });
                }),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.crawlTimeout))
            ]);

            // Store the comment data
            const raw = comment.raw;
            if (raw?.comment) {
                const { hasUpdate } = storeRawComment(comment, this.queries);

                // Extract previousCommentCid for next hop
                const previousCid = raw.comment.author?.previousCommentCid ?? null;

                return {
                    success: true,
                    cid,
                    communityAddress: getCommunityAddressFromRecord(raw.comment),
                    nextPreviousCid: previousCid ?? undefined,
                    hasCommentUpdate: hasUpdate
                };
            }

            return {
                success: false,
                cid,
                hasCommentUpdate: false,
                error: "No raw.comment data available"
            };
        } catch (error) {
            return {
                success: false,
                cid,
                hasCommentUpdate: false,
                error: String(error)
            };
        } finally {
            // Clean up
            if (comment) {
                try {
                    await comment.stop();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * Get the current queue size.
     */
    get queueSize(): number {
        return this.crawlQueue.length;
    }

    /**
     * Get the number of CIDs currently being crawled.
     */
    get activeCrawls(): number {
        return this.crawlingCids.size;
    }
}
