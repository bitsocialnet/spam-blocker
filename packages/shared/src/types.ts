import countries from "i18n-iso-countries";
import { z } from "zod";

const ISO_COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

const isIsoCountryCode = (value: string) => ISO_COUNTRY_CODE_REGEX.test(value) && countries.isValid(value);

const isHttpUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
};

const UnitIntervalSchema = z.number().finite().min(0).max(1);

const UnixTimestampSchema = z.number().finite().int().nonnegative();

export const IsoCountryCodeSchema = z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => isIsoCountryCode(value), {
        message: "Unknown ISO 3166-1 alpha-2 country code"
    });

// An explicit owner declaration of known dependency semantics, published in the signed community marker.
// Never infer a challenge implementation from its description or option names.
export const PrecheckExemptionsSchema = z
    .object({
        version: z.literal(1),
        rules: z
            .array(
                z.discriminatedUnion("type", [
                    z
                        .object({
                            challengeIndex: z.number().int().nonnegative(),
                            type: z.literal("verified-author-name-suffix"),
                            suffix: z.literal(".bso")
                        })
                        .strict(),
                    z
                        .object({
                            challengeIndex: z.number().int().nonnegative(),
                            type: z.literal("whitelist"),
                            urls: z
                                .array(
                                    z.url().refine(
                                        (value) => {
                                            let url: URL;
                                            try {
                                                url = new URL(value);
                                            } catch {
                                                return false;
                                            }
                                            return (
                                                url.protocol === "https:" &&
                                                url.hostname === "raw.githubusercontent.com" &&
                                                !url.username &&
                                                !url.password &&
                                                !url.port &&
                                                !url.hash
                                            );
                                        },
                                        {
                                            message:
                                                "Whitelist URLs must use raw.githubusercontent.com HTTPS without credentials, ports or fragments"
                                        }
                                    )
                                )
                                .min(1)
                                .max(10)
                        })
                        .strict()
                ])
            )
            .min(1)
            .max(32)
    })
    .strict()
    .refine((policy) => new Set(policy.rules.map((rule) => rule.challengeIndex)).size === policy.rules.length, {
        message: "Exemption challenge indexes must be unique"
    });

export type PrecheckExemptions = z.infer<typeof PrecheckExemptionsSchema>;

export const EvaluationOptionsSchema = z
    .object({
        autoAcceptThreshold: UnitIntervalSchema.optional(),
        autoRejectThreshold: UnitIntervalSchema.optional(),
        blockTor: z.boolean().optional(),
        blockVpn: z.boolean().optional(),
        blockProxy: z.boolean().optional(),
        blockDatacenter: z.boolean().optional()
    })
    .strict()
    .superRefine((value, ctx) => {
        if (
            value.autoAcceptThreshold !== undefined &&
            value.autoRejectThreshold !== undefined &&
            value.autoAcceptThreshold > value.autoRejectThreshold
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "autoAcceptThreshold must be less than or equal to autoRejectThreshold",
                path: ["autoAcceptThreshold"]
            });
        }
    });

export const EvaluateResponseSchema = z.object({
    riskScore: UnitIntervalSchema,
    explanation: z.string().optional(),
    sessionId: z.string(),
    challengeUrl: z.url().refine((value) => isHttpUrl(value), {
        message: "challengeUrl must be a valid HTTP/HTTPS URL"
    }),
    challengeExpiresAt: UnixTimestampSchema.optional(),
    // Optional so responses from servers that predate the field still parse.
    status: z.enum(["pending", "completed", "failed"]).optional()
});

export const VerifyResponseSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    ipRisk: UnitIntervalSchema.optional(),
    ipAddressCountry: IsoCountryCodeSchema.optional(),
    challengeType: z.string().optional(),
    ipTypeEstimation: z.string().optional(),
    connectionTypes: z.array(z.enum(["tor", "proxy", "vpn", "datacenter"])).optional(),
    ipClassificationComplete: z.boolean().optional(),
    /** The confirmed connection is a published iCloud Private Relay egress address (also reported as "vpn"). */
    privateRelay: z.boolean().optional(),
    /**
     * Why VPN, proxy and datacenter restrictions do not apply to this publication: the author passed on enough
     * separate days from unrestricted connections (`established_account`), or signed in during this challenge with
     * an account no ban in the community is linked to (`sign_in`). Tor restrictions still apply. Absent when the
     * restrictions apply; servers that predate it omit it.
     */
    connectionExemption: z.enum(["established_account", "sign_in"]).optional(),
    /**
     * True when `connectionExemption` is set, false when a VPN, proxy or datacenter connection is detected
     * without one. Kept for challenge clients up to 0.1.14, which read only this field; servers that predate
     * the exemption omit it.
     */
    establishedAccount: z.boolean().optional()
});

export type EvaluationOptions = z.infer<typeof EvaluationOptionsSchema>;
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
