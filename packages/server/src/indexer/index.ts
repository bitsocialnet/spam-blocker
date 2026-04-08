/**
 * Main indexer module that coordinates all indexer workers.
 * Provides lifecycle management for the indexer subsystem.
 */

import type { Database } from "better-sqlite3";
import { getPkc, stopPkc, type PkcManagerOptions } from "./pkc-manager.js";
import { CommunityIndexer } from "./community-indexer.js";
import { PreviousCidCrawler } from "./workers/previous-cid-crawler.js";
import { ModQueueTracker } from "./workers/modqueue-tracker.js";
import { IndexerQueries } from "./db/queries.js";
import { resetPageQueue } from "./page-queue.js";
import type { IndexerConfig } from "./types.js";
import { DEFAULT_INDEXER_CONFIG } from "./types.js";

export * from "./types.js";
export * from "./pkc-manager.js";
export * from "./page-queue.js";
export { IndexerQueries } from "./db/queries.js";
export { CommunityIndexer } from "./community-indexer.js";
export { PreviousCidCrawler } from "./workers/previous-cid-crawler.js";
export { ModQueueTracker } from "./workers/modqueue-tracker.js";

/**
 * State of the indexer.
 */
export interface IndexerState {
    isRunning: boolean;
    subscribedCommunities: number;
    pendingCrawls: number;
    activeCrawls: number;
}

/**
 * Main indexer class that coordinates all workers.
 */
export class Indexer {
    private db: Database;
    private config: IndexerConfig;
    private pkcOptions?: PkcManagerOptions;

    private communityIndexer: CommunityIndexer | null = null;
    private previousCidCrawler: PreviousCidCrawler | null = null;
    private modQueueTracker: ModQueueTracker | null = null;

    private isRunning = false;

    constructor(
        db: Database,
        options: {
            config?: Partial<IndexerConfig>;
            pkcOptions?: PkcManagerOptions;
        } = {}
    ) {
        this.db = db;
        this.config = { ...DEFAULT_INDEXER_CONFIG, ...options.config };
        this.pkcOptions = options.pkcOptions;
    }

    /**
     * Start the indexer.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log("[Indexer] Already running");
            return;
        }

        console.log("[Indexer] Starting...");

        try {
            // Get shared PKC instance
            const pkc = await getPkc(this.pkcOptions);

            // Initialize previous CID crawler (only if enabled)
            if (this.config.enablePreviousCidCrawler) {
                this.previousCidCrawler = new PreviousCidCrawler(pkc, this.db, {
                    crawlTimeout: this.config.previousCidCrawlTimeout,
                    maxDepth: this.config.maxPreviousCidDepth,
                    onNewCommunity: (address) => {
                        // Subscribe to newly discovered community
                        this.communityIndexer?.addCommunity(address, "previous_comment_cid");
                    }
                });
            }

            // Initialize modQueue tracker
            this.modQueueTracker = new ModQueueTracker(pkc, this.db);

            // Initialize community indexer
            this.communityIndexer = new CommunityIndexer(pkc, this.db, {
                onNewPreviousCid: this.config.enablePreviousCidCrawler
                    ? (previousCid) => {
                          this.previousCidCrawler?.queueCrawl(previousCid);
                      }
                    : undefined,
                onCommunityUpdate: (community) => this.modQueueTracker?.processModQueue(community) ?? Promise.resolve()
            });

            // Start workers
            this.previousCidCrawler?.start();
            await this.communityIndexer.start();

            this.isRunning = true;
            console.log("[Indexer] Started successfully");
        } catch (error) {
            console.error("[Indexer] Failed to start:", error);
            await this.stop();
            throw error;
        }
    }

    /**
     * Stop the indexer.
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        console.log("[Indexer] Stopping...");

        // Stop workers
        this.previousCidCrawler?.stop();
        await this.communityIndexer?.stop();

        // Clean up
        this.previousCidCrawler = null;
        this.communityIndexer = null;
        this.modQueueTracker = null;

        // Reset page queue
        resetPageQueue();

        // Stop PKC instance
        await stopPkc();

        this.isRunning = false;
        console.log("[Indexer] Stopped");
    }

    /**
     * Add a community for indexing.
     */
    async addCommunity(address: string, discoveredVia: "evaluate_api" | "previous_comment_cid" | "manual"): Promise<void> {
        const queries = new IndexerQueries(this.db);

        // Insert into DB
        queries.upsertIndexedCommunity({ address, discoveredVia });

        // Subscribe if running
        if (this.isRunning && this.communityIndexer) {
            await this.communityIndexer.subscribeToCommunity(address);
        }
    }

    /**
     * Get current indexer state.
     */
    getState(): IndexerState {
        return {
            isRunning: this.isRunning,
            subscribedCommunities: this.communityIndexer?.subscriptionCount ?? 0,
            pendingCrawls: this.previousCidCrawler?.queueSize ?? 0,
            activeCrawls: this.previousCidCrawler?.activeCrawls ?? 0
        };
    }

    /**
     * Get the IndexerQueries instance for direct DB access.
     */
    getQueries(): IndexerQueries {
        return new IndexerQueries(this.db);
    }

    /**
     * Check if the indexer is running.
     */
    get running(): boolean {
        return this.isRunning;
    }

    /**
     * Queue a previousCommentCid for background crawling.
     * Called from /evaluate when a publication has author.previousCommentCid.
     * Does nothing if indexer is not running or CID is already indexed.
     */
    queuePreviousCidCrawl(previousCid: string): void {
        if (!this.isRunning || !this.previousCidCrawler) {
            return;
        }
        this.previousCidCrawler.queueCrawl(previousCid);
    }
}

// Singleton indexer instance
let indexerInstance: Indexer | null = null;

/**
 * Get or create the singleton indexer instance.
 */
export function getIndexer(
    db: Database,
    options?: {
        config?: Partial<IndexerConfig>;
        pkcOptions?: PkcManagerOptions;
    }
): Indexer {
    if (!indexerInstance) {
        indexerInstance = new Indexer(db, options);
    }
    return indexerInstance;
}

/**
 * Start the singleton indexer.
 */
export async function startIndexer(
    db: Database,
    options?: {
        config?: Partial<IndexerConfig>;
        pkcOptions?: PkcManagerOptions;
    }
): Promise<Indexer> {
    const indexer = getIndexer(db, options);
    await indexer.start();
    return indexer;
}

/**
 * Stop the singleton indexer.
 */
export async function stopIndexer(): Promise<void> {
    if (indexerInstance) {
        await indexerInstance.stop();
        indexerInstance = null;
    }
}

/**
 * Reset the indexer (for testing).
 */
export function resetIndexer(): void {
    indexerInstance = null;
}
