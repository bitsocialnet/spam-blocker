import type { CommunityChallengeSetting } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";
import type { LocalCommunity } from "@pkcprotocol/pkc-js/dist/node/runtime/node/community/local-community.js";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPublicKeyFromPrivateKey } from "../src/pkc-js-signer.js";
import type { EvaluateResponse, VerifyResponse } from "@bitsocial/spam-blocker-shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ChallengeFileFactory from "../src/index.js";
import * as cborg from "cborg";
import path from "node:path";

type MockResponseOptions = {
    ok?: boolean;
    status?: number;
    jsonThrows?: boolean;
};
const LEGACY_RUNTIME_COMMUNITY_KEY = String.fromCharCode(115, 117, 98, 112, 108, 101, 98, 98, 105, 116);

const createResponse = (body: unknown, options: MockResponseOptions = {}) => {
    const { ok = true, status = 200, jsonThrows = false } = options;
    return {
        ok,
        status,
        json: jsonThrows ? vi.fn().mockRejectedValue(new Error("bad json")) : vi.fn().mockResolvedValue(body)
    };
};

const stubFetch = (...responses: Array<ReturnType<typeof createResponse>>) => {
    const fetchMock = vi.fn();
    for (const response of responses) {
        fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
};

const createEvaluateResponse = (overrides: Partial<EvaluateResponse> = {}): EvaluateResponse => ({
    riskScore: 0.5,
    explanation: "OK",
    sessionId: "challenge-123",
    challengeUrl: "https://spamblocker.bitsocial.net/api/v1/iframe/challenge-123",
    challengeExpiresAt: 1710000000,
    ...overrides
});

const createVerifyResponse = (overrides: Partial<VerifyResponse> = {}): VerifyResponse => ({
    success: true,
    ...overrides
});

const request = {} as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
const testPrivateKey = Buffer.alloc(32, 7).toString("base64");
let community: LocalCommunity;

beforeAll(async () => {
    const publicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
    community = {
        signer: {
            privateKey: testPrivateKey,
            publicKey,
            type: "ed25519"
        }
    } as LocalCommunity;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Bitsocial Spam Blocker challenge package", () => {
    it("exposes metadata and option inputs", () => {
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        expect(challengeFile.type).toBe("url/iframe");
        expect(challengeFile.description).toMatch(/Bitsocial Spam Blocker/i);
        expect(challengeFile.optionInputs.some((input) => input.option === "serverUrl")).toBe(true);
    });

    it("auto-accepts low risk scores using the default serverUrl", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(result).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://spamblocker.bitsocial.net/api/v1/evaluate",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("accepts the daemon runtime community argument when the PKC-named field is missing", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community: undefined as never,
            [LEGACY_RUNTIME_COMMUNITY_KEY]: community
        } as never);

        expect(result).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("wraps evaluate requests with the challengeRequest payload", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        // Decode CBOR body from Buffer
        const bodyBuffer = fetchMock.mock.calls[0]?.[1]?.body as Buffer;
        const payload = cborg.decode(bodyBuffer);

        expect(payload).toEqual(
            expect.objectContaining({
                challengeRequest: request,
                timestamp: expect.any(Number),
                signature: expect.objectContaining({
                    publicKey: expect.any(Uint8Array), // Now a Uint8Array, not base64 string
                    type: "ed25519",
                    signedPropertyNames: ["challengeRequest", "timestamp"],
                    signature: expect.any(Uint8Array) // Now a Uint8Array, not base64 string
                })
            })
        );
    });

    it.each(["commentEdit", "commentModeration", "communityEdit"] as const)(
        "auto-accepts %s requests without spam evaluation",
        async (publicationType) => {
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
            const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

            const result = await challengeFile.getChallenge({
                challengeSettings: { options: {} } as CommunityChallengeSetting,
                challengeRequestMessage: { [publicationType]: {} } as unknown as DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
                challengeIndex: 0,
                community
            });

            expect(result).toEqual({ success: true });
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );

    it("auto-rejects when riskScore meets the reject threshold", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.8, explanation: "Too risky" })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            success: false,
            error: "Rejected by Bitsocial Spam Blocker (riskScore 0.80). Too risky"
        });
    });

    it("returns a challenge and calls verify endpoint with sessionId", async () => {
        const evaluateResponse = createEvaluateResponse({ riskScore: 0.5 });
        const fetchMock = stubFetch(createResponse(evaluateResponse), createResponse(createVerifyResponse()));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        // Answer is ignored - server tracks completion state
        const verifyResult = await result.verify("");
        expect(verifyResult).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // Decode CBOR body from Buffer
        const bodyBuffer = fetchMock.mock.calls[1]?.[1]?.body as Buffer;
        const verifyBody = cborg.decode(bodyBuffer);
        expect(verifyBody).toEqual(
            expect.objectContaining({
                sessionId: evaluateResponse.sessionId,
                timestamp: expect.any(Number),
                signature: expect.objectContaining({
                    publicKey: expect.any(Uint8Array),
                    type: "ed25519",
                    signedPropertyNames: ["sessionId", "timestamp"],
                    signature: expect.any(Uint8Array)
                })
            })
        );
        // No token in the request
        expect(verifyBody.token).toBeUndefined();
    });

    it("returns failure when user submits without completing challenge", async () => {
        const fetchMock = stubFetch(
            createResponse(createEvaluateResponse({ riskScore: 0.5 })),
            createResponse(createVerifyResponse({ success: false, error: "Challenge not yet completed" }))
        );
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        // verify() must return {success: false, error} (not throw) for expected server failures
        const verifyResult = await result.verify("");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(verifyResult).toEqual({ success: false, error: "Challenge not yet completed" });
    });

    it("surfaces verification failures from the server", async () => {
        const fetchMock = stubFetch(
            createResponse(createEvaluateResponse({ riskScore: 0.5 })),
            createResponse(createVerifyResponse({ success: false, error: "Nope" }))
        );
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(verifyResult).toEqual({ success: false, error: "Nope" });
    });

    it("rejects by IP risk policy when configured", async () => {
        stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.5 })), createResponse(createVerifyResponse({ ipRisk: 0.7 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { maxIpRisk: "0.4" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({
            success: false,
            error: "Rejected by IP risk policy (ipRisk 0.70)."
        });
    });

    it("rejects by country blacklist when configured", async () => {
        stubFetch(
            createResponse(createEvaluateResponse({ riskScore: 0.5 })),
            createResponse(createVerifyResponse({ ipAddressCountry: "us" }))
        );
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { countryBlacklist: "us, ca" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({
            success: false,
            error: "Rejected by country policy (US)."
        });
    });

    it.each([
        ["vpn", { blockVpn: "true" }, "Rejected by IP policy (VPN)."],
        ["proxy", { blockProxy: "true" }, "Rejected by IP policy (proxy)."],
        ["tor", { blockTor: "true" }, "Rejected by IP policy (Tor)."],
        ["datacenter", { blockDatacenter: "true" }, "Rejected by IP policy (datacenter)."]
    ])("rejects by ipTypeEstimation '%s' when configured", async (ipType, options, expected) => {
        stubFetch(
            createResponse(createEvaluateResponse({ riskScore: 0.5 })),
            createResponse(createVerifyResponse({ ipTypeEstimation: ipType }))
        );
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: false, error: expected });
    });

    it("accepts verification when no post-challenge policy triggers", async () => {
        stubFetch(
            createResponse(createEvaluateResponse({ riskScore: 0.5 })),
            createResponse(
                createVerifyResponse({
                    ipRisk: 0.2,
                    ipAddressCountry: "US",
                    ipTypeEstimation: "vpn"
                })
            )
        );
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: true });
    });

    it("normalizes serverUrl before calling the API", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        await challengeFile.getChallenge({
            challengeSettings: { options: { serverUrl: "https://example.com/api///" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(fetchMock).toHaveBeenCalledWith("https://example.com/api/evaluate", expect.any(Object));
    });

    it("returns {success:false} on invalid evaluate responses", async () => {
        stubFetch(createResponse(createEvaluateResponse({ riskScore: 2 }) as unknown as EvaluateResponse));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(result).toHaveProperty("success", false);
        expect((result as any).error).toMatch(/Invalid evaluate response/i);
    });

    it("returns {success:false} on invalid verify responses", async () => {
        stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.5 })), createResponse({}));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toHaveProperty("success", false);
        expect((verifyResult as any).error).toMatch(/Invalid verify response/i);
    });

    it("returns {success:false} on server errors with JSON details", async () => {
        stubFetch(createResponse({ error: "boom" }, { ok: false, status: 500 }));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(result).toHaveProperty("success", false);
        expect((result as any).error).toMatch(/Bitsocial Spam Blocker server error \(500\).*boom/i);
    });

    it("returns {success:false} when the server returns invalid JSON", async () => {
        stubFetch(createResponse(undefined, { ok: true, jsonThrows: true }));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(result).toHaveProperty("success", false);
        expect((result as any).error).toMatch(/Invalid JSON response/i);
    });

    it("does not expose serverUrl or options in the public community challenge record", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const challengePath = path.resolve(__dirname, "../dist/index.js");

        const require = createRequire(import.meta.url);
        const pkcJsDir = path.dirname(require.resolve("@pkcprotocol/pkc-js"));
        const pkcJsChallengesPath = path.join(pkcJsDir, "runtime/node/community/challenges/index.js");
        const { getCommunityChallengeFromCommunityChallengeSettings } = await import(pathToFileURL(pkcJsChallengesPath).href);

        const { communityChallenge: publicChallenge } = await getCommunityChallengeFromCommunityChallengeSettings({
            communityChallengeSettings: {
                path: challengePath,
                options: {
                    serverUrl: "https://secret-server.example.com/api/v1",
                    autoAcceptThreshold: "0.3",
                    autoRejectThreshold: "0.9",
                    countryBlacklist: "RU,CN"
                }
            }
        });

        // The public challenge should only contain these fields
        expect(publicChallenge.type).toBe("url/iframe");
        expect(publicChallenge.description).toMatch(/Bitsocial/i);

        // options and serverUrl must NOT be in the public record
        const serialized = JSON.stringify(publicChallenge);
        expect(serialized).not.toContain("secret-server.example.com");
        expect(serialized).not.toContain("serverUrl");
        expect(serialized).not.toContain("autoAcceptThreshold");
        expect(serialized).not.toContain("autoRejectThreshold");
        expect(serialized).not.toContain("countryBlacklist");

        // Verify the object does not have an "options" key
        expect(publicChallenge).not.toHaveProperty("options");
    });
});
