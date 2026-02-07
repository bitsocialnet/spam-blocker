import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { VerifyResponse } from "@easy-community-spam-blocker/shared";
import type { SpamDetectionDatabase } from "../db/index.js";
import { VerifyRequestSchema, type VerifyRequest } from "./schemas.js";
import { verifySignedRequest } from "../security/request-signature.js";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";

export interface VerifyRouteOptions {
    db: SpamDetectionDatabase;
}

/**
 * Register the /api/v1/challenge/verify route.
 */
export function registerVerifyRoute(fastify: FastifyInstance, options: VerifyRouteOptions): void {
    const { db } = options;

    fastify.post(
        "/api/v1/challenge/verify",
        async (request: FastifyRequest<{ Body: VerifyRequest }>, reply: FastifyReply): Promise<VerifyResponse> => {
            // Validate request body
            const parseResult = VerifyRequestSchema.safeParse(request.body);

            if (!parseResult.success) {
                reply.status(400);
                return {
                    success: false,
                    error: `Invalid request body: ${parseResult.error.issues.map((issue) => issue.message).join(", ")}`
                };
            }

            const { sessionId, signature, timestamp } = parseResult.data;

            // Validate request timestamp (protocol uses seconds)
            const nowSeconds = Math.floor(Date.now() / 1000);
            const maxSkewSeconds = 5 * 60;
            if (timestamp < nowSeconds - maxSkewSeconds || timestamp > nowSeconds + maxSkewSeconds) {
                reply.status(401);
                return {
                    success: false,
                    error: "Request timestamp is out of range"
                };
            }

            try {
                await verifySignedRequest({ sessionId, timestamp }, signature);
            } catch (error) {
                reply.status((error as { statusCode?: number }).statusCode ?? 401);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "Invalid signature"
                };
            }

            // Look up challenge session
            const session = db.getChallengeSessionBySessionId(sessionId);

            if (!session) {
                reply.status(404);
                return {
                    success: false,
                    error: "Challenge session not found"
                };
            }

            // Check if challenge has expired (internal timestamps are in milliseconds)
            if (session.expiresAt < Date.now()) {
                return {
                    success: false,
                    error: "Challenge session has expired"
                };
            }

            if (!session.subplebbitPublicKey) {
                reply.status(401);
                return {
                    success: false,
                    error: "Challenge session signature is missing"
                };
            }

            // Convert Uint8Array publicKey to base64 string for comparison with session
            const requestPublicKey = uint8ArrayToString(signature.publicKey, "base64");
            if (session.subplebbitPublicKey !== requestPublicKey) {
                reply.status(401);
                return {
                    success: false,
                    error: "Request signature does not match session"
                };
            }

            // Check challenge completion status (server-side tracking, no JWT needed)
            // These are expected business logic outcomes, not errors, so we return 200
            // to let the challenge package's verify() return {success: false} instead of throwing.
            if (session.status === "pending") {
                return {
                    success: false,
                    error: "Challenge not yet completed"
                };
            }

            if (session.status === "failed") {
                return {
                    success: false,
                    error: "Challenge failed"
                };
            }

            // session.status === "completed" - success!

            // Get iframe IP record if available
            const ipRecord = db.getIframeIpRecordBySessionId(sessionId); // TODO shouldn't it always be defined since /verify is called after iframe?

            // Build response with IP intelligence data if available
            const response: VerifyResponse = {
                success: true,
                challengeType: "turnstile" // TODO: Make this dynamic
            };

            if (ipRecord) {
                response.ipAddressCountry = ipRecord.countryCode ?? undefined;
                response.ipTypeEstimation = getIpTypeEstimation(ipRecord);

                // Calculate IP risk based on IP type
                response.ipRisk = calculateIpRisk(ipRecord);
            }

            return response;
        }
    );
}

/**
 * Get IP type estimation from IP record.
 */
function getIpTypeEstimation(ipRecord: {
    isVpn: number | null;
    isProxy: number | null;
    isTor: number | null;
    isDatacenter: number | null;
}): string {
    if (ipRecord.isTor) return "tor";
    if (ipRecord.isVpn) return "vpn";
    if (ipRecord.isProxy) return "proxy";
    if (ipRecord.isDatacenter) return "datacenter";
    // If all fields are null, we don't know the type
    if (ipRecord.isVpn === null && ipRecord.isProxy === null && ipRecord.isTor === null && ipRecord.isDatacenter === null) {
        return "unknown";
    }
    return "residential";
}

/**
 * Calculate IP risk based on IP type.
 */
function calculateIpRisk(ipRecord: {
    isVpn: number | null;
    isProxy: number | null;
    isTor: number | null;
    isDatacenter: number | null;
}): number {
    // Higher risk for anonymization services
    if (ipRecord.isTor) return 0.9;
    if (ipRecord.isVpn) return 0.6;
    if (ipRecord.isProxy) return 0.7;
    if (ipRecord.isDatacenter) return 0.5;
    // If all fields are null, return moderate risk (unknown)
    if (ipRecord.isVpn === null && ipRecord.isProxy === null && ipRecord.isTor === null && ipRecord.isDatacenter === null) {
        return 0.3;
    }
    return 0.1; // Residential IPs are low risk
}
