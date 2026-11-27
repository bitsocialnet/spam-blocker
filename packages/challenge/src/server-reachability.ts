import Logger from "@pkcprotocol/pkc-logger";

const log = Logger({ namespace: "bitsocial:community:challenge:spam-blocker:reachability" });

// A busy community probes about once a minute while the server is up, and sees a recovered server within 15 s.
const REACHABLE_TTL_MS = 60_000;
const UNREACHABLE_TTL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

const results = new Map<string, { reachable: boolean; checkedAt: number }>();
const probes = new Map<string, Promise<boolean>>();

// The server answers GET /health at its origin root (its challenge pages also call /api/v1 from the origin root,
// so a working serverUrl is always `<origin>/api/v1`). Anything but its JSON status, such as a parked or seized
// domain's page or a Cloudflare tunnel error, counts as unreachable.
const probe = async ({ healthUrl }: { healthUrl: string }): Promise<boolean> => {
    try {
        const response = await fetch(healthUrl, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
        });
        if (!response.ok) {
            log.error(`GET ${healthUrl} failed with status ${response.status}`);
            return false;
        }
        const body: unknown = await response.json();
        const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
        if (status === "ok" || status === "degraded") return true;
        log.error(`GET ${healthUrl} returned no Spam Blocker health status`);
        return false;
    } catch (error) {
        log.error(`GET ${healthUrl} failed: %s`, error instanceof Error ? error.message : String(error));
        return false;
    }
};

export const isServerReachable = async ({ serverUrl }: { serverUrl: string }): Promise<boolean> => {
    const healthUrl = new URL("/health", serverUrl).toString();
    const cached = results.get(healthUrl);
    if (cached && Date.now() - cached.checkedAt < (cached.reachable ? REACHABLE_TTL_MS : UNREACHABLE_TTL_MS)) {
        return cached.reachable;
    }
    let pending = probes.get(healthUrl);
    if (!pending) {
        pending = probe({ healthUrl }).then((reachable) => {
            results.set(healthUrl, { reachable, checkedAt: Date.now() });
            probes.delete(healthUrl);
            return reachable;
        });
        probes.set(healthUrl, pending);
    }
    return pending;
};

export const resetServerReachabilityCache = () => {
    results.clear();
    probes.clear();
};
