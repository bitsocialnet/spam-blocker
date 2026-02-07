import type { FastifyRequest } from "fastify";

/**
 * Get client IP address from request.
 * Checks common proxy headers before falling back to direct connection IP.
 */
export function getClientIp(request: FastifyRequest): string | undefined {
    // Check common proxy headers
    const forwarded = request.headers["x-forwarded-for"];
    if (forwarded) {
        const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return ips.split(",")[0].trim();
    }

    const realIp = request.headers["x-real-ip"];
    if (realIp) {
        return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // Fall back to direct connection IP
    return request.ip;
}
