import type { SpamDetectionDatabase } from "../db/index.js";
import { fetchIpApi, type IpApiResult } from "./ipapi.js";

const DEFAULT_TIMEOUT_MS = 3000;

export async function refreshIpIntelIfNeeded(params: {
    db: SpamDetectionDatabase;
    sessionId: string;
    apiKey?: string;
    timeoutMs?: number;
}): Promise<IpApiResult | null> {
    const { db, sessionId, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

    const record = db.getIframeIpRecordBySessionId(sessionId);
    if (!record) {
        return null;
    }

    // Skip if we already have intelligence data
    if (record.isVpn !== null || record.isProxy !== null || record.isTor !== null || record.isDatacenter !== null) {
        return null;
    }

    const intel = await fetchIpApi({ ipAddress: record.ipAddress, apiKey, timeoutMs });
    if (!intel) {
        return null;
    }

    const now = Math.floor(Date.now() / 1000);
    db.updateIframeIpRecordIntelligence(sessionId, {
        isVpn: intel.isVpn,
        isProxy: intel.isProxy,
        isTor: intel.isTor,
        isDatacenter: intel.isDatacenter,
        countryCode: intel.countryCode,
        timestamp: now
    });

    return intel;
}
