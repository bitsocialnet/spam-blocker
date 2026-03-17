import type {
    ChallengeFileInput,
    ChallengeInput,
    ChallengeResultInput,
    GetChallengeArgs
} from "@plebbit/plebbit-js/dist/node/subplebbit/types.js";
import { signBufferEd25519 } from "./plebbit-js-signer.js";
import type { EvaluateResponse, VerifyResponse } from "@bitsocial/spam-blocker-shared";
import { EvaluateResponseSchema, VerifyResponseSchema } from "@bitsocial/spam-blocker-shared";
import { createOptionsSchema, type ParsedOptions } from "./schema.js";
import * as cborg from "cborg";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import Logger from "@plebbit/plebbit-logger";

const log = Logger("plebbit-js:subplebbit:challenge:bitsocial-spam-blocker");

const DEFAULT_SERVER_URL = "https://spamblocker.bitsocial.net/api/v1";

const optionInputs = [
    {
        option: "serverUrl",
        label: "Server URL",
        default: DEFAULT_SERVER_URL,
        description: "URL of the BitsocialSpamBlocker server",
        placeholder: "https://spamblocker.bitsocial.net/api/v1"
    },
    {
        option: "autoAcceptThreshold",
        label: "Auto-Accept Threshold",
        default: "0.2",
        description: "Auto-accept publications below this risk score",
        placeholder: "0.2"
    },
    {
        option: "autoRejectThreshold",
        label: "Auto-Reject Threshold",
        default: "0.8",
        description: "Auto-reject publications above this risk score",
        placeholder: "0.8"
    },
    {
        option: "countryBlacklist",
        label: "Country Blacklist",
        default: "",
        description: "Comma-separated ISO 3166-1 alpha-2 country codes to block",
        placeholder: "RU,CN,KP,US"
    },
    {
        option: "maxIpRisk",
        label: "Max IP Risk",
        default: "1.0",
        description: "Reject if ipRisk from /verify exceeds this threshold (estimation only, not 100% accurate)",
        placeholder: "1.0"
    },
    {
        option: "blockVpn",
        label: "Block VPN",
        default: "false",
        description: "Reject publications from VPN IPs (estimation only, not 100% accurate)",
        placeholder: "true"
    },
    {
        option: "blockProxy",
        label: "Block Proxy",
        default: "false",
        description: "Reject publications from proxy IPs (estimation only, not 100% accurate)",
        placeholder: "true"
    },
    {
        option: "blockTor",
        label: "Block Tor",
        default: "false",
        description: "Reject publications from Tor exit nodes (estimation only, not 100% accurate)",
        placeholder: "true"
    },
    {
        option: "blockDatacenter",
        label: "Block Datacenter",
        default: "false",
        description: "Reject publications from datacenter IPs (estimation only, not 100% accurate)",
        placeholder: "true"
    }
] as const satisfies NonNullable<ChallengeFileInput["optionInputs"]>;

const OptionsSchema = createOptionsSchema(optionInputs);

const type: ChallengeInput["type"] = "url/iframe";

const description: ChallengeFileInput["description"] = "Validate publications using BitsocialSpamBlocker.";

const parseOptions = (settings: GetChallengeArgs["challengeSettings"]): ParsedOptions => {
    const parsed = OptionsSchema.safeParse(settings?.options);
    if (!parsed.success) {
        const message = parsed.error.issues.map((issue) => issue.message).join("; ");
        throw new Error(`Invalid challenge options: ${message}`);
    }
    return parsed.data;
};

const createRequestSignature = async (
    propsToSign: Record<string, unknown>,
    signer: { privateKey?: string; publicKey?: string; type?: string }
) => {
    if (!signer.privateKey || !signer.publicKey || !signer.type) {
        throw new Error("Subplebbit signer is missing required fields");
    }
    // Sign the CBOR-encoded payload directly
    const encoded = cborg.encode(propsToSign);
    const signatureBuffer = await signBufferEd25519(encoded, signer.privateKey);
    return {
        signature: signatureBuffer, // Uint8Array, not base64
        publicKey: uint8ArrayFromString(signer.publicKey, "base64"), // Uint8Array
        type: signer.type,
        signedPropertyNames: Object.keys(propsToSign)
    };
};

const postCbor = async (url: string, body: unknown): Promise<unknown> => {
    const encoded = cborg.encode(body);
    log.trace(`POST ${url} request body (CBOR, %d bytes)`, encoded.length);
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/cbor",
            accept: "application/json",
            "ngrok-skip-browser-warning": "true"
        },
        body: Buffer.from(encoded)
    });

    let responseBody: unknown;
    try {
        responseBody = (await response.json()) as unknown;
    } catch {
        responseBody = undefined;
    }

    log.trace(`POST ${url} response status: ${response.status}, body: %o`, responseBody);

    if (!response.ok) {
        const details = responseBody !== undefined ? `: ${JSON.stringify(responseBody)}` : "";
        log.error(`POST ${url} failed with status ${response.status}${details}`);
        throw new Error(`BitsocialSpamBlocker server error (${response.status})${details}`);
    }

    if (responseBody === undefined) {
        log.error(`POST ${url} returned invalid JSON`);
        throw new Error("Invalid JSON response from BitsocialSpamBlocker server");
    }

    return responseBody;
};

const parseWithSchema = <T>(schema: { parse: (data: unknown) => T }, data: unknown, context: string): T => {
    try {
        return schema.parse(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const suffix = message ? `: ${message}` : "";
        throw new Error(`Invalid ${context} response from BitsocialSpamBlocker server${suffix}`);
    }
};

const formatRiskScore = (riskScore: number) => {
    if (!Number.isFinite(riskScore)) return String(riskScore);
    return riskScore.toFixed(2);
};

const getPostChallengeRejection = (verifyResponse: VerifyResponse, options: ParsedOptions) => {
    if (typeof verifyResponse.ipRisk === "number" && verifyResponse.ipRisk > options.maxIpRisk) {
        return `Rejected by IP risk policy (ipRisk ${formatRiskScore(verifyResponse.ipRisk)}).`;
    }

    if (typeof verifyResponse.ipAddressCountry === "string") {
        const country = verifyResponse.ipAddressCountry.trim().toUpperCase();
        if (country && options.countryBlacklist.has(country)) {
            return `Rejected by country policy (${country}).`;
        }
    }

    if (typeof verifyResponse.ipTypeEstimation === "string") {
        const ipType = verifyResponse.ipTypeEstimation.trim().toLowerCase();
        if (ipType === "vpn" && options.blockVpn) {
            return "Rejected by IP policy (VPN).";
        }
        if (ipType === "proxy" && options.blockProxy) {
            return "Rejected by IP policy (proxy).";
        }
        if (ipType === "tor" && options.blockTor) {
            return "Rejected by IP policy (Tor).";
        }
        if (ipType === "datacenter" && options.blockDatacenter) {
            return "Rejected by IP policy (datacenter).";
        }
    }

    return undefined;
};

const getChallenge = async (args: GetChallengeArgs): Promise<ChallengeInput | ChallengeResultInput> => {
    const { challengeSettings, challengeRequestMessage, subplebbit } = args;
    log("getChallenge called for subplebbit %s", subplebbit?.address);
    log.trace("getChallenge args: challengeSettings=%o, challengeRequestMessage=%o", challengeSettings, challengeRequestMessage);

    const options = parseOptions(challengeSettings);
    log(
        "Parsed options: serverUrl=%s, autoAcceptThreshold=%s, autoRejectThreshold=%s",
        options.serverUrl,
        options.autoAcceptThreshold,
        options.autoRejectThreshold
    );

    const signer = subplebbit?.signer;

    if (!signer) {
        log.error("Subplebbit signer is missing");
        throw new Error("Subplebbit signer is required to call BitsocialSpamBlocker");
    }
    log.trace("Signer publicKey: %s", signer.publicKey);

    const evaluateTimestamp = Math.floor(Date.now() / 1000);
    const evaluatePropsToSign = {
        challengeRequest: challengeRequestMessage,
        timestamp: evaluateTimestamp
    };
    log("Calling /evaluate endpoint at %s", `${options.serverUrl}/evaluate`);
    const evaluateSignature = await createRequestSignature(evaluatePropsToSign, signer);

    let evaluateResponse: EvaluateResponse;
    try {
        evaluateResponse = parseWithSchema<EvaluateResponse>(
            EvaluateResponseSchema,
            await postCbor(`${options.serverUrl}/evaluate`, {
                ...evaluatePropsToSign,
                signature: evaluateSignature
            }),
            "evaluate"
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        log.error("Failed to evaluate publication: %s", message);
        return { success: false, error: message };
    }
    const riskScore = evaluateResponse.riskScore;
    log(
        "Evaluate response: riskScore=%s, sessionId=%s, explanation=%s",
        formatRiskScore(riskScore),
        evaluateResponse.sessionId,
        evaluateResponse.explanation
    );

    if (riskScore < options.autoAcceptThreshold) {
        log("Auto-accepting publication (riskScore %s < autoAcceptThreshold %s)", formatRiskScore(riskScore), options.autoAcceptThreshold);
        return { success: true };
    }

    if (riskScore >= options.autoRejectThreshold) {
        const explanation = evaluateResponse.explanation ? ` ${evaluateResponse.explanation}` : "";
        log("Auto-rejecting publication (riskScore %s >= autoRejectThreshold %s)", formatRiskScore(riskScore), options.autoRejectThreshold);
        return {
            success: false,
            // TODO find a better error message
            error: `Rejected by BitsocialSpamBlocker (riskScore ${formatRiskScore(riskScore)}).${explanation}`
        };
    }

    const sessionId = evaluateResponse.sessionId;
    const challengeUrl = evaluateResponse.challengeUrl;
    log("Returning challenge to user: sessionId=%s, challengeUrl=%s", sessionId, challengeUrl);

    // Server tracks challenge completion state - no token needed from user
    const verify = async (_answer: string): Promise<ChallengeResultInput> => {
        log("verify called for sessionId=%s", sessionId);

        const verifyTimestamp = Math.floor(Date.now() / 1000);
        const verifyPropsToSign = { sessionId, timestamp: verifyTimestamp };
        log("Calling /challenge/verify endpoint at %s", `${options.serverUrl}/challenge/verify`);
        const verifySignature = await createRequestSignature(verifyPropsToSign, signer);

        let verifyResponse: VerifyResponse;
        try {
            verifyResponse = parseWithSchema<VerifyResponse>(
                VerifyResponseSchema,
                await postCbor(`${options.serverUrl}/challenge/verify`, {
                    ...verifyPropsToSign,
                    signature: verifySignature
                }),
                "verify"
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            log.error("Failed to verify challenge: %s", message);
            return { success: false, error: message };
        }
        log(
            "Verify response: success=%s, error=%s, ipRisk=%s, ipAddressCountry=%s, ipTypeEstimation=%s",
            verifyResponse.success,
            verifyResponse.error,
            verifyResponse.ipRisk,
            verifyResponse.ipAddressCountry,
            verifyResponse.ipTypeEstimation
        );

        if (!verifyResponse.success) {
            log("Challenge verification failed: %s", verifyResponse.error || "unknown error");
            return {
                success: false,
                // TODO find a better error message
                error: verifyResponse.error || "Challenge verification failed."
            };
        }

        const postChallengeRejection = getPostChallengeRejection(verifyResponse, options);
        if (postChallengeRejection) {
            log("Post-challenge rejection: %s", postChallengeRejection);
            return { success: false, error: postChallengeRejection };
        }

        log("Challenge verification succeeded for sessionId=%s", sessionId);
        return { success: true };
    };

    return { challenge: challengeUrl, verify, type };
};

function ChallengeFileFactory(subplebbitChallengeSettings: GetChallengeArgs["challengeSettings"]): ChallengeFileInput {
    return { getChallenge, optionInputs, type, description };
}

export default ChallengeFileFactory;
