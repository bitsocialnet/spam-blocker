import type { CommunityChallengeSetting } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import type { DecryptedChallengeRequestMessageTypeWithCommunityAuthor } from "@pkcprotocol/pkc-js/dist/node/pubsub-messages/types.js";
import type { LocalCommunity } from "@pkcprotocol/pkc-js/dist/node/runtime/node/community/local-community.js";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPublicKeyFromPrivateKey } from "../src/pkc-js-signer.js";
import type { VerifyResponse } from "@bitsocial/spam-blocker-shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ChallengeFileFactory from "../src/index.js";
import * as cborg from "cborg";
import * as ed from "@noble/ed25519";
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

const decodeBase64Url = (value: string) => {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    return Buffer.from(base64, "base64");
};

const getLazyChallengeParts = (challengeUrl: string) => {
    const url = new URL(challengeUrl);
    const pathMatch = url.pathname.match(/\/iframe\/([^/]+)\/lazy$/);
    const payload = new URLSearchParams(url.hash.slice(1)).get("payload");
    if (!pathMatch?.[1] || !payload) {
        throw new Error(`Invalid lazy challenge URL: ${challengeUrl}`);
    }

    return {
        sessionId: decodeURIComponent(pathMatch[1]),
        payload: cborg.decode(decodeBase64Url(payload))
    };
};

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

    it("returns a lazy iframe challenge without calling the server before user consent", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        expect(fetchMock).not.toHaveBeenCalled();
        if ("success" in result) {
            throw new Error("Expected a lazy challenge response");
        }
        expect(result.type).toBe("url/iframe");
        expect(result.challenge).toMatch(/^https:\/\/spamblocker\.bitsocial\.net\/api\/v1\/iframe\/[^/]+\/lazy#payload=/);

        const { sessionId, payload } = getLazyChallengeParts(result.challenge);
        expect(payload).toEqual(
            expect.objectContaining({
                challengeRequest: request,
                sessionId,
                evaluationOptions: {
                    autoAcceptThreshold: 0.2,
                    autoRejectThreshold: 0.8
                },
                timestamp: expect.any(Number),
                signature: expect.objectContaining({
                    publicKey: expect.any(Uint8Array),
                    type: "ed25519",
                    signedPropertyNames: ["challengeRequest", "sessionId", "evaluationOptions", "timestamp"],
                    signature: expect.any(Uint8Array)
                })
            })
        );
    });

    it("accepts the daemon runtime community argument when the PKC-named field is missing", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community: undefined as never,
            [LEGACY_RUNTIME_COMMUNITY_KEY]: community
        } as never);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toHaveProperty("challenge");
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

    it("normalizes serverUrl in the lazy challenge URL and verify endpoint", async () => {
        const fetchMock = stubFetch(createResponse(createVerifyResponse()));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { serverUrl: "https://example.com/api///" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        expect(result.challenge).toMatch(/^https:\/\/example\.com\/api\/iframe\/[^/]+\/lazy#payload=/);

        await result.verify("");
        expect(fetchMock).toHaveBeenCalledWith("https://example.com/api/challenge/verify", expect.any(Object));
    });

    it("calls verify endpoint with the locally generated sessionId", async () => {
        const fetchMock = stubFetch(createResponse(createVerifyResponse()));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const { sessionId } = getLazyChallengeParts(result.challenge);
        const verifyResult = await result.verify("");
        expect(verifyResult).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const bodyBuffer = fetchMock.mock.calls[0]?.[1]?.body as Buffer;
        const verifyBody = cborg.decode(bodyBuffer);
        expect(verifyBody).toEqual(
            expect.objectContaining({
                sessionId,
                timestamp: expect.any(Number),
                signature: expect.objectContaining({
                    publicKey: expect.any(Uint8Array),
                    type: "ed25519",
                    signedPropertyNames: ["sessionId", "timestamp"],
                    signature: expect.any(Uint8Array)
                })
            })
        );
        expect(verifyBody.token).toBeUndefined();
    });

    it("returns failure when user submits without completing challenge", async () => {
        stubFetch(createResponse(createVerifyResponse({ success: false, error: "Challenge not yet completed" })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("");
        expect(verifyResult).toEqual({ success: false, error: "Challenge not yet completed" });
    });

    it("surfaces verification failures from the server", async () => {
        stubFetch(createResponse(createVerifyResponse({ success: false, error: "Nope" })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: false, error: "Nope" });
    });

    it("rejects by IP risk policy when configured", async () => {
        stubFetch(createResponse(createVerifyResponse({ ipRisk: 0.7 })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { maxIpRisk: "0.4" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({
            success: false,
            error: "Rejected by IP risk policy (ipRisk 0.70)."
        });
    });

    it("rejects by country blacklist when configured", async () => {
        stubFetch(createResponse(createVerifyResponse({ ipAddressCountry: "us" })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: { countryBlacklist: "us, ca" } } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
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
        stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: ipType })));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: false, error: expected });
    });

    it("accepts verification when no post-challenge policy triggers", async () => {
        stubFetch(
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

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toEqual({ success: true });
    });

    it("returns {success:false} on invalid verify responses", async () => {
        stubFetch(createResponse({}));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toHaveProperty("success", false);
        expect((verifyResult as any).error).toMatch(/Invalid verify response/i);
    });

    it("returns {success:false} on verify server errors with JSON details", async () => {
        stubFetch(createResponse({ error: "boom" }, { ok: false, status: 500 }));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toHaveProperty("success", false);
        expect((verifyResult as any).error).toMatch(/Bitsocial Spam Blocker server error \(500\).*boom/i);
    });

    it("returns {success:false} when verify returns invalid JSON", async () => {
        stubFetch(createResponse(undefined, { ok: true, jsonThrows: true }));
        const challengeFile = ChallengeFileFactory({} as CommunityChallengeSetting);

        const result = await challengeFile.getChallenge({
            challengeSettings: { options: {} } as CommunityChallengeSetting,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });

        if ("success" in result) {
            throw new Error("Expected a challenge response");
        }

        const verifyResult = await result.verify("token");
        expect(verifyResult).toHaveProperty("success", false);
        expect((verifyResult as any).error).toMatch(/Invalid JSON response/i);
    });

    it("publishes only the pre-check URL, not the options, in the public community challenge record", async () => {
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

        expect(publicChallenge.type).toBe("url/iframe");
        expect(publicChallenge.description).toMatch(/Bitsocial/i);
        expect(publicChallenge.challenge).toBe("https://secret-server.example.com/api/v1/precheck");

        const serialized = JSON.stringify({ ...publicChallenge, challenge: undefined });
        expect(serialized).not.toContain("secret-server.example.com");
        expect(serialized).not.toContain("serverUrl");
        expect(serialized).not.toContain("autoAcceptThreshold");
        expect(serialized).not.toContain("autoRejectThreshold");
        expect(serialized).not.toContain("countryBlacklist");
        expect(publicChallenge).not.toHaveProperty("options");
    });
});

describe("pre-check pass", () => {
    const pass = "precheck-0b6c3f5e-8f1a-4c2d-9e7b-1a2b3c4d5e6f";
    const requestWithPass = { challengeAnswers: [pass] } as unknown as DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
    const todaySignedPropertyNames = ["challengeRequest", "sessionId", "evaluationOptions", "timestamp"];

    const createEvaluateResponse = (status?: "pending" | "completed" | "failed") => ({
        riskScore: 0.5,
        sessionId: "server-echo",
        challengeUrl: "https://spamblocker.bitsocial.net/api/v1/iframe/server-echo",
        challengeExpiresAt: 1_900_000_000,
        ...(status ? { status } : {})
    });

    const getChallengeWith = ({
        challengeRequestMessage = requestWithPass,
        options = {},
        challengeIndex = 0
    }: {
        challengeRequestMessage?: DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
        options?: Record<string, string>;
        challengeIndex?: number;
    } = {}) =>
        ChallengeFileFactory({ challengeSettings: { options } as CommunityChallengeSetting }).getChallenge({
            challengeSettings: { options } as CommunityChallengeSetting,
            challengeRequestMessage,
            challengeIndex,
            community
        });

    const decodeFetchBody = (fetchMock: ReturnType<typeof vi.fn>, callIndex: number) =>
        cborg.decode(fetchMock.mock.calls[callIndex]?.[1]?.body as Buffer) as Record<string, any>;

    const expectTodaysLazyChallenge = (result: Awaited<ReturnType<typeof getChallengeWith>>) => {
        if ("success" in result) {
            throw new Error("Expected a lazy challenge response");
        }
        const { sessionId, payload } = getLazyChallengeParts(result.challenge);
        expect(payload).not.toHaveProperty("precheckSessionId");
        expect(payload.sessionId).toBe(sessionId);
        expect(payload.signature.signedPropertyNames).toEqual(todaySignedPropertyNames);
        return { sessionId, payload };
    };

    describe("factory marker", () => {
        it("publishes the pre-check URL for the default server", () => {
            expect(ChallengeFileFactory({ challengeSettings: { options: {} } as CommunityChallengeSetting }).challenge).toBe(
                "https://spamblocker.bitsocial.net/api/v1/precheck"
            );
        });

        it("strips trailing slashes from serverUrl", () => {
            const challengeFile = ChallengeFileFactory({
                challengeSettings: { options: { serverUrl: "https://example.com/api///" } } as unknown as CommunityChallengeSetting
            });
            expect(challengeFile.challenge).toBe("https://example.com/api/precheck");
        });

        it.each([
            ["serverUrl", { serverUrl: "ftp://example.com" }],
            ["threshold", { autoAcceptThreshold: "nope" }],
            ["country", { countryBlacklist: "XX" }]
        ])("omits the marker without throwing when the %s option is invalid", (_name, options) => {
            const challengeFile = ChallengeFileFactory({ challengeSettings: { options } as unknown as CommunityChallengeSetting });
            expect(challengeFile).not.toHaveProperty("challenge");
            expect(challengeFile.type).toBe("url/iframe");
        });

        it("does not throw when called without settings", () => {
            expect(() => ChallengeFileFactory(undefined as never)).not.toThrow();
        });
    });

    it("redeems a completed pass server-to-server and returns the verify result", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse("completed")), createResponse(createVerifyResponse()));

        const result = await getChallengeWith();

        expect(result).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/evaluate");
        expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-bitsocial-user-origin");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");

        const evaluateBody = decodeFetchBody(fetchMock, 0);
        expect(evaluateBody).toEqual(
            expect.objectContaining({
                challengeRequest: requestWithPass,
                sessionId: expect.any(String),
                evaluationOptions: { autoAcceptThreshold: 0.2, autoRejectThreshold: 0.8 },
                precheckSessionId: pass,
                timestamp: expect.any(Number)
            })
        );
        const { signature, ...signedProps } = evaluateBody;
        expect(signature.signedPropertyNames).toEqual([
            "challengeRequest",
            "sessionId",
            "evaluationOptions",
            "precheckSessionId",
            "timestamp"
        ]);
        expect(await ed.verify(signature.signature, cborg.encode(signedProps), signature.publicKey)).toBe(true);

        expect(decodeFetchBody(fetchMock, 1).sessionId).toBe(evaluateBody.sessionId);
    });

    it("applies IP policies to a completed pass", async () => {
        stubFetch(createResponse(createEvaluateResponse("completed")), createResponse(createVerifyResponse({ ipTypeEstimation: "vpn" })));

        const result = await getChallengeWith({ options: { blockVpn: "true" } });

        expect(result).toEqual({ success: false, error: "Rejected by IP policy (VPN)." });
    });

    it("returns the server's error for a failed pass", async () => {
        stubFetch(
            createResponse(createEvaluateResponse("failed")),
            createResponse(createVerifyResponse({ success: false, error: "Publication rejected" }))
        );

        const result = await getChallengeWith();

        expect(result).toEqual({ success: false, error: "Publication rejected" });
    });

    it("returns the lazy challenge built from the redemption payload when the pass is pending", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse("pending")), createResponse(createVerifyResponse()));

        const result = await getChallengeWith();

        if ("success" in result) {
            throw new Error("Expected a lazy challenge response");
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const evaluateBody = decodeFetchBody(fetchMock, 0);
        const { sessionId, payload } = getLazyChallengeParts(result.challenge);
        expect(sessionId).toBe(evaluateBody.sessionId);
        expect(payload).toEqual(evaluateBody);

        await result.verify("");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");
        expect(decodeFetchBody(fetchMock, 1).sessionId).toBe(sessionId);
    });

    it.each([
        ["the request fails", () => vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))],
        [
            "the server rejects the request",
            () => vi.fn().mockResolvedValue(createResponse({ error: "Invalid request body" }, { ok: false, status: 400 }))
        ],
        ["the response does not match the schema", () => vi.fn().mockResolvedValue(createResponse({ status: "completed" }))],
        ["the response has no status", () => vi.fn().mockResolvedValue(createResponse(createEvaluateResponse()))]
    ])("falls back to today's lazy challenge when %s", async (_name, createFetchMock) => {
        const fetchMock = createFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const result = await getChallengeWith();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const { sessionId } = expectTodaysLazyChallenge(result);
        expect(sessionId).not.toBe(decodeFetchBody(fetchMock, 0).sessionId);
    });

    it.each([
        ["no challenge answers", request, 0],
        ["a pass at another challenge index", requestWithPass, 1],
        ["an uppercase pass", { challengeAnswers: [pass.toUpperCase()] }, 0],
        ["a plain UUID", { challengeAnswers: [pass.replace("precheck-", "")] }, 0],
        ["a truncated pass", { challengeAnswers: ["precheck-0b6c3f5e"] }, 0]
    ])("keeps today's flow without calling the server for %s", async (_name, challengeRequestMessage, challengeIndex) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const result = await getChallengeWith({
            challengeRequestMessage: challengeRequestMessage as DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
            challengeIndex
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expectTodaysLazyChallenge(result);
    });
});
