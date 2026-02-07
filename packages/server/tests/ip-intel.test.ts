import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db/index.js";
import { refreshIpIntelIfNeeded } from "../src/ip-intel/index.js";

describe("IP intelligence", () => {
    let db: ReturnType<typeof createDatabase>;
    let originalFetch: typeof fetch;
    const subplebbitPublicKey = "test-public-key";

    beforeEach(() => {
        db = createDatabase(":memory:");
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        db.close();
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("stores ipapi.is results and updates timestamp", async () => {
        // First create a challenge session
        db.insertChallengeSession({
            sessionId: "challenge",
            subplebbitPublicKey,
            expiresAt: Math.floor(Date.now() / 1000) + 3600
        });

        // Then create an iframe IP record
        const now = Math.floor(Date.now() / 1000);
        db.insertIframeIpRecord({
            sessionId: "challenge",
            ipAddress: "1.1.1.1",
            timestamp: now
        });

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    location: { country_code: "DE" },
                    is_vpn: true,
                    is_proxy: false,
                    is_tor: true,
                    is_datacenter: false
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            )
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await refreshIpIntelIfNeeded({
            db,
            sessionId: "challenge",
            apiKey: "test-key"
        });

        const record = db.getIframeIpRecordBySessionId("challenge");
        expect(record?.countryCode).toBe("DE");
        expect(record?.isVpn).toBe(1);
        expect(record?.isProxy).toBe(0);
        expect(record?.isTor).toBe(1);
        expect(record?.isDatacenter).toBe(0);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0]?.[0]);
        expect(url).toContain("https://api.ipapi.is");
        expect(url).toContain("q=1.1.1.1");
        expect(url).toContain("key=test-key");
    });

    it("works without an API key", async () => {
        db.insertChallengeSession({
            sessionId: "challenge-no-key",
            subplebbitPublicKey,
            expiresAt: Math.floor(Date.now() / 1000) + 3600
        });

        const now = Math.floor(Date.now() / 1000);
        db.insertIframeIpRecord({
            sessionId: "challenge-no-key",
            ipAddress: "8.8.8.8",
            timestamp: now
        });

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    location: { country_code: "US" },
                    is_vpn: false,
                    is_proxy: false,
                    is_tor: false,
                    is_datacenter: true
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            )
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await refreshIpIntelIfNeeded({
            db,
            sessionId: "challenge-no-key"
        });

        const record = db.getIframeIpRecordBySessionId("challenge-no-key");
        expect(record?.countryCode).toBe("US");
        expect(record?.isVpn).toBe(0);
        expect(record?.isDatacenter).toBe(1);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0]?.[0]);
        expect(url).toContain("https://api.ipapi.is");
        expect(url).toContain("q=8.8.8.8");
        expect(url).not.toContain("key=");
    });

    it("stores null flags when ipapi.is response lacks detection fields", async () => {
        db.insertChallengeSession({
            sessionId: "challenge-no-privacy",
            subplebbitPublicKey,
            expiresAt: Math.floor(Date.now() / 1000) + 3600
        });

        const now = Math.floor(Date.now() / 1000);
        db.insertIframeIpRecord({
            sessionId: "challenge-no-privacy",
            ipAddress: "3.3.3.3",
            timestamp: now
        });

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    location: { country_code: "US" }
                    // no is_vpn, is_tor, etc.
                }),
                { status: 200, headers: { "content-type": "application/json" } }
            )
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await refreshIpIntelIfNeeded({
            db,
            sessionId: "challenge-no-privacy"
        });

        const record = db.getIframeIpRecordBySessionId("challenge-no-privacy");
        expect(record?.countryCode).toBe("US");
        // All privacy flags should be null (unknown), not 0 (false)
        expect(record?.isVpn).toBeNull();
        expect(record?.isProxy).toBeNull();
        expect(record?.isTor).toBeNull();
        expect(record?.isDatacenter).toBeNull();
    });

    it("skips lookup when intel data already exists", async () => {
        // First create a challenge session
        db.insertChallengeSession({
            sessionId: "challenge2",
            subplebbitPublicKey,
            expiresAt: Math.floor(Date.now() / 1000) + 3600
        });

        // Create an iframe IP record with intel data already populated
        const now = Math.floor(Date.now() / 1000);
        db.insertIframeIpRecord({
            sessionId: "challenge2",
            ipAddress: "2.2.2.2",
            isVpn: false,
            timestamp: now
        });

        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await refreshIpIntelIfNeeded({
            db,
            sessionId: "challenge2",
            apiKey: "test-key"
        });

        // Should not call fetch because intel data already exists
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
