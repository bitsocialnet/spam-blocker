import type { RiskFactor } from "../types.js";

// TODO if ip is IP_TYPE_SCORES.RESIDENTIAL and it's the first time we see then it's probably a good thing and it's not a spam
// if the same author using the IP address is not changing their IP address it's also a good thing
// let me know if you have better thoughts of critque of this file

/**
 * IP intelligence data from the IP provider.
 */
export interface IpIntelligence {
    isVpn?: boolean;
    isProxy?: boolean;
    isTor?: boolean;
    isDatacenter?: boolean;
    countryCode?: string;
}

/**
 * Risk scores for different IP types.
 */
const IP_TYPE_SCORES = {
    /** Tor exit nodes are highest risk */
    TOR: 1,
    /** Known proxy servers */
    PROXY: 1,
    /** VPN services */
    VPN: 1,
    /** Datacenter IPs (often used for bots) */
    DATACENTER: 1,
    /** Residential IP (normal user) */
    RESIDENTIAL: 0.2
};

/**
 * Calculate risk score based on IP intelligence.
 *
 * This factor is only applied when IP information is available
 * (typically after the user accesses the challenge iframe).
 *
 * Factors considered:
 * - Tor exit node detection
 * - Proxy detection
 * - VPN detection
 * - Datacenter IP detection
 *
 * Note: IP intelligence is best-effort and can have false positives.
 * Residential IPs can be misclassified, and VPN detection is imperfect.
 */
export function calculateIpRisk(ipIntel: IpIntelligence | undefined, weight: number): RiskFactor {
    // If no IP intelligence available, return neutral score with zero weight
    if (!ipIntel) {
        return {
            name: "ipRisk",
            score: 0.5,
            weight: 0, // No weight when we don't have data
            explanation: "IP risk: no IP intelligence available"
        };
    }

    let score: number;
    const issues: string[] = [];

    // Check for anonymization services (highest risk first)
    if (ipIntel.isTor) {
        score = IP_TYPE_SCORES.TOR;
        issues.push("Tor exit node");
    } else if (ipIntel.isProxy) {
        score = IP_TYPE_SCORES.PROXY;
        issues.push("proxy server");
    } else if (ipIntel.isVpn) {
        score = IP_TYPE_SCORES.VPN;
        issues.push("VPN");
    } else if (ipIntel.isDatacenter) {
        score = IP_TYPE_SCORES.DATACENTER;
        issues.push("datacenter IP");
    } else {
        // Appears to be a residential IP
        score = IP_TYPE_SCORES.RESIDENTIAL;
        issues.push("residential IP");
    }

    const explanation = `IP risk: ${issues.join(", ")}`;

    return {
        name: "ipRisk",
        score,
        weight,
        explanation
    };
}

/**
 * Estimate IP type based on intelligence flags.
 */
export function estimateIpType(ipIntel: IpIntelligence | undefined): "residential" | "vpn" | "proxy" | "tor" | "datacenter" | "unknown" {
    if (!ipIntel) return "unknown";
    if (ipIntel.isTor) return "tor";
    if (ipIntel.isProxy) return "proxy";
    if (ipIntel.isVpn) return "vpn";
    if (ipIntel.isDatacenter) return "datacenter";
    return "residential";
}
