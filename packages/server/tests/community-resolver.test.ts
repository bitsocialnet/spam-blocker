import { afterEach, describe, expect, it, vi } from "vitest";
import {
    resolveCommunityPublicKey as resolveCommunityPublicKey,
    resetPkcLoaderForTest as resetCommunityLoaderForTest
} from "../src/community-resolver.js";

afterEach(() => {
    resetCommunityLoaderForTest();
    vi.useRealTimers();
});

describe("community resolver cache", () => {
    it("caches community public keys for 12 hours", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

        const getCommunity = vi.fn().mockResolvedValue({ signature: { publicKey: "pk-1" } });
        const mockCommunityClient = { getCommunity } as never;

        const first = await resolveCommunityPublicKey("sub.eth", mockCommunityClient);
        expect(first).toBe("pk-1");
        expect(getCommunity).toHaveBeenCalledTimes(1);

        const second = await resolveCommunityPublicKey("sub.eth", mockCommunityClient);
        expect(second).toBe("pk-1");
        expect(getCommunity).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(11 * 60 * 60 * 1000);
        const third = await resolveCommunityPublicKey("sub.eth", mockCommunityClient);
        expect(third).toBe("pk-1");
        expect(getCommunity).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(60 * 60 * 1000 + 1);
        const fourth = await resolveCommunityPublicKey("sub.eth", mockCommunityClient);
        expect(fourth).toBe("pk-1");
        expect(getCommunity).toHaveBeenCalledTimes(2);
    });

    it("does not cache missing public keys", async () => {
        const getCommunity = vi
            .fn()
            .mockResolvedValueOnce({ signature: {} })
            .mockResolvedValueOnce({ signature: { publicKey: "pk-2" } });
        const mockCommunityClient = { getCommunity } as never;

        await expect(resolveCommunityPublicKey("sub.eth", mockCommunityClient)).rejects.toThrow(
            "Community signature public key is unavailable"
        );
        expect(getCommunity).toHaveBeenCalledTimes(1);

        const result = await resolveCommunityPublicKey("sub.eth", mockCommunityClient);
        expect(result).toBe("pk-2");
        expect(getCommunity).toHaveBeenCalledTimes(2);
    });
});
