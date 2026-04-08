import { afterEach, beforeEach, vi } from "vitest";
import { resetPlebbitLoaderForTest, setPlebbitLoaderForTest } from "../src/subplebbit-resolver.js";

const createDefaultPlebbitStub = () => ({
    destroy: vi.fn().mockResolvedValue(undefined),
    getSubplebbit: vi.fn(async ({ address }: { address: string }) => ({
        address,
        signature: {
            publicKey: `stub-public-key:${address}`
        }
    }))
});

beforeEach(() => {
    setPlebbitLoaderForTest(async () => createDefaultPlebbitStub());
});

afterEach(() => {
    resetPlebbitLoaderForTest();
});
