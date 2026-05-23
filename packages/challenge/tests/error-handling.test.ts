import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { GetChallengeArgs } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import ChallengeFileFactory from "../src/index.js";

const fakeSigner = {
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    type: "ed25519"
};

const makeArgs = (overrides?: Partial<GetChallengeArgs>): GetChallengeArgs =>
    ({
        challengeSettings: {
            options: {
                serverUrl: "http://localhost:9999",
                autoAcceptThreshold: "0.2",
                autoRejectThreshold: "0.8"
            }
        },
        challengeRequestMessage: {
            publication: { signature: { publicKey: "abc123" } }
        },
        community: { address: "test.eth", signer: fakeSigner },
        ...overrides
    }) as unknown as GetChallengeArgs;

describe("error handling", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("does not call /evaluate from getChallenge when the server would be unavailable", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("challenge");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns {success:false} when /challenge/verify returns non-200", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: "Internal server error" })
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("challenge");
        expect(result).toHaveProperty("verify");

        const verifyResult = await (result as any).verify("dummy-answer");
        expect(verifyResult).toHaveProperty("success", false);
        expect(verifyResult).toHaveProperty("error");
        expect((verifyResult as any).error).toMatch(/500/);
    });

    it("returns {success:false} when /challenge/verify fetch throws", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection reset"));

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("verify");

        const verifyResult = await (result as any).verify("dummy-answer");
        expect(verifyResult).toHaveProperty("success", false);
        expect(verifyResult).toHaveProperty("error");
        expect((verifyResult as any).error).toMatch(/Connection reset/);
    });
});
