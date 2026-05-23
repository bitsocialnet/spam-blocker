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

export const EvaluationOptionsSchema = z
    .object({
        autoAcceptThreshold: UnitIntervalSchema.optional(),
        autoRejectThreshold: UnitIntervalSchema.optional()
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
    challengeExpiresAt: UnixTimestampSchema.optional()
});

export const VerifyResponseSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    ipRisk: UnitIntervalSchema.optional(),
    ipAddressCountry: IsoCountryCodeSchema.optional(),
    challengeType: z.string().optional(),
    ipTypeEstimation: z.string().optional()
});

export type EvaluationOptions = z.infer<typeof EvaluationOptionsSchema>;
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
