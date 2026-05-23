import type {
    ChallengeFileInput,
    ChallengeInput,
    ChallengeResultInput,
    GetChallengeArgs
} from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import { signBufferEd25519 } from "./pkc-js-signer.js";
import type { EvaluationOptions, VerifyResponse } from "@bitsocial/spam-blocker-shared";
import { VerifyResponseSchema } from "@bitsocial/spam-blocker-shared";
import { createOptionsSchema, type ParsedOptions } from "./schema.js";
import * as cborg from "cborg";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { randomUUID } from "node:crypto";
import Logger from "@pkcprotocol/pkc-logger";

const log = Logger("bitsocial:community:challenge:spam-blocker");
const LEGACY_RUNTIME_COMMUNITY_KEY = String.fromCharCode(115, 117, 98, 112, 108, 101, 98, 98, 105, 116);

const DEFAULT_SERVER_URL = "https://spamblocker.bitsocial.net/api/v1";

const optionInputs = [
    {
        option: "serverUrl",
        label: "Server URL",
        default: DEFAULT_SERVER_URL,
        description: "URL of the Bitsocial Spam Blocker server",
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

const description: ChallengeFileInput["description"] = "Validate publications using Bitsocial Spam Blocker.";

type RuntimeSigner = {
    privateKey?: string;
    publicKey?: string;
    type?: string;
};

type RuntimeCommunity = {
    address?: string;
    signer?: RuntimeSigner;
};

const communityLevelActionKeys = ["commentEdit", "commentModeration", "communityEdit"] as const;

const isCommunityLevelActionRequest = (challengeRequestMessage: GetChallengeArgs["challengeRequestMessage"]) =>
    communityLevelActionKeys.some((key) => Boolean(challengeRequestMessage[key]));

const isRuntimeCommunity = (value: unknown): value is RuntimeCommunity =>
    typeof value === "object" && value !== null && ("signer" in value || "address" in value);

const getRuntimeCommunity = (args: GetChallengeArgs): RuntimeCommunity | undefined => {
    if (isRuntimeCommunity(args.community)) {
        return args.community;
    }

    const legacyRuntimeCommunity = (args as Record<string, unknown>)[LEGACY_RUNTIME_COMMUNITY_KEY];
    if (isRuntimeCommunity(legacyRuntimeCommunity)) {
        return legacyRuntimeCommunity;
    }

    return undefined;
};

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
        throw new Error("Community signer is missing required fields");
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
        throw new Error(`Bitsocial Spam Blocker server error (${response.status})${details}`);
    }

    if (responseBody === undefined) {
        log.error(`POST ${url} returned invalid JSON`);
        throw new Error("Invalid JSON response from Bitsocial Spam Blocker server");
    }

    return responseBody;
};

const parseWithSchema = <T>(schema: { parse: (data: unknown) => T }, data: unknown, context: string): T => {
    try {
        return schema.parse(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const suffix = message ? `: ${message}` : "";
        throw new Error(`Invalid ${context} response from Bitsocial Spam Blocker server${suffix}`);
    }
};

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const createLazyChallengeUrl = ({ serverUrl, sessionId, payload }: { serverUrl: string; sessionId: string; payload: unknown }) =>
    `${serverUrl}/iframe/${encodeURIComponent(sessionId)}/lazy#payload=${toBase64Url(cborg.encode(payload))}`;

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
    const { challengeSettings, challengeRequestMessage } = args;
    const runtimeCommunity = getRuntimeCommunity(args);
    log("getChallenge called for community %s", runtimeCommunity?.address);
    log.trace("getChallenge arg keys: %o", Reflect.ownKeys(args));
    log.trace(
        "runtime community lookup: hasCommunity=%s hasLegacy=%s legacyType=%s",
        "community" in args,
        LEGACY_RUNTIME_COMMUNITY_KEY in (args as object),
        typeof (args as Record<string, unknown>)[LEGACY_RUNTIME_COMMUNITY_KEY]
    );
    log.trace("getChallenge args: challengeSettings=%o, challengeRequestMessage=%o", challengeSettings, challengeRequestMessage);

    if (isCommunityLevelActionRequest(challengeRequestMessage)) {
        log("Auto-accepting community-level action without spam evaluation");
        return { success: true };
    }

    const options = parseOptions(challengeSettings);
    log(
        "Parsed options: serverUrl=%s, autoAcceptThreshold=%s, autoRejectThreshold=%s",
        options.serverUrl,
        options.autoAcceptThreshold,
        options.autoRejectThreshold
    );

    const signer = runtimeCommunity?.signer;

    if (!signer) {
        log.error("Community signer is missing");
        return { success: false, error: "Community signer is required to call Bitsocial Spam Blocker" };
    }
    log.trace("Signer publicKey: %s", signer.publicKey);

    const sessionId = randomUUID();
    const evaluateTimestamp = Math.floor(Date.now() / 1000);
    const evaluationOptions: EvaluationOptions = {
        autoAcceptThreshold: options.autoAcceptThreshold,
        autoRejectThreshold: options.autoRejectThreshold
    };
    const evaluatePropsToSign = {
        challengeRequest: challengeRequestMessage,
        sessionId,
        evaluationOptions,
        timestamp: evaluateTimestamp
    };
    const evaluateSignature = await createRequestSignature(evaluatePropsToSign, signer);
    const challengeUrl = createLazyChallengeUrl({
        serverUrl: options.serverUrl,
        sessionId,
        payload: {
            ...evaluatePropsToSign,
            signature: evaluateSignature
        }
    });
    log("Returning lazy challenge to user: sessionId=%s, challengeUrl=%s", sessionId, challengeUrl);

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

function ChallengeFileFactory(_communityChallengeSettings: GetChallengeArgs["challengeSettings"]): ChallengeFileInput {
    return { getChallenge, optionInputs, type, description };
}

export default ChallengeFileFactory;
