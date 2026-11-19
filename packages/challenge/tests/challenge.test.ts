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

const createVerifyResponse = (overrides: Partial<VerifyResponse> = {}): VerifyResponse => {
    const ipType = overrides.ipTypeEstimation;
    const knownType = ipType === "tor" || ipType === "proxy" || ipType === "vpn" || ipType === "datacenter";
    return {
        success: true,
        connectionTypes: knownType ? [ipType] : [],
        ipClassificationComplete: knownType || ipType === "residential",
        ...overrides
    };
};

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
        [
            "vpn",
            { blockVpn: "true" },
            "Your connection was detected as a VPN. This community restricts posting through a VPN. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
        ],
        [
            "proxy",
            { blockProxy: "true" },
            "Your connection was detected as a proxy. This community restricts posting through a proxy. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
        ],
        [
            "tor",
            { blockTor: "true" },
            "Your connection was detected as Tor. This community restricts posting through Tor. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
        ],
        [
            "tor",
            {
                blockTor: "true",
                precheckExemptions: JSON.stringify({
                    version: 1,
                    rules: [
                        { challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" },
                        {
                            challengeIndex: 1,
                            type: "whitelist",
                            urls: ["https://raw.githubusercontent.com/bitsocialnet/lists/refs/heads/master/whitelist-challenge.json"]
                        }
                    ]
                })
            },
            "Your connection was detected as Tor. This community restricts posting through Tor unless your account qualifies for an exemption. Use an unrestricted connection, or ask the community owner to whitelist your account, or use a verified .bso name on your Bitsocial account. Waiting alone will not remove this connection restriction."
        ],
        [
            "datacenter",
            { blockDatacenter: "true" },
            "Your connection was detected as a datacenter network. This community restricts posting through a datacenter network. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
        ]
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

    it.each([
        ["tor", "blockTor", "Tor"],
        ["vpn", "blockVpn", "VPN"],
        ["proxy", "blockProxy", "proxy"],
        ["datacenter", "blockDatacenter", "datacenter"]
    ])("explains %s policy with only the configured exemptions", async (ipType, option, label) => {
        stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: ipType })));
        const settings = {
            options: {
                [option]: "true",
                precheckExemptions: JSON.stringify({
                    version: 1,
                    rules: [
                        { challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" },
                        {
                            challengeIndex: 1,
                            type: "whitelist",
                            urls: ["https://raw.githubusercontent.com/example/list/main/accounts.json"]
                        }
                    ]
                })
            },
            exclude: [{ roles: ["moderator"] }, { challenges: [0, 1] }]
        } as unknown as CommunityChallengeSetting;
        const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
            challengeSettings: settings,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });
        if ("success" in result) throw new Error("Expected a challenge response");
        const rejection = await result.verify("token");
        expect(rejection.success).toBe(false);
        expect(rejection.error).toContain(label);
        expect(rejection.error).toContain("moderator");
        expect(rejection.error).toContain("whitelist");
        expect(rejection.error).toContain("verified .bso");
        expect(rejection.error).not.toMatch(/links|posting speed|posting quickly/);
        if (ipType === "datacenter") expect(rejection.error).not.toContain("VPN");
    });

    it("prioritizes the detected connection policy over a general IP risk limit", async () => {
        stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: "datacenter", ipRisk: 1 })));
        const settings = { options: { blockDatacenter: "true", maxIpRisk: "0.5" } } as unknown as CommunityChallengeSetting;
        const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
            challengeSettings: settings,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });
        if ("success" in result) throw new Error("Expected a challenge response");
        const rejection = await result.verify("token");
        expect(rejection.success).toBe(false);
        expect(rejection.error).toContain("This community restricts posting through a datacenter network");
        expect(rejection.error).not.toContain("IP risk policy");
    });

    it("does not advertise a conditional moderator exclusion as a general exemption", async () => {
        stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: "datacenter" })));
        const settings = {
            options: { blockDatacenter: "true" },
            exclude: [{ roles: ["moderator"], postScore: 5 }]
        } as unknown as CommunityChallengeSetting;
        const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
            challengeSettings: settings,
            challengeRequestMessage: request,
            challengeIndex: 0,
            community
        });
        if ("success" in result) throw new Error("Expected a challenge response");
        const rejection = await result.verify("token");
        expect(rejection.success).toBe(false);
        expect(rejection.error).not.toMatch(/moderator|whitelist|\.bso/);
    });

    describe("connection classification required by policy", () => {
        for (const option of ["blockTor", "blockVpn", "blockProxy", "blockDatacenter"]) {
            it.each([undefined, "unknown", "", "unrecognized-provider-value"])(
                `${option} rejects an unverified connection type %s`,
                async (ipTypeEstimation) => {
                    stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation })));
                    const settings = { options: { [option]: "true" } } as unknown as CommunityChallengeSetting;
                    const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                        challengeSettings: settings,
                        challengeRequestMessage: request,
                        challengeIndex: 0,
                        community
                    });
                    if ("success" in result) throw new Error("Expected a challenge response");
                    const rejection = await result.verify("token");
                    expect(rejection.success).toBe(false);
                    expect(rejection.error).toContain("Your connection type could not be verified");
                    expect(rejection.error).not.toMatch(/detected as|links|posting speed/);
                }
            );
        }

        it.each([undefined, "unknown"])("does not require classification without a connection policy (%s)", async (ipTypeEstimation) => {
            stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation })));
            const settings = {} as CommunityChallengeSetting;
            const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a challenge response");
            expect(await result.verify("token")).toEqual({ success: true });
        });

        it.each([
            { ipTypeEstimation: "residential", connectionTypes: undefined, ipClassificationComplete: undefined },
            { ipTypeEstimation: "residential", connectionTypes: [], ipClassificationComplete: false },
            { ipTypeEstimation: "vpn", connectionTypes: ["vpn"], ipClassificationComplete: false },
            { ipTypeEstimation: "residential", connectionTypes: undefined, ipClassificationComplete: true }
        ] satisfies Partial<VerifyResponse>[])("requires complete classification evidence (%j)", async (response) => {
            stubFetch(createResponse(createVerifyResponse(response)));
            const settings = { options: { blockTor: "true" } } as unknown as CommunityChallengeSetting;
            const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a challenge response");
            const rejection = await result.verify("token");
            expect(rejection.success).toBe(false);
            expect(rejection.error).toContain("Your connection type could not be verified");
        });

        it("enforces every detected category instead of only the legacy primary category", async () => {
            stubFetch(
                createResponse(
                    createVerifyResponse({
                        ipTypeEstimation: "proxy",
                        connectionTypes: ["proxy", "datacenter"],
                        ipClassificationComplete: true
                    })
                )
            );
            const settings = { options: { blockDatacenter: "true" } } as unknown as CommunityChallengeSetting;
            const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a challenge response");
            const rejection = await result.verify("token");
            expect(rejection.success).toBe(false);
            expect(rejection.error).toContain("detected as a datacenter network");
            expect(rejection.error).not.toContain("detected as a proxy");
        });

        it("reports a confirmed restricted category even when other classification flags are missing", async () => {
            stubFetch(
                createResponse(
                    createVerifyResponse({
                        ipTypeEstimation: "tor",
                        connectionTypes: ["tor"],
                        ipClassificationComplete: false
                    })
                )
            );
            const settings = { options: { blockTor: "true" } } as unknown as CommunityChallengeSetting;
            const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a challenge response");
            const rejection = await result.verify("token");
            expect(rejection.success).toBe(false);
            expect(rejection.error).toContain("detected as Tor");
        });

        it("accepts a verified residential connection with every connection policy enabled", async () => {
            stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: "residential" })));
            const settings = {
                options: { blockTor: "true", blockVpn: "true", blockProxy: "true", blockDatacenter: "true" }
            } as unknown as CommunityChallengeSetting;
            const result = await ChallengeFileFactory({ challengeSettings: settings }).getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a challenge response");
            expect(await result.verify("token")).toEqual({ success: true });
        });
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

    const createEvaluateResponse = ({ status }: { status?: "pending" | "completed" | "failed" } = {}) => ({
        riskScore: 0.5,
        sessionId: "server-echo",
        challengeUrl: "https://spamblocker.bitsocial.net/api/v1/iframe/server-echo",
        challengeExpiresAt: 1_900_000_000,
        ...(status ? { status } : {})
    });

    const getChallengeWith = ({
        challengeRequestMessage = requestWithPass,
        options = {},
        challengeIndex = 0,
        challengeAnswer
    }: {
        challengeRequestMessage?: DecryptedChallengeRequestMessageTypeWithCommunityAuthor;
        options?: Record<string, string>;
        challengeIndex?: number;
        // Passed by pkc-js 0.0.152 and later; the dev dependency's GetChallengeArgs predates it.
        challengeAnswer?: string;
    } = {}) =>
        ChallengeFileFactory({ challengeSettings: { options } as CommunityChallengeSetting }).getChallenge({
            challengeSettings: { options } as CommunityChallengeSetting,
            challengeRequestMessage,
            challengeIndex,
            community,
            ...(challengeAnswer === undefined ? {} : { challengeAnswer })
        });

    const decodeFetchBody = ({ fetchMock, callIndex }: { fetchMock: ReturnType<typeof vi.fn>; callIndex: number }) =>
        cborg.decode(fetchMock.mock.calls[callIndex]?.[1]?.body as Buffer) as Record<string, any>;

    const expectTodaysLazyChallenge = ({ result }: { result: Awaited<ReturnType<typeof getChallengeWith>> }) => {
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

        it("treats whitespace-only exemption settings as unset in the marker and final challenge", async () => {
            const settings = { options: { blockTor: "true", precheckExemptions: " \t\n " } } as unknown as CommunityChallengeSetting;
            const challengeFile = ChallengeFileFactory({ challengeSettings: settings });
            expect(challengeFile.challenge).toBe("https://spamblocker.bitsocial.net/api/v1/precheck?blockTor=true");
            const result = await challengeFile.getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            expect(result).toHaveProperty("challenge");
        });

        it("publishes Tor policy and includes it in the community-signed evaluation", async () => {
            const settings = { options: { blockTor: "true" } } as unknown as CommunityChallengeSetting;
            const challengeFile = ChallengeFileFactory({ challengeSettings: settings });
            expect(challengeFile.challenge).toBe("https://spamblocker.bitsocial.net/api/v1/precheck?blockTor=true");
            const result = await challengeFile.getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 0,
                community
            });
            if ("success" in result) throw new Error("Expected a lazy challenge");
            const { payload } = getLazyChallengeParts(result.challenge);
            expect(payload.evaluationOptions.blockTor).toBe(true);
            expect(payload.signature.signedPropertyNames).toContain("evaluationOptions");
            const { signature, ...signedProps } = payload;
            expect(await ed.verify(signature.signature, cborg.encode(signedProps), signature.publicKey)).toBe(true);
        });

        it.each(["blockTor", "blockVpn", "blockProxy", "blockDatacenter"])(
            "publishes %s and binds it to the community-signed evaluation",
            async (option) => {
                const settings = { options: { [option]: "true" } } as unknown as CommunityChallengeSetting;
                const challengeFile = ChallengeFileFactory({ challengeSettings: settings });
                expect(new URL(challengeFile.challenge!).searchParams.get(option)).toBe("true");
                const result = await challengeFile.getChallenge({
                    challengeSettings: settings,
                    challengeRequestMessage: request,
                    challengeIndex: 0,
                    community
                });
                if ("success" in result) throw new Error("Expected a lazy challenge");
                const { payload } = getLazyChallengeParts(result.challenge);
                expect(payload.evaluationOptions[option]).toBe(true);
                expect(payload.signature.signedPropertyNames).toContain("evaluationOptions");
                const { signature, ...signedProps } = payload;
                expect(await ed.verify(signature.signature, cborg.encode(signedProps), signature.publicKey)).toBe(true);
            }
        );

        it("publishes explicit verified exemptions for the actual board layout", () => {
            const policy = {
                version: 1,
                rules: [
                    { challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" },
                    { challengeIndex: 1, type: "whitelist", urls: ["https://raw.githubusercontent.com/example/lists/main/whitelist.json"] }
                ]
            };
            const challengeFile = ChallengeFileFactory({
                challengeSettings: {
                    options: { blockTor: "true", precheckExemptions: JSON.stringify(policy) },
                    exclude: [{ challenges: [0] }, { challenges: [1] }]
                } as unknown as CommunityChallengeSetting
            });
            const marker = new URL(challengeFile.challenge!);
            expect(marker.searchParams.get("blockTor")).toBe("true");
            expect(JSON.parse(marker.searchParams.get("precheckExemptions")!)).toEqual(policy);
        });

        it.each([
            { version: 1, rules: [{ challengeIndex: 0, type: "whitelist", urls: ["not a URL"] }] },
            { version: 1, rules: [{ challengeIndex: 0, type: "whitelist", urls: ["https://example.com/whitelist.json"] }] },
            { version: 1, rules: [{ challengeIndex: 0, type: "whitelist", urls: ["https://raw.githubusercontent.com:444/example/list"] }] },
            {
                version: 1,
                rules: [{ challengeIndex: 0, type: "whitelist", urls: ["https://user@raw.githubusercontent.com/example/list"] }]
            },
            {
                version: 1,
                rules: [{ challengeIndex: 0, type: "whitelist", urls: ["https://raw.githubusercontent.com/example/list#fragment"] }]
            },
            { version: 2, rules: [{ challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" }] },
            { version: 1, rules: [{ challengeIndex: 0, type: "publication-match", suffix: ".bso" }] },
            { version: 1, rules: [{ challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".eth" }] },
            { version: 1, rules: [{ challengeIndex: 0, type: "whitelist", urls: ["http://localhost/private"] }] },
            {
                version: 1,
                rules: [
                    {
                        challengeIndex: 0,
                        type: "whitelist",
                        urls: ["https://raw.githubusercontent.com/example/lists/main/whitelist.json"],
                        addresses: ["private"]
                    }
                ]
            },
            {
                version: 1,
                rules: [
                    { challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" },
                    { challengeIndex: 0, type: "whitelist", urls: ["https://raw.githubusercontent.com/example/lists/main/whitelist.json"] }
                ]
            }
        ])("does not advertise an invalid exemption policy: %j", (policy) => {
            expect(
                ChallengeFileFactory({
                    challengeSettings: { options: { precheckExemptions: JSON.stringify(policy) } } as unknown as CommunityChallengeSetting
                })
            ).not.toHaveProperty("challenge");
        });

        it("keeps unknown challenge dependencies deferred even with a partial policy", () => {
            const challengeFile = ChallengeFileFactory({
                challengeSettings: {
                    options: {
                        precheckExemptions: JSON.stringify({
                            version: 1,
                            rules: [{ challengeIndex: 0, type: "verified-author-name-suffix", suffix: ".bso" }]
                        })
                    },
                    exclude: [{ challenges: [0] }, { challenges: [1] }]
                } as unknown as CommunityChallengeSetting
            });
            expect(challengeFile).not.toHaveProperty("challenge");
        });

        it.each([{ challenges: [0] }, { challenges: [1] }, { challenges: [0, 1] }])(
            "omits the pre-check marker for challenge-dependent exemptions: %j",
            (exclude) => {
                const challengeFile = ChallengeFileFactory({
                    challengeSettings: { options: { blockTor: "true" }, exclude: [exclude] } as unknown as CommunityChallengeSetting
                });
                expect(challengeFile).not.toHaveProperty("challenge");
                expect(challengeFile.type).toBe("url/iframe");
            }
        );

        it.each([
            { roles: ["owner", "admin", "moderator"] },
            { challenges: [] },
            { challenges: [-1] },
            { challenges: [0.5] },
            { challenges: ["0"] },
            { challenges: null }
        ])("keeps the marker without a valid challenge-result dependency: %j", (exclude) => {
            const challengeFile = ChallengeFileFactory({
                challengeSettings: { options: { blockTor: "true" }, exclude: [exclude] } as unknown as CommunityChallengeSetting
            });
            expect(challengeFile.challenge).toBe("https://spamblocker.bitsocial.net/api/v1/precheck?blockTor=true");
        });

        it("still enforces signed Tor policy during final verification when the marker is omitted", async () => {
            const settings = {
                options: { blockTor: "true" },
                exclude: [{ challenges: [0] }, { challenges: [1] }]
            } as unknown as CommunityChallengeSetting;
            const challengeFile = ChallengeFileFactory({ challengeSettings: settings });
            expect(challengeFile).not.toHaveProperty("challenge");
            const result = await challengeFile.getChallenge({
                challengeSettings: settings,
                challengeRequestMessage: request,
                challengeIndex: 2,
                community
            });
            if ("success" in result) throw new Error("Expected the normal lazy challenge");
            const { payload } = getLazyChallengeParts(result.challenge);
            expect(payload.evaluationOptions.blockTor).toBe(true);
            const { signature, ...signedProps } = payload;
            expect(await ed.verify(signature.signature, cborg.encode(signedProps), signature.publicKey)).toBe(true);
            stubFetch(createResponse(createVerifyResponse({ ipTypeEstimation: "tor" })));
            expect(await result.verify([])).toEqual({
                success: false,
                error: "Your connection was detected as Tor. This community restricts posting through Tor. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
            });
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
        const fetchMock = stubFetch(
            createResponse(createEvaluateResponse({ status: "completed" })),
            createResponse(createVerifyResponse())
        );

        const result = await getChallengeWith();

        expect(result).toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/evaluate");
        expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-bitsocial-user-origin");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");

        const evaluateBody = decodeFetchBody({ fetchMock, callIndex: 0 });
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

        expect(decodeFetchBody({ fetchMock, callIndex: 1 }).sessionId).toBe(evaluateBody.sessionId);
    });

    it.each([
        ["args.challengeAnswer", { challengeRequestMessage: request, challengeAnswer: pass }],
        ["an index-keyed challengeAnswers record", { challengeRequestMessage: { challengeAnswers: { "2": pass } } }],
        ["a positional challengeAnswers array", { challengeRequestMessage: { challengeAnswers: ["", "", pass] } }]
    ])("redeems a pass read from %s", async (_name, { challengeRequestMessage, challengeAnswer }) => {
        const fetchMock = stubFetch(
            createResponse(createEvaluateResponse({ status: "completed" })),
            createResponse(createVerifyResponse())
        );

        const result = await getChallengeWith({
            challengeRequestMessage: challengeRequestMessage as unknown as DecryptedChallengeRequestMessageTypeWithCommunityAuthor,
            challengeIndex: 2,
            challengeAnswer
        });

        expect(result).toEqual({ success: true });
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/evaluate");
        expect(decodeFetchBody({ fetchMock, callIndex: 0 }).precheckSessionId).toBe(pass);
    });

    it("applies IP policies to a completed pass", async () => {
        stubFetch(
            createResponse(createEvaluateResponse({ status: "completed" })),
            createResponse(createVerifyResponse({ ipTypeEstimation: "vpn" }))
        );

        const result = await getChallengeWith({ options: { blockVpn: "true" } });

        expect(result).toEqual({
            success: false,
            error: "Your connection was detected as a VPN. This community restricts posting through a VPN. Use an unrestricted connection and try again. Waiting alone will not remove this connection restriction."
        });
    });

    it("returns the server's error for a failed pass", async () => {
        stubFetch(
            createResponse(createEvaluateResponse({ status: "failed" })),
            createResponse(createVerifyResponse({ success: false, error: "Publication rejected" }))
        );

        const result = await getChallengeWith();

        expect(result).toEqual({ success: false, error: "Publication rejected" });
    });

    it("returns the lazy challenge built from the redemption payload when the pass is pending", async () => {
        const fetchMock = stubFetch(createResponse(createEvaluateResponse({ status: "pending" })), createResponse(createVerifyResponse()));

        const result = await getChallengeWith();

        if ("success" in result) {
            throw new Error("Expected a lazy challenge response");
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const evaluateBody = decodeFetchBody({ fetchMock, callIndex: 0 });
        const { sessionId, payload } = getLazyChallengeParts(result.challenge);
        expect(sessionId).toBe(evaluateBody.sessionId);
        expect(payload).toEqual(evaluateBody);

        await result.verify("");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");
        expect(decodeFetchBody({ fetchMock, callIndex: 1 }).sessionId).toBe(sessionId);
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
        const { sessionId } = expectTodaysLazyChallenge({ result });
        expect(sessionId).not.toBe(decodeFetchBody({ fetchMock, callIndex: 0 }).sessionId);
    });

    it("gives up on a stalled redemption and returns today's lazy challenge", async () => {
        const controller = new AbortController();
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
        const fetchMock = vi.fn(
            (_url: string, init: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
        );
        vi.stubGlobal("fetch", fetchMock);

        const resultPromise = getChallengeWith();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(timeoutSpy).toHaveBeenCalledWith(10_000);
        controller.abort(new DOMException("The operation timed out.", "TimeoutError"));

        expectTodaysLazyChallenge({ result: await resultPromise });
    });

    it.each([
        ["fails", () => Promise.reject(new Error("ECONNRESET"))],
        [
            "is answered with a server error",
            () => Promise.resolve(createResponse({ error: "Service unavailable" }, { ok: false, status: 503 }))
        ],
        ["is answered with something unreadable", () => Promise.resolve(createResponse({ unexpected: true }))]
    ])("returns today's lazy challenge when the verify request of a redeemed pass %s", async (_name, verifyResponse) => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createResponse(createEvaluateResponse({ status: "completed" })))
            .mockImplementationOnce(verifyResponse);
        vi.stubGlobal("fetch", fetchMock);

        const result = await getChallengeWith();

        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");
        expectTodaysLazyChallenge({ result });
    });

    it("gives up on a verify request that stalls after the pass is redeemed", async () => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createResponse(createEvaluateResponse({ status: "completed" })))
            .mockImplementationOnce(
                (_url: string, init: { signal?: AbortSignal }) =>
                    new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
            );
        vi.stubGlobal("fetch", fetchMock);

        const resultPromise = getChallengeWith();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://spamblocker.bitsocial.net/api/v1/challenge/verify");
        controller.abort(new DOMException("The operation timed out.", "TimeoutError"));

        expectTodaysLazyChallenge({ result: await resultPromise });
    });

    it.each([
        ["no challenge answers", request, 0],
        ["a pass at another challenge index", requestWithPass, 1],
        ["a pass under another key of an index-keyed record", { challengeAnswers: { "1": pass } }, 0],
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
        expectTodaysLazyChallenge({ result });
    });
});
