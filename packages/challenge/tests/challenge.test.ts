import type { SubplebbitChallengeSetting } from "@plebbit/plebbit-js/dist/node/subplebbit/types.js";
import type { DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor } from "@plebbit/plebbit-js/dist/node/pubsub-messages/types.js";
import type { LocalSubplebbit } from "@plebbit/plebbit-js/dist/node/runtime/node/subplebbit/local-subplebbit.js";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPublicKeyFromPrivateKey } from "../src/plebbit-js-signer.js";
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

const request = {} as DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
const testPrivateKey = Buffer.alloc(32, 7).toString("base64");
let subplebbit: LocalSubplebbit;

beforeAll(async () => {
    const publicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
    subplebbit = {
        signer: {
            privateKey: testPrivateKey,
            publicKey,
            type: "ed25519"
        }
    } as LocalSubplebbit;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("BitsocialSpamBlocker challenge package", () => {
    it("exposes metadata and option inputs", () => {
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        expect(challengeFile.type).toBe("url/iframe");
        expect(challengeFile.description).toMatch(/BitsocialSpamBlocker/i);
        expect(challengeFile.optionInputs.some((input) => input.option === "serverUrl")).toBe(true);
    });

    it("auto-accepts low risk scores using the default serverUrl", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
        });

        expect(result).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://spamblocker.bitsocial.net/api/v1/evaluate",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("wraps evaluate requests with the challengeRequest payload", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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

    it("auto-rejects when riskScore meets the reject threshold", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.8, explanation: "Too risky" })));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            success: false,
            error: "Rejected by BitsocialSpamBlocker (riskScore 0.80). Too risky"
        });
    });

    it("returns a challenge and calls verify endpoint with sessionId", async () => {
        const evaluateResponse = createEvaluateResponse({ riskScore: 0.5 });
        const fetchMock = stubFetch(createResponse(evaluateResponse), createResponse(createVerifyResponse()));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { maxIpRisk: "0.4" } } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { countryBlacklist: "us, ca" } } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
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
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: true });
    });

    it("normalizes serverUrl before calling the API", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.1 })));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        await challengeFile.getChallenge({
            challengeSettings: { options: { serverUrl: "https://example.com/api///" } } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
        });

        expect(fetchMock).toHaveBeenCalledWith("https://example.com/api/evaluate", expect.any(Object));
    });

    it("throws on invalid evaluate responses", async () => {
        stubFetch(createResponse(createEvaluateResponse({ riskScore: 2 }) as unknown as EvaluateResponse));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        await expect(
            challengeFile.getChallenge({
                challengeSettings: { options: {} } as SubplebbitChallengeSetting,
                challengeRequestMessage: request,
                challengeIndex: 0,
                subplebbit
            })
        ).rejects.toThrow(/Invalid evaluate response/i);
    });

    it("throws on invalid verify responses", async () => {
        stubFetch(createResponse(createEvaluateResponse({ riskScore: 0.5 })), createResponse({}));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as SubplebbitChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            subplebbit
        });

        if (!("verify" in result)) {
            throw new Error("Expected a challenge response");
        }

        await expect(result.verify("token")).rejects.toThrow(/Invalid verify response/i);
    });

    it("throws on server errors with JSON details", async () => {
        stubFetch(createResponse({ error: "boom" }, { ok: false, status: 500 }));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        await expect(
            challengeFile.getChallenge({
                challengeSettings: { options: {} } as SubplebbitChallengeSetting,
                challengeRequestMessage: request,
                challengeIndex: 0,
                subplebbit
            })
        ).rejects.toThrow(/BitsocialSpamBlocker server error \(500\).*boom/i);
    });

    it("throws when the server returns invalid JSON", async () => {
        stubFetch(createResponse(undefined, { ok: true, jsonThrows: true }));
        const challengeFile = ChallengeFileFactory({} as SubplebbitChallengeSetting);

        await expect(
            challengeFile.getChallenge({
                challengeSettings: { options: {} } as SubplebbitChallengeSetting,
                challengeRequestMessage: request,
                challengeIndex: 0,
                subplebbit
            })
        ).rejects.toThrow(/Invalid JSON response/i);
    });

    it("does not expose serverUrl or options in the public subplebbit challenge record", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const challengePath = path.resolve(__dirname, "../dist/index.js");

        const require = createRequire(import.meta.url);
        const plebbitJsDir = path.dirname(require.resolve("@plebbit/plebbit-js"));
        const plebbitJsChallengesPath = path.join(plebbitJsDir, "runtime/node/subplebbit/challenges/index.js");
        const { getSubplebbitChallengeFromSubplebbitChallengeSettings } = await import(pathToFileURL(plebbitJsChallengesPath).href);

        const publicChallenge = await getSubplebbitChallengeFromSubplebbitChallengeSettings({
            path: challengePath,
            options: {
                serverUrl: "https://secret-server.example.com/api/v1",
                autoAcceptThreshold: "0.3",
                autoRejectThreshold: "0.9",
                countryBlacklist: "RU,CN"
            }
        });

        // The public challenge should only contain these fields
        expect(publicChallenge.type).toBe("url/iframe");
        expect(publicChallenge.description).toMatch(/BitsocialSpamBlocker/i);

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
