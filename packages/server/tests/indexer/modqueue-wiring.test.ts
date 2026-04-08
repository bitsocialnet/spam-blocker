import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { CommunityIndexer } from "../../src/indexer/community-indexer.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";
import type { Database } from "better-sqlite3";

/**
 * Creates a mock community that emits "update" events.
 */
function createMockCommunity(overrides: {
    address: string;
    updatedAt?: number;
    postsPageCidNew?: string;
    modQueuePendingApprovalPageCid?: string;
    updateCid?: string;
    signaturePublicKey?: string;
}) {
    const handlers: Record<string, Function[]> = {};
    return {
        address: overrides.address,
        updatedAt: overrides.updatedAt ?? 1000,
        updateCid: overrides.updateCid ?? "QmUpdateCid1",
        signature: { publicKey: overrides.signaturePublicKey ?? "pk1" },
        posts: {
            pageCids: { new: overrides.postsPageCidNew ?? "QmPostsPage1" }
        },
        modQueue: overrides.modQueuePendingApprovalPageCid
            ? { pageCids: { pendingApproval: overrides.modQueuePendingApprovalPageCid } }
            : undefined,
        on(event: string, handler: Function) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(handler);
        },
        async update() {},
        async stop() {},
        _emit(event: string) {
            for (const handler of handlers[event] ?? []) {
                handler();
            }
        },
        // Allow mutating for simulating updates
        _setUpdatedAt(val: number) {
            this.updatedAt = val;
        },
        _setPostsPageCid(val: string) {
            this.posts.pageCids.new = val;
        },
        _setModQueuePageCid(val: string | undefined) {
            if (val) {
                this.modQueue = { pageCids: { pendingApproval: val } };
            } else {
                this.modQueue = undefined;
            }
        },
        _setUpdateCid(val: string) {
            this.updateCid = val;
        }
    } as any;
}

describe("ModQueue wiring in CommunityIndexer", () => {
    let spamDb: SpamDetectionDatabase;
    let db: Database;
    let onCommunityUpdateFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        spamDb = new SpamDetectionDatabase({ path: ":memory:" });
        db = spamDb.getDb();
        onCommunityUpdateFn = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        spamDb.close();
    });

    function seedCommunity(address: string) {
        db.prepare(
            `INSERT INTO indexed_communities (address, discoveredVia, discoveredAt, indexingEnabled)
             VALUES (?, 'manual', ?, 1)`
        ).run(address, Date.now());
    }

    it("should call onCommunityUpdate when modQueue pageCid changes", async () => {
        const address = "test-sub.eth";
        seedCommunity(address);

        const mockSub = createMockCommunity({
            address,
            updatedAt: 1000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueue1",
            updateCid: "QmUpdate1"
        });

        const mockPKC = {
            getCommunity: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new CommunityIndexer(mockPKC, db, {
            onCommunityUpdate: onCommunityUpdateFn
        });

        // Subscribe with initial cached state (no previous modQueue pageCid)
        await indexer.subscribeToCommunity(address, {
            lastPostsPageCidNew: "QmPosts1", // same, so posts won't trigger
            lastCommunityUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: null // different from QmModQueue1 → should trigger
        });

        // Trigger the update event
        mockSub._emit("update");

        // Give async handlers time to run
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onCommunityUpdateFn).toHaveBeenCalledTimes(1);
        expect(onCommunityUpdateFn).toHaveBeenCalledWith(mockSub);
    });

    it("should NOT call onCommunityUpdate when modQueue pageCid is unchanged", async () => {
        const address = "test-sub2.eth";
        seedCommunity(address);

        const mockSub = createMockCommunity({
            address,
            updatedAt: 2000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueue1",
            updateCid: "QmUpdate1"
        });

        const mockPKC = {
            getCommunity: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new CommunityIndexer(mockPKC, db, {
            onCommunityUpdate: onCommunityUpdateFn
        });

        // Subscribe with cached state matching current modQueue pageCid
        await indexer.subscribeToCommunity(address, {
            lastPostsPageCidNew: "QmPosts1",
            lastCommunityUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: "QmModQueue1" // same → should NOT trigger
        });

        mockSub._emit("update");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onCommunityUpdateFn).not.toHaveBeenCalled();
    });

    it("should call onCommunityUpdate when modQueue pageCid changes even if posts unchanged", async () => {
        const address = "test-sub3.eth";
        seedCommunity(address);

        const mockSub = createMockCommunity({
            address,
            updatedAt: 3000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueueNew",
            updateCid: "QmUpdate1"
        });

        const mockPKC = {
            getCommunity: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new CommunityIndexer(mockPKC, db, {
            onCommunityUpdate: onCommunityUpdateFn
        });

        // Posts pageCid same (no posts fetch), but modQueue changed
        await indexer.subscribeToCommunity(address, {
            lastPostsPageCidNew: "QmPosts1",
            lastCommunityUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: "QmModQueueOld"
        });

        mockSub._emit("update");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onCommunityUpdateFn).toHaveBeenCalledTimes(1);

        // Verify cache markers were updated in DB
        const queries = new IndexerQueries(db);
        const sub = queries.getIndexedCommunity(address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueueNew");
        expect(sub?.lastCommunityUpdatedAt).toBe(3000);
    });

    it("should persist lastModQueuePendingApprovalPageCid in cache markers", async () => {
        const address = "test-sub4.eth";
        seedCommunity(address);

        const queries = new IndexerQueries(db);

        // Update cache markers with modQueue pageCid
        queries.updateCommunityCacheMarkers({
            address,
            lastPostsPageCidNew: "QmPosts1",
            lastCommunityUpdatedAt: 5000,
            lastUpdateCid: "QmUpdate1",
            lastModQueuePendingApprovalPageCid: "QmModQueue123"
        });

        const sub = queries.getIndexedCommunity(address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueue123");
    });

    it("should restore lastModQueuePendingApprovalPageCid from DB on startup", async () => {
        const address = "test-sub5.eth";
        seedCommunity(address);

        // Set up cache markers in DB
        const queries = new IndexerQueries(db);
        queries.updateCommunityCacheMarkers({
            address,
            lastPostsPageCidNew: "QmPosts1",
            lastCommunityUpdatedAt: 5000,
            lastUpdateCid: "QmUpdate1",
            lastModQueuePendingApprovalPageCid: "QmModQueueCached"
        });

        // Verify getEnabledCommunities returns the field
        const subs = queries.getEnabledCommunities();
        const sub = subs.find((s) => s.address === address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueueCached");
    });
});
