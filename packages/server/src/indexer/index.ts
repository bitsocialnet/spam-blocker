/**
 * Main indexer module that coordinates all indexer workers.
 * Provides lifecycle management for the indexer subsystem.
 */

import type { Database } from "better-sqlite3";
import { getPlebbit, stopPlebbit, type PlebbitManagerOptions } from "./plebbit-manager.js";
import { SubplebbitIndexer } from "./workers/subplebbit-indexer.js";
import { PreviousCidCrawler } from "./workers/previous-cid-crawler.js";
import { ModQueueTracker } from "./workers/modqueue-tracker.js";
import { IndexerQueries } from "./db/queries.js";
import { resetPageQueue } from "./page-queue.js";
import type { IndexerConfig } from "./types.js";
import { DEFAULT_INDEXER_CONFIG } from "./types.js";

export * from "./types.js";
export * from "./plebbit-manager.js";
export * from "./page-queue.js";
export { IndexerQueries } from "./db/queries.js";
export { SubplebbitIndexer } from "./workers/subplebbit-indexer.js";
export { PreviousCidCrawler } from "./workers/previous-cid-crawler.js";
export { ModQueueTracker } from "./workers/modqueue-tracker.js";

/**
 * State of the indexer.
 */
export interface IndexerState {
    isRunning: boolean;
    subscribedSubplebbits: number;
    pendingCrawls: number;
    activeCrawls: number;
}

/**
 * Main indexer class that coordinates all workers.
 */
export class Indexer {
    private db: Database;
    private config: IndexerConfig;
    private plebbitOptions?: PlebbitManagerOptions;

    private subplebbitIndexer: SubplebbitIndexer | null = null;
    private previousCidCrawler: PreviousCidCrawler | null = null;
    private modQueueTracker: ModQueueTracker | null = null;

    private isRunning = false;

    constructor(
        db: Database,
        options: {
            config?: Partial<IndexerConfig>;
            plebbitOptions?: PlebbitManagerOptions;
        } = {}
    ) {
        this.db = db;
        this.config = { ...DEFAULT_INDEXER_CONFIG, ...options.config };
        this.plebbitOptions = options.plebbitOptions;
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
            // Get shared Plebbit instance
            const plebbit = await getPlebbit(this.plebbitOptions);

            // Initialize previous CID crawler (only if enabled)
            if (this.config.enablePreviousCidCrawler) {
                this.previousCidCrawler = new PreviousCidCrawler(plebbit, this.db, {
                    crawlTimeout: this.config.previousCidCrawlTimeout,
                    maxDepth: this.config.maxPreviousCidDepth,
                    onNewSubplebbit: (address) => {
                        // Subscribe to newly discovered subplebbit
                        this.subplebbitIndexer?.addSubplebbit(address, "previous_comment_cid");
                    }
                });
            }

            // Initialize modQueue tracker
            this.modQueueTracker = new ModQueueTracker(plebbit, this.db);

            // Initialize subplebbit indexer
            this.subplebbitIndexer = new SubplebbitIndexer(plebbit, this.db, {
                onNewPreviousCid: this.config.enablePreviousCidCrawler
                    ? (previousCid) => {
                          this.previousCidCrawler?.queueCrawl(previousCid);
                      }
                    : undefined
            });

            // Start workers
            this.previousCidCrawler?.start();
            await this.subplebbitIndexer.start();

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
        await this.subplebbitIndexer?.stop();

        // Clean up
        this.previousCidCrawler = null;
        this.subplebbitIndexer = null;
        this.modQueueTracker = null;

        // Reset page queue
        resetPageQueue();

        // Stop Plebbit instance
        await stopPlebbit();

        this.isRunning = false;
        console.log("[Indexer] Stopped");
    }

    /**
     * Add a subplebbit for indexing.
     */
    async addSubplebbit(address: string, discoveredVia: "evaluate_api" | "previous_comment_cid" | "manual"): Promise<void> {
        const queries = new IndexerQueries(this.db);

        // Insert into DB
        queries.upsertIndexedSubplebbit({ address, discoveredVia });

        // Subscribe if running
        if (this.isRunning && this.subplebbitIndexer) {
            await this.subplebbitIndexer.subscribeToSubplebbit(address);
        }
    }

    /**
     * Get current indexer state.
     */
    getState(): IndexerState {
        return {
            isRunning: this.isRunning,
            subscribedSubplebbits: this.subplebbitIndexer?.subscriptionCount ?? 0,
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
        plebbitOptions?: PlebbitManagerOptions;
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
        plebbitOptions?: PlebbitManagerOptions;
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
