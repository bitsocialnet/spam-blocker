import type {
    ChallengeFileInput,
    ChallengeInput,
    ChallengeResultInput,
    GetChallengeArgs
} from "@pkcprotocol/pkc-js/dist/node/community/types.js";
import { signBufferEd25519 } from "./pkc-js-signer.js";
import type { EvaluateResponse, EvaluationOptions, VerifyResponse } from "@bitsocial/spam-blocker-shared";
import { EvaluateResponseSchema, VerifyResponseSchema } from "@bitsocial/spam-blocker-shared";
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
        option: "precheckExemptions",
        label: "Pre-check exemptions",
        default: "",
        description:
            "Public JSON declaration of verified name and public whitelist challenge dependencies. Must match the community challenge settings.",
        placeholder: '{"version":1,"rules":[{"challengeIndex":0,"type":"verified-author-name-suffix","suffix":".bso"}]}'
    },
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
        description:
            "Restrict publications from VPN IPs; the hosted server lets them post after a sign-in (estimation only, not 100% accurate)",
        placeholder: "true"
    },
    {
        option: "blockProxy",
        label: "Block Proxy",
        default: "false",
        description:
            "Restrict publications from proxy IPs; the hosted server lets them post after a sign-in (estimation only, not 100% accurate)",
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
        description:
            "Restrict publications from datacenter IPs; the hosted server lets them post after a sign-in (estimation only, not 100% accurate)",
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

// A stalled redemption (its /evaluate and /challenge/verify together) falls back to the lazy iframe instead
// of holding up the community's challenge.
const PRECHECK_REDEMPTION_TIMEOUT_MS = 10_000;
const PRECHECK_SESSION_ID_REGEX = /^precheck-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A client that completed this board's pre-check sends the pre-check session id as this challenge's answer.
// pkc-js 0.0.152 and later pass that answer as `challengeAnswer` and key `challengeAnswers` by challenge index;
// older nodes send a positional array and no `challengeAnswer`, so both are read defensively.
const getPrecheckPass = ({
    challengeRequestMessage,
    challengeIndex,
    challengeAnswer
}: Pick<GetChallengeArgs, "challengeRequestMessage" | "challengeIndex"> & { challengeAnswer?: unknown }) => {
    const challengeAnswers = challengeRequestMessage.challengeAnswers as Record<string, unknown> | undefined;
    const answer: unknown = challengeAnswer ?? challengeAnswers?.[String(challengeIndex)];
    return typeof answer === "string" && PRECHECK_SESSION_ID_REGEX.test(answer) ? answer : undefined;
};

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

const postCbor = async ({ url, body, signal }: { url: string; body: unknown; signal?: AbortSignal }): Promise<unknown> => {
    const encoded = cborg.encode(body);
    log.trace(`POST ${url} request body (CBOR, %d bytes)`, encoded.length);
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/cbor",
            accept: "application/json",
            "ngrok-skip-browser-warning": "true"
        },
        body: Buffer.from(encoded),
        signal
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

const connectionPolicies = [
    ["tor", "blockTor", "Tor"],
    ["proxy", "blockProxy", "a proxy"],
    ["vpn", "blockVpn", "a VPN"],
    ["datacenter", "blockDatacenter", "a datacenter network"]
] as const;

const PRIVATE_RELAY_LABEL = "iCloud Private Relay";
/** The server exempts accounts with this many days of passed challenges from unrestricted connections. */
const ESTABLISHED_ACCOUNT_PASSED_DAYS = 3;

const getPostChallengeRejection = ({
    verifyResponse,
    options,
    challengeSettings
}: {
    verifyResponse: VerifyResponse;
    options: ParsedOptions;
    challengeSettings: GetChallengeArgs["challengeSettings"];
}) => {
    // An established account, or one that signed in during this challenge, is exempt from every restriction but
    // Tor; the server decides who qualifies. Servers up to the sign-in exemption report only establishedAccount.
    const exempt = verifyResponse.connectionExemption !== undefined || verifyResponse.establishedAccount === true;
    const policy = connectionPolicies.find(
        ([type, option]) => verifyResponse.connectionTypes?.includes(type) && options[option] && !(exempt && type !== "tor")
    );
    if (policy) {
        const label = verifyResponse.privateRelay === true && policy[0] !== "tor" ? PRIVATE_RELAY_LABEL : policy[2];
        const hints: string[] = [];
        if (
            challengeSettings.exclude?.some(
                (exclude) => Object.keys(exclude).length === 1 && Array.isArray(exclude.roles) && exclude.roles.includes("moderator")
            )
        )
            hints.push("use your verified community moderator account");
        if (options.precheckExemptions?.rules.some((rule) => rule.type === "whitelist")) {
            hints.push("ask the community owner to whitelist your account");
        }
        if (options.precheckExemptions?.rules.some((rule) => rule.type === "verified-author-name-suffix")) {
            hints.push("use a verified .bso name on your Bitsocial account");
        }
        const qualifies = hints.length ? ", unless your account qualifies for an exemption" : "";
        const alternatives = hints.length ? `, or ${hints.join(", or ")}` : "";
        // Only a server that checks the exemption reports establishedAccount; an older one omits it.
        const established =
            policy[0] !== "tor" && verifyResponse.establishedAccount === false
                ? ` Accounts that have passed the spam blocker on ${ESTABLISHED_ACCOUNT_PASSED_DAYS} separate days from an unrestricted connection can post through ${label}.`
                : "";
        const restriction = `${established} Waiting alone will not remove this connection restriction.`;
        if (label === PRIVATE_RELAY_LABEL) {
            // A relay address can also be classified as a proxy or datacenter; name the category the community restricts.
            const detected = policy[0] === "vpn" ? "" : `, which was detected as ${policy[2]}`;
            const restricted = policy[0] === "vpn" ? "it" : policy[2];
            return `Your connection goes through ${label}${detected}. Posting through ${restricted} has been blocked in this community due to abuse${qualifies}. To post, show your IP address to this site and try again: in Safari on iPhone or iPad, tap the Page Menu button, then Show IP Address; on a Mac, choose View > Reload and Show IP Address${alternatives}.${restriction}`;
        }
        return `Your connection was detected as ${label}. Posting through ${label} has been blocked in this community due to abuse${qualifies}. Use an unrestricted connection${hints.length ? alternatives : " and try again"}.${restriction}`;
    }

    if (
        connectionPolicies.some(([, option]) => options[option]) &&
        (verifyResponse.ipClassificationComplete !== true || !Array.isArray(verifyResponse.connectionTypes))
    ) {
        return "Your connection type could not be verified. This community restricts certain connection types. Try again or use another connection.";
    }

    if (typeof verifyResponse.ipRisk === "number" && verifyResponse.ipRisk > options.maxIpRisk) {
        return `Rejected by IP risk policy (ipRisk ${formatRiskScore(verifyResponse.ipRisk)}).`;
    }

    if (typeof verifyResponse.ipAddressCountry === "string") {
        const country = verifyResponse.ipAddressCountry.trim().toUpperCase();
        if (country && options.countryBlacklist.has(country)) {
            return `Rejected by country policy (${country}).`;
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

    const evaluationOptions: EvaluationOptions = {
        autoAcceptThreshold: options.autoAcceptThreshold,
        autoRejectThreshold: options.autoRejectThreshold,
        ...Object.fromEntries(connectionPolicies.filter(([, option]) => options[option]).map(([, option]) => [option, true]))
    };

    // Signed /evaluate payload; the lazy iframe posts the same payload when the user opens it.
    const createEvaluateRequest = async ({ precheckSessionId }: { precheckSessionId?: string } = {}) => {
        const sessionId = randomUUID();
        const evaluateTimestamp = Math.floor(Date.now() / 1000);
        const evaluatePropsToSign = {
            challengeRequest: challengeRequestMessage,
            sessionId,
            evaluationOptions,
            ...(precheckSessionId ? { precheckSessionId } : {}),
            timestamp: evaluateTimestamp
        };
        const evaluateSignature = await createRequestSignature(evaluatePropsToSign, signer);
        return { sessionId, payload: { ...evaluatePropsToSign, signature: evaluateSignature } };
    };

    // Server tracks challenge completion state - no token needed from user
    // For a pass redemption (given `signal`), a verify request that fails, times out or returns an unreadable
    // answer throws instead of failing the challenge, so the caller falls back to the lazy iframe. A verify
    // answer that rejects the publication still fails it.
    const verifySession = async ({ sessionId, signal }: { sessionId: string; signal?: AbortSignal }): Promise<ChallengeResultInput> => {
        log("verify called for sessionId=%s", sessionId);

        const verifyTimestamp = Math.floor(Date.now() / 1000);
        const verifyPropsToSign = { sessionId, timestamp: verifyTimestamp };
        log("Calling /challenge/verify endpoint at %s", `${options.serverUrl}/challenge/verify`);
        const verifySignature = await createRequestSignature(verifyPropsToSign, signer);

        let verifyResponse: VerifyResponse;
        try {
            verifyResponse = parseWithSchema<VerifyResponse>(
                VerifyResponseSchema,
                await postCbor({
                    url: `${options.serverUrl}/challenge/verify`,
                    body: { ...verifyPropsToSign, signature: verifySignature },
                    signal
                }),
                "verify"
            );
        } catch (error) {
            if (signal) throw error;
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

        const postChallengeRejection = getPostChallengeRejection({ verifyResponse, options, challengeSettings });
        if (postChallengeRejection) {
            log("Post-challenge rejection: %s", postChallengeRejection);
            return { success: false, error: postChallengeRejection };
        }

        log("Challenge verification succeeded for sessionId=%s", sessionId);
        return { success: true };
    };

    const createLazyChallenge = ({ sessionId, payload }: { sessionId: string; payload: unknown }): ChallengeInput => {
        const challengeUrl = createLazyChallengeUrl({ serverUrl: options.serverUrl, sessionId, payload });
        log("Returning lazy challenge to user: sessionId=%s, challengeUrl=%s", sessionId, challengeUrl);
        return { challenge: challengeUrl, verify: () => verifySession({ sessionId }), type };
    };

    const precheckSessionId = getPrecheckPass(args);
    if (precheckSessionId) {
        const evaluateRequest = await createEvaluateRequest({ precheckSessionId });
        const signal = AbortSignal.timeout(PRECHECK_REDEMPTION_TIMEOUT_MS);
        try {
            const evaluateResponse = parseWithSchema<EvaluateResponse>(
                EvaluateResponseSchema,
                await postCbor({
                    url: `${options.serverUrl}/evaluate`,
                    body: evaluateRequest.payload,
                    signal
                }),
                "evaluate"
            );
            log("Pre-check pass redemption: sessionId=%s, status=%s", evaluateRequest.sessionId, evaluateResponse.status);
            if (evaluateResponse.status === "completed" || evaluateResponse.status === "failed") {
                // Awaited here so a verify request the deadline aborts reaches the fallback below.
                return await verifySession({ sessionId: evaluateRequest.sessionId, signal });
            }
            if (evaluateResponse.status === "pending") {
                return createLazyChallenge(evaluateRequest);
            }
            log.error("Pre-check pass redemption returned no status; falling back to the lazy challenge");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            log.error("Failed to redeem pre-check pass, falling back to the lazy challenge: %s", message);
        }
    }

    return createLazyChallenge(await createEvaluateRequest());
};

// pkc-js publishes `challenge` as community.challenges[i].challenge; clients use it to find the pre-check route.
// Must not throw: pkc-js calls the factory while building the public community record and on every challenge request.
function ChallengeFileFactory(args: { challengeSettings: GetChallengeArgs["challengeSettings"] }): ChallengeFileInput {
    const parsedOptions = OptionsSchema.safeParse(args?.challengeSettings?.options);
    // Unknown dependency semantics remain private and require authoritative community evaluation.
    // Only an explicit owner declaration lets the server check known exemptions before upload.
    const excludes = args?.challengeSettings?.exclude;
    const hasUncoveredChallengeDependentExemption =
        Array.isArray(excludes) &&
        excludes.some(
            (exclude) =>
                Array.isArray(exclude?.challenges) &&
                exclude.challenges.length > 0 &&
                exclude.challenges.every((index) => Number.isInteger(index) && index >= 0) &&
                exclude.challenges.some(
                    (index) =>
                        !parsedOptions.success ||
                        !parsedOptions.data.precheckExemptions?.rules.some((rule) => rule.challengeIndex === index)
                )
        );
    let challenge: string | undefined;
    if (parsedOptions.success && !hasUncoveredChallengeDependentExemption) {
        const marker = new URL(`${parsedOptions.data.serverUrl}/precheck`);
        for (const [, option] of connectionPolicies) {
            if (parsedOptions.data[option]) marker.searchParams.set(option, "true");
        }
        if (parsedOptions.data.precheckExemptions) {
            marker.searchParams.set("precheckExemptions", JSON.stringify(parsedOptions.data.precheckExemptions));
        }
        challenge = marker.toString();
    }
    return { getChallenge, optionInputs, type, description, ...(challenge ? { challenge } : {}) };
}

export default ChallengeFileFactory;
