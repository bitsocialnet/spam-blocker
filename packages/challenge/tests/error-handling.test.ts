import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { GetChallengeArgs } from "@plebbit/plebbit-js/dist/node/subplebbit/types.js";
import ChallengeFileFactory from "../src/index.js";

// Minimal valid signer for createRequestSignature
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
        subplebbit: { address: "test.eth", signer: fakeSigner },
        ...overrides
    }) as unknown as GetChallengeArgs;

describe("error handling - getChallenge returns {success:false} on server errors", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("returns {success:false} when /evaluate returns 401", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: "Invalid publication signature" })
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("success", false);
        expect(result).toHaveProperty("error");
        expect((result as any).error).toMatch(/401/);
    });

    it("returns {success:false} when /evaluate returns 429", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            json: async () => ({ error: "Rate limited" })
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("success", false);
        expect(result).toHaveProperty("error");
        expect((result as any).error).toMatch(/429/);
    });

    it("returns {success:false} when /evaluate returns 409", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ error: "Duplicate publication" })
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("success", false);
        expect(result).toHaveProperty("error");
        expect((result as any).error).toMatch(/409/);
    });

    it("returns {success:false} when /evaluate fetch throws (network error)", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("success", false);
        expect(result).toHaveProperty("error");
        expect((result as any).error).toMatch(/ECONNREFUSED/);
    });

    it("returns {success:false} when /challenge/verify returns non-200", async () => {
        // First call: /evaluate succeeds with a risk score in the challenge range
        // Second call: /challenge/verify returns 500
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                // /evaluate response - risk score triggers challenge (between 0.2 and 0.8)
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        riskScore: 0.5,
                        sessionId: "test-session-123",
                        challengeUrl: "http://localhost:9999/challenge/test-session-123"
                    })
                };
            }
            // /challenge/verify response - server error
            return {
                ok: false,
                status: 500,
                json: async () => ({ error: "Internal server error" })
            };
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        // Should get a challenge back (not auto-accept/reject)
        expect(result).toHaveProperty("challenge");
        expect(result).toHaveProperty("verify");

        // Call verify - should return {success:false} not throw
        const verifyResult = await (result as any).verify("dummy-answer");
        expect(verifyResult).toHaveProperty("success", false);
        expect(verifyResult).toHaveProperty("error");
        expect((verifyResult as any).error).toMatch(/500/);
    });

    it("returns {success:false} when /challenge/verify fetch throws (network error)", async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        riskScore: 0.5,
                        sessionId: "test-session-456",
                        challengeUrl: "http://localhost:9999/challenge/test-session-456"
                    })
                };
            }
            throw new Error("Connection reset");
        });

        const challengeFile = ChallengeFileFactory({} as any);
        const result = await challengeFile.getChallenge(makeArgs());

        expect(result).toHaveProperty("verify");

        const verifyResult = await (result as any).verify("dummy-answer");
        expect(verifyResult).toHaveProperty("success", false);
        expect(verifyResult).toHaveProperty("error");
        expect((verifyResult as any).error).toMatch(/Connection reset/);
    });
});
