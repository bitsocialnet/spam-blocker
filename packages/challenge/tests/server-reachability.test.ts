import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isServerReachable, resetServerReachabilityCache } from "../src/server-reachability.js";

const serverUrl = "https://spamblocker.example/api/v1";

const healthResponse = (body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) => ({
    ok,
    status,
    json: async () => body
});

const stubFetch = (implementation: (...args: unknown[]) => unknown) => {
    const fetchMock = vi.fn(implementation);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
};

describe("isServerReachable", () => {
    beforeEach(() => {
        resetServerReachabilityCache();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("probes GET /health at the server's origin root", async () => {
        const fetchMock = stubFetch(async () => healthResponse({ status: "ok" }));

        expect(await isServerReachable({ serverUrl })).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://spamblocker.example/health");
    });

    it("counts a degraded server as reachable", async () => {
        stubFetch(async () => healthResponse({ status: "degraded" }));

        expect(await isServerReachable({ serverUrl })).toBe(true);
    });

    it.each([
        ["the request fails", async () => Promise.reject(new TypeError("fetch failed"))],
        ["a Cloudflare tunnel error", async () => healthResponse(undefined, { ok: false, status: 530 })],
        ["a page that is not JSON", async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad json")) })],
        ["JSON without a health status", async () => healthResponse({ message: "This domain has been seized" })]
    ])("is unreachable when %s", async (_name, implementation) => {
        stubFetch(implementation);

        expect(await isServerReachable({ serverUrl })).toBe(false);
    });

    it("reuses a reachable result for 60 seconds", async () => {
        const fetchMock = stubFetch(async () => healthResponse({ status: "ok" }));

        await isServerReachable({ serverUrl });
        vi.setSystemTime(Date.now() + 59_000);
        await isServerReachable({ serverUrl });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 2_000);
        await isServerReachable({ serverUrl });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("probes again 15 seconds after an unreachable result", async () => {
        const fetchMock = stubFetch(async () => Promise.reject(new TypeError("fetch failed")));

        expect(await isServerReachable({ serverUrl })).toBe(false);
        vi.setSystemTime(Date.now() + 14_000);
        expect(await isServerReachable({ serverUrl })).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockImplementation(async () => healthResponse({ status: "ok" }));
        vi.setSystemTime(Date.now() + 2_000);
        expect(await isServerReachable({ serverUrl })).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("shares one probe between concurrent calls", async () => {
        const fetchMock = stubFetch(async () => healthResponse({ status: "ok" }));

        const results = await Promise.all([isServerReachable({ serverUrl }), isServerReachable({ serverUrl })]);

        expect(results).toEqual([true, true]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
