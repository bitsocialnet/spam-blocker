import type { CommunityChallengeSetting } from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import { describe, expect, it } from "vitest";
import ChallengeFileFactory from "../src/index.js";
import { createOptionsSchema } from "../src/schema.js";

const optionInputs = ChallengeFileFactory({} as CommunityChallengeSetting).optionInputs;
const optionsSchema = createOptionsSchema(optionInputs);

type OptionName = (typeof optionInputs)[number]["option"];

const getDefault = (option: OptionName) => optionInputs.find((input) => input.option === option)?.default ?? "";

const normalizeUrl = (value: string) => value.replace(/\/+$/, "");

describe("challenge options validation", () => {
    it("applies defaults when options are missing", () => {
        const parsed = optionsSchema.parse({});

        expect(parsed.serverUrl).toBe(normalizeUrl(getDefault("serverUrl")));
        expect(parsed.autoAcceptThreshold).toBe(Number(getDefault("autoAcceptThreshold")));
        expect(parsed.autoRejectThreshold).toBe(Number(getDefault("autoRejectThreshold")));
        expect(parsed.maxIpRisk).toBe(Number(getDefault("maxIpRisk")));
        expect(parsed.blockVpn).toBe(getDefault("blockVpn") === "true");
        expect(parsed.blockProxy).toBe(getDefault("blockProxy") === "true");
        expect(parsed.blockTor).toBe(getDefault("blockTor") === "true");
        expect(parsed.blockDatacenter).toBe(getDefault("blockDatacenter") === "true");
        expect(parsed.countryBlacklist.size).toBe(0);
    });

    it("treats non-objects as empty options", () => {
        const parsed = optionsSchema.parse(undefined as unknown);
        expect(parsed.serverUrl).toBe(normalizeUrl(getDefault("serverUrl")));
    });

    it("normalizes serverUrl and trims trailing slashes", () => {
        const parsed = optionsSchema.parse({
            serverUrl: " https://example.com/api/// "
        });
        expect(parsed.serverUrl).toBe("https://example.com/api");
    });

    it("rejects non-http serverUrl values", () => {
        const result = optionsSchema.safeParse({ serverUrl: "ftp://example.com" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/http or https/i);
        }
    });

    it("parses numeric options from strings", () => {
        const parsed = optionsSchema.parse({
            autoAcceptThreshold: "0.25",
            autoRejectThreshold: "0.75",
            maxIpRisk: "0.5"
        });
        expect(parsed.autoAcceptThreshold).toBe(0.25);
        expect(parsed.autoRejectThreshold).toBe(0.75);
        expect(parsed.maxIpRisk).toBe(0.5);
    });

    it("rejects invalid numeric strings", () => {
        const result = optionsSchema.safeParse({ autoAcceptThreshold: "Infinity" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/Invalid autoAcceptThreshold option/i);
        }
    });

    it("rejects numeric options outside 0..1", () => {
        const result = optionsSchema.safeParse({ autoRejectThreshold: "1.2" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/autoRejectThreshold must be between 0 and 1/i);
        }
    });

    it("rejects autoAcceptThreshold greater than autoRejectThreshold", () => {
        const result = optionsSchema.safeParse({
            autoAcceptThreshold: "0.9",
            autoRejectThreshold: "0.4"
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/autoAcceptThreshold must be less than or equal/i);
        }
    });

    it("parses boolean options case-insensitively", () => {
        const parsed = optionsSchema.parse({
            blockVpn: " TRUE ",
            blockProxy: "false"
        });
        expect(parsed.blockVpn).toBe(true);
        expect(parsed.blockProxy).toBe(false);
    });

    it("rejects invalid boolean options", () => {
        const result = optionsSchema.safeParse({ blockTor: "yes" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.path).toEqual(["blockTor"]);
        }
    });

    it("parses country blacklist entries and deduplicates", () => {
        const parsed = optionsSchema.parse({ countryBlacklist: " us , CA,us " });
        expect(parsed.countryBlacklist.has("US")).toBe(true);
        expect(parsed.countryBlacklist.has("CA")).toBe(true);
        expect(parsed.countryBlacklist.size).toBe(2);
    });

    it("rejects unknown country codes", () => {
        const result = optionsSchema.safeParse({ countryBlacklist: "US,XYZ" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toMatch(/Unknown ISO 3166-1 alpha-2 country code 'XYZ'/i);
        }
    });
});

describe("validateChallengeSettings", () => {
    const validate = ({ options }: { options?: Record<string, string> }) => {
        const challengeSettings = { name: "spam-blocker", ...(options ? { options } : {}) } as CommunityChallengeSetting;
        const { validateChallengeSettings } = ChallengeFileFactory({ challengeSettings });
        if (!validateChallengeSettings) throw new Error("validateChallengeSettings is not exported");
        validateChallengeSettings({ challengeSettings });
    };

    it("accepts missing options, which fall back to the defaults", () => {
        expect(() => validate({})).not.toThrow();
    });

    it("accepts the settings the 5chan boards use", () => {
        expect(() =>
            validate({
                options: {
                    autoAcceptThreshold: "0.2",
                    autoRejectThreshold: "0.8",
                    blockVpn: "true",
                    blockProxy: "true",
                    blockTor: "true",
                    blockDatacenter: "true",
                    countryBlacklist: "RU,CN"
                }
            })
        ).not.toThrow();
    });

    it.each([
        { name: "a non-http serverUrl", options: { serverUrl: "ftp://example.com" }, message: /http or https/ },
        { name: "a serverUrl that is not a URL", options: { serverUrl: "spamblocker" }, message: /Invalid challenge options/ },
        {
            name: "a threshold outside 0..1",
            options: { autoAcceptThreshold: "1.5" },
            message: /autoAcceptThreshold must be between 0 and 1/
        },
        {
            name: "inverted thresholds",
            options: { autoAcceptThreshold: "0.9", autoRejectThreshold: "0.1" },
            message: /autoAcceptThreshold must be less than or equal to autoRejectThreshold/
        },
        { name: "a non-numeric maxIpRisk", options: { maxIpRisk: "high" }, message: /Invalid maxIpRisk option 'high'/ },
        { name: "a non-boolean connection policy", options: { blockVpn: "yes" }, message: /Invalid challenge options/ },
        { name: "an unknown country code", options: { countryBlacklist: "US,XYZ" }, message: /country code 'XYZ'/ },
        { name: "malformed precheckExemptions", options: { precheckExemptions: "{not json" }, message: /Invalid challenge options/ }
    ])("rejects $name", ({ options, message }) => {
        expect(() => validate({ options })).toThrow(message);
    });
});
