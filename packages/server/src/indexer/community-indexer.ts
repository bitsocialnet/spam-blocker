/**
 * Worker for subscribing to communities and reacting to updates.
 * Uses reactive updates instead of periodic scans.
 */

import type { Database } from "better-sqlite3";
import { IndexerQueries } from "./db/queries.js";
import { DEFAULT_INDEXER_CONFIG } from "./types.js";
import { fetchAndStoreCommunityComments } from "./workers/comment-fetcher.js";
import type { PkcInstance } from "./pkc-manager.js";

type RemoteCommunity = Awaited<ReturnType<PkcInstance["getCommunity"]>>;

interface CommunitySubscription {
    address: string;
    community: RemoteCommunity;
    lastPostsPageCidNew: string | null;
    lastCommunityUpdatedAt: number | null;
    lastModQueuePendingApprovalPageCid: string | null;
    isUpdating: boolean;
}

export class CommunityIndexer {
    private subscriptions: Map<string, CommunitySubscription> = new Map();
    private pkc: PkcInstance;
    private db: Database;
    private queries: IndexerQueries;
    private isRunning = false;
    private onNewPreviousCid?: (previousCid: string) => void;
    private onCommunityUpdate?: (community: RemoteCommunity) => Promise<void>;

    constructor(
        pkc: PkcInstance,
        db: Database,
        options: {
            onNewPreviousCid?: (previousCid: string) => void;
            onCommunityUpdate?: (community: RemoteCommunity) => Promise<void>;
        } = {}
    ) {
        this.pkc = pkc;
        this.db = db;
        this.queries = new IndexerQueries(db);
        this.onNewPreviousCid = options.onNewPreviousCid;
        this.onCommunityUpdate = options.onCommunityUpdate;
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            console.log("[CommunityIndexer] Already running");
            return;
        }

        this.isRunning = true;
        console.log("[CommunityIndexer] Starting...");

        const enabledCommunities = this.queries.getEnabledCommunities();
        console.log(`[CommunityIndexer] Found ${enabledCommunities.length} enabled communities`);

        for (const communityRow of enabledCommunities) {
            try {
                await this.subscribeToCommunity(communityRow.address, {
                    lastPostsPageCidNew: communityRow.lastPostsPageCidNew,
                    lastCommunityUpdatedAt: communityRow.lastCommunityUpdatedAt,
                    lastModQueuePendingApprovalPageCid: communityRow.lastModQueuePendingApprovalPageCid
                });
            } catch (error) {
                console.error(`[CommunityIndexer] Failed to subscribe to ${communityRow.address}:`, error);
                this.queries.recordCommunityError(communityRow.address, String(error));
            }
        }
    }

    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        console.log("[CommunityIndexer] Stopping...");
        this.isRunning = false;

        for (const [address, subscription] of this.subscriptions) {
            try {
                await subscription.community.stop();
            } catch (error) {
                console.error(`[CommunityIndexer] Error stopping ${address}:`, error);
            }
        }

        this.subscriptions.clear();
        console.log("[CommunityIndexer] Stopped");
    }

    async subscribeToCommunity(
        address: string,
        cachedState?: {
            lastPostsPageCidNew: string | null;
            lastCommunityUpdatedAt: number | null;
            lastModQueuePendingApprovalPageCid: string | null;
        }
    ): Promise<void> {
        if (this.subscriptions.has(address)) {
            console.log(`[CommunityIndexer] Already subscribed to ${address}`);
            return;
        }

        console.log(`[CommunityIndexer] Subscribing to ${address}...`);

        const community = await this.pkc.getCommunity({ address });

        const subscription: CommunitySubscription = {
            address,
            community,
            lastPostsPageCidNew: cachedState?.lastPostsPageCidNew ?? null,
            lastCommunityUpdatedAt: cachedState?.lastCommunityUpdatedAt ?? null,
            lastModQueuePendingApprovalPageCid: cachedState?.lastModQueuePendingApprovalPageCid ?? null,
            isUpdating: false
        };

        this.subscriptions.set(address, subscription);

        community.on("update", () => {
            this.handleCommunityUpdate(subscription).catch((error) => {
                console.error(`[CommunityIndexer] Error handling update for ${address}:`, error);
            });
        });

        await community.update();

        console.log(`[CommunityIndexer] Subscribed to ${address}`);
    }

    private async handleCommunityUpdate(subscription: CommunitySubscription): Promise<void> {
        const { address, community } = subscription;

        if (subscription.isUpdating) {
            return;
        }

        const currentUpdatedAt = community.updatedAt;
        if (currentUpdatedAt === subscription.lastCommunityUpdatedAt && subscription.lastCommunityUpdatedAt !== null) {
            return;
        }

        const currentPageCidNew = community.posts?.pageCids?.new ?? null;
        const currentModQueuePageCid = (community as any).modQueue?.pageCids?.pendingApproval ?? null;

        const postsChanged = currentPageCidNew !== subscription.lastPostsPageCidNew || subscription.lastPostsPageCidNew === null;
        const modQueueChanged = currentModQueuePageCid !== subscription.lastModQueuePendingApprovalPageCid;

        if (modQueueChanged && this.onCommunityUpdate) {
            this.onCommunityUpdate(community).catch((error) => {
                console.error(`[CommunityIndexer] Error in onCommunityUpdate callback for ${address}:`, error);
            });
        }

        if (!postsChanged) {
            this.queries.updateCommunityCacheMarkers({
                address,
                lastPostsPageCidNew: currentPageCidNew,
                lastCommunityUpdatedAt: currentUpdatedAt ?? null,
                lastUpdateCid: community.updateCid!,
                lastModQueuePendingApprovalPageCid: currentModQueuePageCid
            });
            subscription.lastCommunityUpdatedAt = currentUpdatedAt ?? null;
            subscription.lastModQueuePendingApprovalPageCid = currentModQueuePageCid;
            return;
        }

        subscription.isUpdating = true;
        console.log(`[CommunityIndexer] Update detected for ${address}, fetching comments...`);

        try {
            this.queries.upsertIndexedCommunity({
                address,
                publicKey: community.signature?.publicKey,
                discoveredVia: "evaluate_api"
            });

            const result = await fetchAndStoreCommunityComments(community, this.pkc, this.db, {
                onNewPreviousCid: this.onNewPreviousCid
            });

            this.queries.updateCommunityCacheMarkers({
                address,
                lastPostsPageCidNew: currentPageCidNew,
                lastCommunityUpdatedAt: currentUpdatedAt ?? null,
                lastUpdateCid: community.updateCid!,
                lastModQueuePendingApprovalPageCid: currentModQueuePageCid
            });

            subscription.lastPostsPageCidNew = currentPageCidNew;
            subscription.lastCommunityUpdatedAt = currentUpdatedAt ?? null;
            subscription.lastModQueuePendingApprovalPageCid = currentModQueuePageCid;

            console.log(
                `[CommunityIndexer] Indexed ${result.postsCount} posts from ${address}` +
                    (result.disappearedCount > 0 ? `, ${result.disappearedCount} disappeared` : "")
            );
        } catch (error) {
            console.error(`[CommunityIndexer] Error fetching comments from ${address}:`, error);
            this.queries.recordCommunityError(address, String(error));

            const communityRow = this.queries.getIndexedCommunity(address);
            if (communityRow && communityRow.consecutiveErrors >= DEFAULT_INDEXER_CONFIG.maxConsecutiveErrors) {
                console.warn(
                    `[CommunityIndexer] Disabling indexing for ${address} after ${communityRow.consecutiveErrors} consecutive errors`
                );
                this.queries.disableCommunityIndexing(address);
                await this.unsubscribeFromCommunity(address);
            }
        } finally {
            subscription.isUpdating = false;
        }
    }

    async unsubscribeFromCommunity(address: string): Promise<void> {
        const subscription = this.subscriptions.get(address);
        if (!subscription) {
            return;
        }

        try {
            await subscription.community.stop();
        } catch (error) {
            console.error(`[CommunityIndexer] Error stopping ${address}:`, error);
        }

        this.subscriptions.delete(address);
        console.log(`[CommunityIndexer] Unsubscribed from ${address}`);
    }

    async addCommunity(address: string, discoveredVia: "evaluate_api" | "previous_comment_cid" | "manual"): Promise<void> {
        this.queries.upsertIndexedCommunity({
            address,
            discoveredVia
        });

        if (this.isRunning) {
            await this.subscribeToCommunity(address);
        }
    }

    get subscriptionCount(): number {
        return this.subscriptions.size;
    }
}
