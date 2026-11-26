import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { GetChallengeArgs } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import ChallengeFileFactory from "../src/index.js";
import { resetServerReachabilityCache } from "../src/server-reachability.js";

const fakeSigner = {
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    type: "ed25519"
};

const options = {
    serverUrl: "http://localhost:9999/api/v1",
    autoAcceptThreshold: "0.2",
    autoRejectThreshold: "0.8"
};

const makeArgs = (overrides?: Partial<GetChallengeArgs>): GetChallengeArgs =>
    ({
        challengeSettings: { options },
        challengeRequestMessage: {
            publication: { signature: { publicKey: "abc123" } }
        },
        community: { address: "test.eth", signer: fakeSigner },
        ...overrides
    }) as unknown as GetChallengeArgs;

const UNREACHABLE = /^Bitsocial Spam Blocker \(localhost:9999\) is unreachable right now, so its check cannot run\./;

const response = (body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) => ({
    ok,
    status,
    json: async () => body
});

// A server that is up for the health probe and answers /challenge/verify with `verify`.
const stubServer = (verify: () => Promise<unknown>) => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/health") ? response({ status: "ok" }) : verify()));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
};

describe("error handling", () => {
    beforeEach(() => {
        resetServerReachabilityCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("when the server is unreachable", () => {
        it("fails at once instead of returning an iframe that cannot load", async () => {
            const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
            vi.stubGlobal("fetch", fetchMock);

            const result = await ChallengeFileFactory({} as any).getChallenge(makeArgs());

            expect(result).toEqual({
                success: false,
                error: "Bitsocial Spam Blocker (localhost:9999) is unreachable right now, so its check cannot run. Try again later."
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:9999/health");
        });

        it("points to the challenges it excludes on", async () => {
            vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

            const result = await ChallengeFileFactory({} as any).getChallenge(
                makeArgs({
                    challengeSettings: {
                        options,
                        exclude: [{ role: ["moderator"] }, { challenges: [0] }, { challenges: [1] }]
                    }
                } as unknown as Partial<GetChallengeArgs>)
            );

            expect(result).toEqual({
                success: false,
                error: "Bitsocial Spam Blocker (localhost:9999) is unreachable right now, so its check cannot run. You can still post by meeting one of this community's other requirements, or try again later."
            });
        });

        it("fails after a pre-check pass cannot be redeemed", async () => {
            const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
            vi.stubGlobal("fetch", fetchMock);
            const pass = "precheck-00000000-0000-4000-8000-000000000000";

            const result = await ChallengeFileFactory({} as any).getChallenge(
                makeArgs({ challengeAnswer: pass } as unknown as Partial<GetChallengeArgs>)
            );

            expect(result).toEqual({ success: false, error: expect.stringMatching(UNREACHABLE) });
            expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
                "http://localhost:9999/api/v1/evaluate",
                "http://localhost:9999/health"
            ]);
        });
    });

    it("does not call /evaluate from getChallenge", async () => {
        const fetchMock = stubServer(async () => response({ success: true }));

        const result = await ChallengeFileFactory({} as any).getChallenge(makeArgs());

        expect(result).toHaveProperty("challenge");
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://localhost:9999/health"]);
    });

    it("returns {success:false} when /challenge/verify returns non-200", async () => {
        stubServer(async () => response({ error: "Internal server error" }, { ok: false, status: 500 }));

        const result = await ChallengeFileFactory({} as any).getChallenge(makeArgs());

        expect(result).toHaveProperty("challenge");
        expect(result).toHaveProperty("verify");

        const verifyResult = await (result as any).verify("dummy-answer");
        expect(verifyResult).toHaveProperty("success", false);
        expect((verifyResult as any).error).toMatch(/500/);
    });

    it.each([
        ["the /challenge/verify request fails", async () => Promise.reject(new TypeError("Connection reset"))],
        ["a Cloudflare tunnel error answers /challenge/verify", async () => response(undefined, { ok: false, status: 530 })],
        [
            "the connection drops while reading the /challenge/verify answer",
            async () => ({ ok: true, status: 200, json: async () => Promise.reject(new TypeError("terminated")) })
        ]
    ])("returns the unreachable error when %s", async (_name, verify) => {
        stubServer(verify);

        const result = await ChallengeFileFactory({} as any).getChallenge(makeArgs());
        const verifyResult = await (result as any).verify("dummy-answer");

        expect(verifyResult).toEqual({ success: false, error: expect.stringMatching(UNREACHABLE) });
    });
});
