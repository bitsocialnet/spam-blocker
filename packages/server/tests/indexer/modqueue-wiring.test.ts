import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpamDetectionDatabase } from "../../src/db/index.js";
import { SubplebbitIndexer } from "../../src/indexer/workers/subplebbit-indexer.js";
import { IndexerQueries } from "../../src/indexer/db/queries.js";
import type { Database } from "better-sqlite3";

/**
 * Creates a mock subplebbit that emits "update" events.
 */
function createMockSubplebbit(overrides: {
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

describe("ModQueue wiring in SubplebbitIndexer", () => {
    let spamDb: SpamDetectionDatabase;
    let db: Database;
    let onSubplebbitUpdateFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        spamDb = new SpamDetectionDatabase({ path: ":memory:" });
        db = spamDb.getDb();
        onSubplebbitUpdateFn = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        spamDb.close();
    });

    function seedSubplebbit(address: string) {
        db.prepare(
            `INSERT INTO indexed_subplebbits (address, discoveredVia, discoveredAt, indexingEnabled)
             VALUES (?, 'manual', ?, 1)`
        ).run(address, Date.now());
    }

    it("should call onSubplebbitUpdate when modQueue pageCid changes", async () => {
        const address = "test-sub.eth";
        seedSubplebbit(address);

        const mockSub = createMockSubplebbit({
            address,
            updatedAt: 1000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueue1",
            updateCid: "QmUpdate1"
        });

        const mockPlebbit = {
            getSubplebbit: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new SubplebbitIndexer(mockPlebbit, db, {
            onSubplebbitUpdate: onSubplebbitUpdateFn
        });

        // Subscribe with initial cached state (no previous modQueue pageCid)
        await indexer.subscribeToSubplebbit(address, {
            lastPostsPageCidNew: "QmPosts1", // same, so posts won't trigger
            lastSubplebbitUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: null // different from QmModQueue1 → should trigger
        });

        // Trigger the update event
        mockSub._emit("update");

        // Give async handlers time to run
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onSubplebbitUpdateFn).toHaveBeenCalledTimes(1);
        expect(onSubplebbitUpdateFn).toHaveBeenCalledWith(mockSub);
    });

    it("should NOT call onSubplebbitUpdate when modQueue pageCid is unchanged", async () => {
        const address = "test-sub2.eth";
        seedSubplebbit(address);

        const mockSub = createMockSubplebbit({
            address,
            updatedAt: 2000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueue1",
            updateCid: "QmUpdate1"
        });

        const mockPlebbit = {
            getSubplebbit: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new SubplebbitIndexer(mockPlebbit, db, {
            onSubplebbitUpdate: onSubplebbitUpdateFn
        });

        // Subscribe with cached state matching current modQueue pageCid
        await indexer.subscribeToSubplebbit(address, {
            lastPostsPageCidNew: "QmPosts1",
            lastSubplebbitUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: "QmModQueue1" // same → should NOT trigger
        });

        mockSub._emit("update");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onSubplebbitUpdateFn).not.toHaveBeenCalled();
    });

    it("should call onSubplebbitUpdate when modQueue pageCid changes even if posts unchanged", async () => {
        const address = "test-sub3.eth";
        seedSubplebbit(address);

        const mockSub = createMockSubplebbit({
            address,
            updatedAt: 3000,
            postsPageCidNew: "QmPosts1",
            modQueuePendingApprovalPageCid: "QmModQueueNew",
            updateCid: "QmUpdate1"
        });

        const mockPlebbit = {
            getSubplebbit: vi.fn().mockResolvedValue(mockSub)
        } as any;

        const indexer = new SubplebbitIndexer(mockPlebbit, db, {
            onSubplebbitUpdate: onSubplebbitUpdateFn
        });

        // Posts pageCid same (no posts fetch), but modQueue changed
        await indexer.subscribeToSubplebbit(address, {
            lastPostsPageCidNew: "QmPosts1",
            lastSubplebbitUpdatedAt: null,
            lastModQueuePendingApprovalPageCid: "QmModQueueOld"
        });

        mockSub._emit("update");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(onSubplebbitUpdateFn).toHaveBeenCalledTimes(1);

        // Verify cache markers were updated in DB
        const queries = new IndexerQueries(db);
        const sub = queries.getIndexedSubplebbit(address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueueNew");
        expect(sub?.lastSubplebbitUpdatedAt).toBe(3000);
    });

    it("should persist lastModQueuePendingApprovalPageCid in cache markers", async () => {
        const address = "test-sub4.eth";
        seedSubplebbit(address);

        const queries = new IndexerQueries(db);

        // Update cache markers with modQueue pageCid
        queries.updateSubplebbitCacheMarkers({
            address,
            lastPostsPageCidNew: "QmPosts1",
            lastSubplebbitUpdatedAt: 5000,
            lastUpdateCid: "QmUpdate1",
            lastModQueuePendingApprovalPageCid: "QmModQueue123"
        });

        const sub = queries.getIndexedSubplebbit(address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueue123");
    });

    it("should restore lastModQueuePendingApprovalPageCid from DB on startup", async () => {
        const address = "test-sub5.eth";
        seedSubplebbit(address);

        // Set up cache markers in DB
        const queries = new IndexerQueries(db);
        queries.updateSubplebbitCacheMarkers({
            address,
            lastPostsPageCidNew: "QmPosts1",
            lastSubplebbitUpdatedAt: 5000,
            lastUpdateCid: "QmUpdate1",
            lastModQueuePendingApprovalPageCid: "QmModQueueCached"
        });

        // Verify getEnabledSubplebbits returns the field
        const subs = queries.getEnabledSubplebbits();
        const sub = subs.find((s) => s.address === address);
        expect(sub?.lastModQueuePendingApprovalPageCid).toBe("QmModQueueCached");
    });
});
