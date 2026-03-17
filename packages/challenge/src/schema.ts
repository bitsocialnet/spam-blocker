import { IsoCountryCodeSchema } from "@bitsocial/spam-blocker-shared";
import { z } from "zod";

export type ParsedOptions = {
    serverUrl: string;
    autoAcceptThreshold: number;
    autoRejectThreshold: number;
    countryBlacklist: Set<string>;
    maxIpRisk: number;
    blockVpn: boolean;
    blockProxy: boolean;
    blockTor: boolean;
    blockDatacenter: boolean;
};

type OptionName = keyof ParsedOptions;

type OptionInput = {
    option: OptionName;
    default: string;
};

const normalizeServerUrl = (url: string) => url.replace(/\/+$/, "");

const isHttpUrl = (value: string) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
};

export const createOptionsSchema = (optionInputs: ReadonlyArray<OptionInput>) => {
    const optionDefaults = optionInputs.reduce(
        (acc, input) => {
            acc[input.option] = input.default;
            return acc;
        },
        {} as Record<OptionName, string>
    );

    const getOptionDefault = (option: OptionName) => optionDefaults[option];

    const resolveOptionString = (value: unknown, option: OptionName) => {
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed ? trimmed : getOptionDefault(option);
        }
        if (value === undefined || value === null) {
            return getOptionDefault(option);
        }
        return value;
    };

    const normalizeServerUrlInput = (value: unknown) => {
        const resolved = resolveOptionString(value, "serverUrl");
        if (typeof resolved === "string") {
            return normalizeServerUrl(resolved);
        }
        return resolved;
    };

    const numberOptionSchema = (option: OptionName) =>
        z.preprocess(
            (value) => resolveOptionString(value, option),
            z.string().transform((value, ctx) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Invalid ${option} option '${value}'`
                    });
                    return z.NEVER;
                }
                return parsed;
            })
        );

    const booleanOptionSchema = (option: OptionName) =>
        z.preprocess(
            (value) => {
                const resolved = resolveOptionString(value, option);
                if (typeof resolved === "string") {
                    return resolved.trim().toLowerCase();
                }
                return resolved;
            },
            z.enum(["true", "false"]).transform((value) => value === "true")
        );

    const countryBlacklistSchema = z.preprocess(
        (value) => resolveOptionString(value, "countryBlacklist"),
        z.string().transform((value, ctx) => {
            if (!value) return new Set<string>();
            const entries = value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
            const codes = new Set<string>();
            for (const entry of entries) {
                const parsed = IsoCountryCodeSchema.safeParse(entry);
                if (!parsed.success) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Unknown ISO 3166-1 alpha-2 country code '${entry}' in countryBlacklist`
                    });
                    return z.NEVER;
                }
                codes.add(parsed.data);
            }
            return codes;
        })
    );

    const schema: z.ZodType<ParsedOptions> = z.preprocess(
        (value) => (value && typeof value === "object" ? value : {}),
        z
            .object({
                serverUrl: z.preprocess(
                    normalizeServerUrlInput,
                    z.url().refine(isHttpUrl, {
                        message: "Server URL must use http or https"
                    })
                ),
                autoAcceptThreshold: numberOptionSchema("autoAcceptThreshold").refine((value) => value >= 0 && value <= 1, {
                    message: "autoAcceptThreshold must be between 0 and 1"
                }),
                autoRejectThreshold: numberOptionSchema("autoRejectThreshold").refine((value) => value >= 0 && value <= 1, {
                    message: "autoRejectThreshold must be between 0 and 1"
                }),
                countryBlacklist: countryBlacklistSchema,
                maxIpRisk: numberOptionSchema("maxIpRisk").refine((value) => value >= 0 && value <= 1, {
                    message: "maxIpRisk must be between 0 and 1"
                }),
                blockVpn: booleanOptionSchema("blockVpn"),
                blockProxy: booleanOptionSchema("blockProxy"),
                blockTor: booleanOptionSchema("blockTor"),
                blockDatacenter: booleanOptionSchema("blockDatacenter")
            })
            .superRefine((data, ctx) => {
                if (data.autoAcceptThreshold > data.autoRejectThreshold) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: "autoAcceptThreshold must be less than or equal to autoRejectThreshold",
                        path: ["autoAcceptThreshold"]
                    });
                }
            })
    );

    return schema;
};
