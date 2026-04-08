import { afterEach, beforeEach, vi } from "vitest";
import {
    resetPkcLoaderForTest as resetCommunityLoaderForTest,
    setPkcLoaderForTest as setCommunityLoaderForTest
} from "../src/community-resolver.js";

const createDefaultCommunityStub = () => ({
    destroy: vi.fn().mockResolvedValue(undefined),
    getCommunity: vi.fn(async ({ address }: { address: string }) => ({
        address,
        signature: {
            publicKey: `stub-public-key:${address}`
        }
    }))
});

beforeEach(() => {
    setCommunityLoaderForTest(async () => createDefaultCommunityStub());
});

afterEach(() => {
    resetCommunityLoaderForTest();
});
