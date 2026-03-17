/**
 * Worker for tracking modQueue and detecting acceptance/rejection.
 * Monitors subplebbit.modQueue to track which authors get approved or rejected.
 */

import type { Database } from "better-sqlite3";
import { IndexerQueries } from "../db/queries.js";
import { getPageQueue } from "../page-queue.js";
import type { ModQueuePageTypeJson } from "@plebbit/plebbit-js/dist/node/pages/types.js";
import type { PlebbitInstance } from "../plebbit-manager.js";

// Derive types from Plebbit instance methods
type RemoteSubplebbit = Awaited<ReturnType<PlebbitInstance["getSubplebbit"]>>;

// ModQueue comment type from plebbit-js - use directly instead of duplicating fields
type ModQueueComment = ModQueuePageTypeJson["comments"][number];

/**
 * Tracks modQueue for a single subplebbit.
 */
export class ModQueueTracker {
    private db: Database;
    private queries: IndexerQueries;
    private plebbit: PlebbitInstance;
    private currentModQueueCids: Set<string> = new Set();

    constructor(plebbit: PlebbitInstance, db: Database) {
        this.plebbit = plebbit;
        this.db = db;
        this.queries = new IndexerQueries(db);
    }

    /**
     * Process modQueue for a subplebbit.
     * Called when a subplebbit update is received.
     */
    async processModQueue(subplebbit: RemoteSubplebbit): Promise<void> {
        const address = subplebbit.address;

        // Get current modQueue items from the subplebbit
        const modQueueItems = await this.fetchAllModQueueItems(subplebbit);
        const currentCids = new Set(modQueueItems.map((item) => item.cid));

        // Get previously tracked unresolved items for this sub
        const previousUnresolved = this.queries.getUnresolvedModQueueItems(address);
        const previousCids = new Set(previousUnresolved.map((item) => item.cid));

        // Find items that disappeared from modQueue (resolved)
        for (const prevItem of previousUnresolved) {
            if (!currentCids.has(prevItem.cid)) {
                // This item is no longer in modQueue - need to determine if accepted or rejected
                await this.resolveModQueueItem(prevItem.cid, address);
            }
        }

        // Store new modQueue items
        for (const item of modQueueItems) {
            this.storeModQueueItem(item, address);
        }

        console.log(`[ModQueueTracker] Processed ${modQueueItems.length} modQueue items for ${address}`);
    }

    /**
     * Fetch all modQueue items from a subplebbit.
     */
    private async fetchAllModQueueItems(subplebbit: RemoteSubplebbit): Promise<ModQueueComment[]> {
        const items: ModQueueComment[] = [];
        const pageQueue = getPageQueue();

        // modQueue may not be accessible if we're not a mod
        if (!subplebbit.modQueue?.pageCids) {
            return items;
        }

        // Iterate through all modQueue page types
        for (const [sortType, pageCid] of Object.entries(subplebbit.modQueue.pageCids)) {
            if (!pageCid) continue;

            try {
                let page = await pageQueue.add(() => subplebbit.modQueue.getPage({ cid: pageCid }));

                // Process this page
                items.push(...page.comments);

                // Follow nextCid links
                while (page.nextCid) {
                    const nextCid = page.nextCid;
                    page = await pageQueue.add(() => subplebbit.modQueue.getPage({ cid: nextCid }));
                    items.push(...page.comments);
                }
            } catch (error) {
                console.error(`[ModQueueTracker] Error fetching modQueue page ${pageCid}:`, error);
            }
        }

        // Deduplicate by CID
        const uniqueItems = new Map<string, ModQueueComment>();
        for (const item of items) {
            if (item.cid) {
                uniqueItems.set(item.cid, item);
            }
        }

        return Array.from(uniqueItems.values());
    }

    /**
     * Store a modQueue comment in the database.
     */
    private storeModQueueItem(comment: ModQueueComment, subplebbitAddress: string): void {
        if (!comment.cid) return;

        // Store CommentIpfs data
        this.queries.upsertModQueueCommentIpfs({
            cid: comment.cid,
            subplebbitAddress,
            author: comment.author,
            signature: comment.signature,
            parentCid: comment.parentCid ?? null,
            content: comment.content ?? null,
            title: comment.title ?? null,
            link: comment.link ?? null,
            timestamp: comment.timestamp,
            depth: comment.depth ?? null,
            protocolVersion: comment.protocolVersion ?? null,
            pseudonymityMode: comment.pseudonymityMode ?? null
        });

        // Store CommentUpdate data (only subplebbit portion of author)
        const updateAuthor = comment.author?.subplebbit ? { subplebbit: comment.author.subplebbit } : null;

        this.queries.upsertModQueueCommentUpdate({
            cid: comment.cid,
            author: updateAuthor,
            protocolVersion: comment.protocolVersion ?? null,
            number: comment.number ?? null,
            postNumber: comment.postNumber ?? null
        });
    }

    /**
     * Resolve a modQueue item that has disappeared from the queue.
     * Try to fetch the full CommentUpdate to determine if it was accepted.
     */
    private async resolveModQueueItem(cid: string, subplebbitAddress: string): Promise<void> {
        let comment: Awaited<ReturnType<PlebbitInstance["createComment"]>> | null = null;
        try {
            // Try to fetch the comment to see if it has a full CommentUpdate
            comment = await this.plebbit.createComment({ cid });
            await comment.update();

            // Wait a bit for the update event
            const hasUpdate = await Promise.race([
                new Promise<boolean>((resolve) => {
                    comment!.on("update", () => {
                        // Check if we got a full CommentUpdate (not just challenge verification)
                        if (comment!.raw?.commentUpdate?.updatedAt !== undefined) {
                            resolve(true);
                        }
                    });
                }),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000))
            ]);

            // If we got a full CommentUpdate, it was accepted
            // If not (timeout or no update), it was rejected
            this.queries.resolveModQueueItem(cid, hasUpdate);

            console.log(`[ModQueueTracker] Resolved ${cid}: ${hasUpdate ? "accepted" : "rejected"}`);
        } catch (error) {
            // If we can't fetch the comment at all, mark as rejected
            console.error(`[ModQueueTracker] Error resolving ${cid}:`, error);
            this.queries.resolveModQueueItem(cid, false);
        } finally {
            // Always stop listening for updates
            if (comment) {
                await comment.stop();
            }
        }
    }
}
