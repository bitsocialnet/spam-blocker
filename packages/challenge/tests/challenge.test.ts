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

        expect(publicChallenge.type).toBe("url/iframe");
        expect(publicChallenge.description).toMatch(/Bitsocial/i);

        const serialized = JSON.stringify(publicChallenge);
        expect(serialized).not.toContain("secret-server.example.com");
        expect(serialized).not.toContain("serverUrl");
        expect(serialized).not.toContain("autoAcceptThreshold");
        expect(serialized).not.toContain("autoRejectThreshold");
        expect(serialized).not.toContain("countryBlacklist");
        expect(publicChallenge).not.toHaveProperty("options");
    });
});
