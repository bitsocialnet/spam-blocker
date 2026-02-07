/**
 * Worker for subscribing to subplebbits and reacting to updates.
 * Uses reactive updates instead of periodic scans.
 */

import type { Database } from "better-sqlite3";
import { IndexerQueries } from "../db/queries.js";
import { DEFAULT_INDEXER_CONFIG } from "../types.js";
import { fetchAndStoreSubplebbitComments } from "./comment-fetcher.js";
import type { PlebbitInstance } from "../plebbit-manager.js";

// Derive RemoteSubplebbit type from Plebbit instance method
type RemoteSubplebbit = Awaited<ReturnType<PlebbitInstance["getSubplebbit"]>>;

/**
 * Tracked subplebbit subscription state.
 */
interface SubplebbitSubscription {
    address: string;
    subplebbit: RemoteSubplebbit;
    lastPostsPageCidNew: string | null;
    lastSubplebbitUpdatedAt: number | null;
    lastModQueuePendingApprovalPageCid: string | null;
    isUpdating: boolean;
}

/**
 * Manages subscriptions to multiple subplebbits and reacts to their updates.
 */
export class SubplebbitIndexer {
    private subscriptions: Map<string, SubplebbitSubscription> = new Map();
    private plebbit: PlebbitInstance;
    private db: Database;
    private queries: IndexerQueries;
    private isRunning = false;
    private onNewPreviousCid?: (previousCid: string) => void;
    private onSubplebbitUpdate?: (subplebbit: RemoteSubplebbit) => Promise<void>;

    constructor(
        plebbit: PlebbitInstance,
        db: Database,
        options: {
            onNewPreviousCid?: (previousCid: string) => void;
            onSubplebbitUpdate?: (subplebbit: RemoteSubplebbit) => Promise<void>;
        } = {}
    ) {
        this.plebbit = plebbit;
        this.db = db;
        this.queries = new IndexerQueries(db);
        this.onNewPreviousCid = options.onNewPreviousCid;
        this.onSubplebbitUpdate = options.onSubplebbitUpdate;
    }

    /**
     * Start the indexer by subscribing to all enabled subplebbits.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log("[SubplebbitIndexer] Already running");
            return;
        }

        this.isRunning = true;
        console.log("[SubplebbitIndexer] Starting...");

        // Get all enabled subplebbits from DB
        const enabledSubs = this.queries.getEnabledSubplebbits();
        console.log(`[SubplebbitIndexer] Found ${enabledSubs.length} enabled subplebbits`);

        // Subscribe to each one
        for (const sub of enabledSubs) {
            try {
                await this.subscribeToSubplebbit(sub.address, {
                    lastPostsPageCidNew: sub.lastPostsPageCidNew,
                    lastSubplebbitUpdatedAt: sub.lastSubplebbitUpdatedAt,
                    lastModQueuePendingApprovalPageCid: sub.lastModQueuePendingApprovalPageCid
                });
            } catch (error) {
                console.error(`[SubplebbitIndexer] Failed to subscribe to ${sub.address}:`, error);
                this.queries.recordSubplebbitError(sub.address, String(error));
            }
        }
    }

    /**
     * Stop the indexer and unsubscribe from all subplebbits.
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        console.log("[SubplebbitIndexer] Stopping...");
        this.isRunning = false;

        // Stop all subscriptions
        for (const [address, subscription] of this.subscriptions) {
            try {
                await subscription.subplebbit.stop();
            } catch (error) {
                console.error(`[SubplebbitIndexer] Error stopping ${address}:`, error);
            }
        }

        this.subscriptions.clear();
        console.log("[SubplebbitIndexer] Stopped");
    }

    /**
     * Subscribe to a new subplebbit.
     */
    async subscribeToSubplebbit(
        address: string,
        cachedState?: {
            lastPostsPageCidNew: string | null;
            lastSubplebbitUpdatedAt: number | null;
            lastModQueuePendingApprovalPageCid: string | null;
        }
    ): Promise<void> {
        if (this.subscriptions.has(address)) {
            console.log(`[SubplebbitIndexer] Already subscribed to ${address}`);
            return;
        }

        console.log(`[SubplebbitIndexer] Subscribing to ${address}...`);

        const subplebbit = await this.plebbit.getSubplebbit({ address });

        const subscription: SubplebbitSubscription = {
            address,
            subplebbit,
            lastPostsPageCidNew: cachedState?.lastPostsPageCidNew ?? null,
            lastSubplebbitUpdatedAt: cachedState?.lastSubplebbitUpdatedAt ?? null,
            lastModQueuePendingApprovalPageCid: cachedState?.lastModQueuePendingApprovalPageCid ?? null,
            isUpdating: false
        };

        this.subscriptions.set(address, subscription);

        // Set up update handler
        subplebbit.on("update", () => {
            this.handleSubplebbitUpdate(subscription).catch((error) => {
                console.error(`[SubplebbitIndexer] Error handling update for ${address}:`, error);
            });
        });

        // Start listening for updates
        await subplebbit.update();

        console.log(`[SubplebbitIndexer] Subscribed to ${address}`);
    }

    /**
     * Handle a subplebbit update event.
     * Uses smart caching to skip unnecessary fetches.
     */
    private async handleSubplebbitUpdate(subscription: SubplebbitSubscription): Promise<void> {
        const { address, subplebbit } = subscription;

        // Prevent concurrent updates for the same sub
        if (subscription.isUpdating) {
            return;
        }

        // Check if subplebbit actually changed
        const currentUpdatedAt = subplebbit.updatedAt;
        if (currentUpdatedAt === subscription.lastSubplebbitUpdatedAt && subscription.lastSubplebbitUpdatedAt !== null) {
            // Nothing changed
            return;
        }

        // Check what changed independently
        const currentPageCidNew = subplebbit.posts?.pageCids?.new ?? null;
        const currentModQueuePageCid = (subplebbit as any).modQueue?.pageCids?.pendingApproval ?? null;

        const postsChanged = currentPageCidNew !== subscription.lastPostsPageCidNew || subscription.lastPostsPageCidNew === null;
        const modQueueChanged = currentModQueuePageCid !== subscription.lastModQueuePendingApprovalPageCid;

        // If modQueue pageCid changed, trigger the callback (fire-and-forget, don't block posts indexing)
        if (modQueueChanged && this.onSubplebbitUpdate) {
            this.onSubplebbitUpdate(subplebbit).catch((error) => {
                console.error(`[SubplebbitIndexer] Error in onSubplebbitUpdate callback for ${address}:`, error);
            });
        }

        if (!postsChanged) {
            // Posts haven't changed, only updatedAt and/or modQueue
            // Still update the cache markers
            this.queries.updateSubplebbitCacheMarkers({
                address,
                lastPostsPageCidNew: currentPageCidNew,
                lastSubplebbitUpdatedAt: currentUpdatedAt ?? null,
                lastUpdateCid: subplebbit.updateCid!,
                lastModQueuePendingApprovalPageCid: currentModQueuePageCid
            });
            subscription.lastSubplebbitUpdatedAt = currentUpdatedAt ?? null;
            subscription.lastModQueuePendingApprovalPageCid = currentModQueuePageCid;
            return;
        }

        // Posts changed - need to fetch new posts
        subscription.isUpdating = true;
        console.log(`[SubplebbitIndexer] Update detected for ${address}, fetching comments...`);

        try {
            // Update subplebbit metadata in DB
            this.queries.upsertIndexedSubplebbit({
                address,
                publicKey: subplebbit.signature?.publicKey,
                discoveredVia: "evaluate_api" // Will keep existing discoveredVia on conflict
            });

            // Fetch and store all comments
            const result = await fetchAndStoreSubplebbitComments(subplebbit, this.plebbit, this.db, {
                onNewPreviousCid: this.onNewPreviousCid
            });

            // Update cache markers
            this.queries.updateSubplebbitCacheMarkers({
                address,
                lastPostsPageCidNew: currentPageCidNew,
                lastSubplebbitUpdatedAt: currentUpdatedAt ?? null,
                lastUpdateCid: subplebbit.updateCid!,
                lastModQueuePendingApprovalPageCid: currentModQueuePageCid
            });

            subscription.lastPostsPageCidNew = currentPageCidNew;
            subscription.lastSubplebbitUpdatedAt = currentUpdatedAt ?? null;
            subscription.lastModQueuePendingApprovalPageCid = currentModQueuePageCid;

            console.log(
                `[SubplebbitIndexer] Indexed ${result.postsCount} posts from ${address}` +
                    (result.disappearedCount > 0 ? `, ${result.disappearedCount} disappeared` : "")
            );
        } catch (error) {
            console.error(`[SubplebbitIndexer] Error fetching comments from ${address}:`, error);
            this.queries.recordSubplebbitError(address, String(error));

            // Check if we should disable indexing
            const sub = this.queries.getIndexedSubplebbit(address);
            if (sub && sub.consecutiveErrors >= DEFAULT_INDEXER_CONFIG.maxConsecutiveErrors) {
                console.warn(`[SubplebbitIndexer] Disabling indexing for ${address} after ${sub.consecutiveErrors} consecutive errors`);
                this.queries.disableSubplebbitIndexing(address);
                await this.unsubscribeFromSubplebbit(address);
            }
        } finally {
            subscription.isUpdating = false;
        }
    }

    /**
     * Unsubscribe from a subplebbit.
     */
    async unsubscribeFromSubplebbit(address: string): Promise<void> {
        const subscription = this.subscriptions.get(address);
        if (!subscription) {
            return;
        }

        try {
            await subscription.subplebbit.stop();
        } catch (error) {
            console.error(`[SubplebbitIndexer] Error stopping ${address}:`, error);
        }

        this.subscriptions.delete(address);
        console.log(`[SubplebbitIndexer] Unsubscribed from ${address}`);
    }

    /**
     * Add a new subplebbit for indexing.
     * Called when a sub is discovered via evaluate API or previousCommentCid.
     */
    async addSubplebbit(address: string, discoveredVia: "evaluate_api" | "previous_comment_cid" | "manual"): Promise<void> {
        // Insert into DB
        this.queries.upsertIndexedSubplebbit({
            address,
            discoveredVia
        });

        // Subscribe if we're running
        if (this.isRunning) {
            await this.subscribeToSubplebbit(address);
        }
    }

    /**
     * Get the number of active subscriptions.
     */
    get subscriptionCount(): number {
        return this.subscriptions.size;
    }

    /**
     * Check if a subplebbit is currently subscribed.
     */
    isSubscribed(address: string): boolean {
        return this.subscriptions.has(address);
    }
}
