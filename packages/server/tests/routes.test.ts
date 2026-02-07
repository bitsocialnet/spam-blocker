import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type SpamDetectionServer } from "../src/index.js";
import * as cborg from "cborg";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { signBufferEd25519, getPublicKeyFromPrivateKey, getPlebbitAddressFromPublicKey } from "../src/plebbit-js-signer.js";
import { resetPlebbitLoaderForTest, setPlebbitLoaderForTest } from "../src/subplebbit-resolver.js";

// Cloudflare Turnstile test keys - work on any domain including localhost
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"; // Always passes

const baseTimestamp = Math.floor(Date.now() / 1000);

// Signed property names for comment publications (from plebbit-js CommentSignedPropertyNames)
const CommentSignedPropertyNames = [
    "timestamp",
    "flair",
    "subplebbitAddress",
    "author",
    "protocolVersion",
    "content",
    "spoiler",
    "nsfw",
    "link",
    "title",
    "linkWidth",
    "linkHeight",
    "linkHtmlTagName",
    "parentCid",
    "postCid"
];

const VoteSignedPropertyNames = ["timestamp", "subplebbitAddress", "author", "protocolVersion", "commentCid", "vote"];

// Helper to create a properly signed publication signature (JSON format for publications)
const signPublication = async (
    publication: Record<string, unknown>,
    signer: { privateKey: string; publicKey: string },
    signedPropertyNames: string[]
) => {
    // Build props to sign, excluding null/undefined
    const propsToSign: Record<string, unknown> = {};
    for (const key of signedPropertyNames) {
        if (publication[key] !== undefined && publication[key] !== null) {
            propsToSign[key] = publication[key];
        }
    }

    const encoded = cborg.encode(propsToSign);
    const signatureBytes = await signBufferEd25519(encoded, signer.privateKey);

    return {
        type: "ed25519",
        signature: uint8ArrayToString(signatureBytes, "base64"),
        publicKey: signer.publicKey,
        signedPropertyNames: Object.keys(propsToSign)
    };
};

const baseSubplebbitAuthor = {
    postScore: 0,
    replyScore: 0,
    firstCommentTimestamp: baseTimestamp - 86400,
    lastCommentCid: "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu"
};

// Subplebbit signer (signs requests to the spam detection server)
const testPrivateKey = Buffer.alloc(32, 7).toString("base64");
const alternatePrivateKey = Buffer.alloc(32, 3).toString("base64");
// Author signer (signs publications - separate from subplebbit signer)
const authorPrivateKey = Buffer.alloc(32, 9).toString("base64");

let testPublicKey = "";
let alternatePublicKey = "";
let authorPublicKey = "";
let authorPlebbitAddress = ""; // Derived from author's public key (B58 format)

let testSigner = {
    privateKey: testPrivateKey,
    publicKey: "",
    type: "ed25519"
};
let alternateSigner = {
    privateKey: alternatePrivateKey,
    publicKey: "",
    type: "ed25519"
};
let authorSigner = {
    privateKey: authorPrivateKey,
    publicKey: "",
    type: "ed25519"
};

beforeAll(async () => {
    testPublicKey = await getPublicKeyFromPrivateKey(testPrivateKey);
    alternatePublicKey = await getPublicKeyFromPrivateKey(alternatePrivateKey);
    authorPublicKey = await getPublicKeyFromPrivateKey(authorPrivateKey);
    // Derive the plebbit address from the author's public key (B58 peer ID format)
    authorPlebbitAddress = await getPlebbitAddressFromPublicKey(authorPublicKey);
    testSigner = {
        privateKey: testPrivateKey,
        publicKey: testPublicKey,
        type: "ed25519"
    };
    alternateSigner = {
        privateKey: alternatePrivateKey,
        publicKey: alternatePublicKey,
        type: "ed25519"
    };
    authorSigner = {
        privateKey: authorPrivateKey,
        publicKey: authorPublicKey,
        type: "ed25519"
    };
});

// Create CBOR request signature with Uint8Array values
const createRequestSignature = async (propsToSign: Record<string, unknown>, signer = testSigner) => {
    const encoded = cborg.encode(propsToSign);
    const signatureBuffer = await signBufferEd25519(encoded, signer.privateKey);
    return {
        signature: signatureBuffer, // Uint8Array, not base64
        publicKey: uint8ArrayFromString(signer.publicKey, "base64"), // Uint8Array
        type: signer.type,
        signedPropertyNames: Object.keys(propsToSign)
    };
};

// Helper to send CBOR-encoded request
const injectCbor = async (fastify: SpamDetectionServer["fastify"], method: "POST" | "GET", url: string, payload?: unknown) => {
    const options: Parameters<typeof fastify.inject>[0] = {
        method,
        url,
        headers: {
            "content-type": "application/cbor",
            accept: "application/json"
        }
    };
    if (payload !== undefined) {
        options.body = Buffer.from(cborg.encode(payload));
    }
    return fastify.inject(options);
};

const createEvaluatePayload = async ({
    commentOverrides = {},
    authorOverrides = {},
    subplebbitOverrides = {},
    omitSubplebbitAuthor = false,
    omitAuthorAddress = false,
    omitSubplebbitAddress = false,
    signer = testSigner,
    publicationSigner = authorSigner
}: {
    commentOverrides?: Record<string, unknown>;
    authorOverrides?: Record<string, unknown>;
    subplebbitOverrides?: Record<string, unknown>;
    omitSubplebbitAuthor?: boolean;
    omitAuthorAddress?: boolean;
    omitSubplebbitAddress?: boolean;
    signer?: typeof testSigner;
    publicationSigner?: typeof authorSigner;
} = {}) => {
    // Build author WITHOUT subplebbit for signing (matches production flow)
    const authorForSigning: Record<string, unknown> = {
        // Use derived plebbit address (B58 peer ID) that matches the publication signer
        address: authorPlebbitAddress,
        ...authorOverrides
    };

    if (omitAuthorAddress) {
        delete authorForSigning.address;
    }

    // Build comment without signature first (no author.subplebbit)
    const commentWithoutSignature: Record<string, unknown> = {
        author: authorForSigning,
        subplebbitAddress: "test-sub.eth",
        timestamp: baseTimestamp,
        protocolVersion: "1",
        content: "Hello world",
        ...commentOverrides
    };

    if (omitSubplebbitAddress) {
        delete commentWithoutSignature.subplebbitAddress;
    }

    // Sign the publication properly (unless commentOverrides already has a signature)
    let publicationSignature;
    if (commentOverrides.signature) {
        publicationSignature = commentOverrides.signature;
    } else {
        publicationSignature = await signPublication(commentWithoutSignature, publicationSigner, CommentSignedPropertyNames);
    }

    // After signing, add author.subplebbit (matches production flow where
    // the subplebbit adds this field after the author signs)
    let finalAuthor: Record<string, unknown> = { ...authorForSigning };
    if (!omitSubplebbitAuthor) {
        finalAuthor.subplebbit = {
            ...baseSubplebbitAuthor,
            ...subplebbitOverrides
        };
    }

    const comment = {
        ...commentWithoutSignature,
        author: finalAuthor,
        signature: publicationSignature
    };

    const challengeRequest = { comment };
    const timestamp = Math.floor(Date.now() / 1000);
    const propsToSign = { challengeRequest, timestamp };
    const signature = await createRequestSignature(propsToSign, signer);

    return {
        ...propsToSign,
        signature
    };
};

const createVerifyPayload = async ({ sessionId, signer = testSigner }: { sessionId: string; signer?: typeof testSigner }) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const propsToSign = { sessionId, timestamp };
    const signature = await createRequestSignature(propsToSign, signer);

    return { ...propsToSign, signature };
};

describe("API Routes", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
        server = await createServer({
            port: 0, // Random available port
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    describe("GET /health", () => {
        it("should return health status", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/health"
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe("ok");
            expect(body.timestamp).toBeDefined();
        });
    });

    describe("POST /api/v1/evaluate", () => {
        it("should return evaluation response for valid request", async () => {
            const validRequest = await createEvaluatePayload();
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", validRequest);

            if (response.statusCode !== 200) {
                console.log("Response body:", response.json());
            }
            expect(response.statusCode).toBe(200);
            const body = response.json();

            expect(body.riskScore).toBeDefined();
            expect(body.riskScore).toBeGreaterThanOrEqual(0);
            expect(body.riskScore).toBeLessThanOrEqual(1);
            expect(body.sessionId).toBeDefined();
            expect(body.challengeUrl).toBeDefined();
            expect(body.challengeUrl).toContain("/api/v1/iframe/");
            expect(body.challengeExpiresAt).toBeDefined();
        });

        it("should create challenge session in database", async () => {
            const validRequest = await createEvaluatePayload();
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", validRequest);

            const body = response.json();
            const session = server.db.getChallengeSessionBySessionId(body.sessionId);

            expect(session).toBeDefined();
            expect(session?.subplebbitPublicKey).toBe(testSigner.publicKey);
            expect(session?.status).toBe("pending");
        });

        it("should return lower risk score for established author", async () => {
            // Test established author - subplebbit data indicates established user
            // (Note: address must match publication signer's public key for signature verification)
            const establishedAuthorRequest = await createEvaluatePayload({
                subplebbitOverrides: {
                    firstCommentTimestamp: baseTimestamp - 400 * 86400, // 400 days ago
                    postScore: 150,
                    replyScore: 50
                }
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", establishedAuthorRequest);

            const body = response.json();
            expect(body.riskScore).toBeLessThan(0.5); // Should be below neutral
        });

        it("should return higher risk score for new author", async () => {
            // First get the established author's score (100 days old with positive karma)
            // (Note: Both use same signer/address - we're testing subplebbit data differences)
            const establishedRequest = await createEvaluatePayload({
                commentOverrides: { content: "Established author content" },
                subplebbitOverrides: {
                    firstCommentTimestamp: baseTimestamp - 100 * 86400, // 100 days ago
                    postScore: 50,
                    replyScore: 20
                }
            });
            const establishedResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", establishedRequest);
            const establishedBody = establishedResponse.json();

            // Then get the new author's score (very new user with minimal history)
            const newAuthorRequest = await createEvaluatePayload({
                commentOverrides: { content: "New author content" },
                subplebbitOverrides: {
                    firstCommentTimestamp: baseTimestamp - 60, // Just 1 minute ago (very new)
                    postScore: -5, // Negative karma
                    replyScore: 0
                }
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", newAuthorRequest);

            const body = response.json();
            // New author should have higher risk than established author
            expect(body.riskScore).toBeGreaterThan(establishedBody.riskScore);
        });

        it("should accept new author without subplebbit data", async () => {
            // author.subplebbit is optional - new authors who haven't published
            // in this subplebbit before won't have this field
            const payload = await createEvaluatePayload({
                omitSubplebbitAuthor: true
            });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.riskScore).toBeDefined();
            expect(body.riskScore).toBeGreaterThanOrEqual(0);
            expect(body.riskScore).toBeLessThanOrEqual(1);
            expect(body.sessionId).toBeDefined();
        });

        it("should return 400 for invalid request body", async () => {
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", { invalid: "data" });

            expect(response.statusCode).toBe(400);
        });

        it("should return 401 for invalid request signature", async () => {
            const payload = await createEvaluatePayload();
            // Tamper with signature by creating a new invalid one
            payload.signature.signature = new Uint8Array(64); // All zeros - invalid signature

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(401);
        });

        it("should return 400 for invalid subplebbit author data", async () => {
            const payload = await createEvaluatePayload({
                subplebbitOverrides: { lastCommentCid: "not-a-cid" }
            });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(400);
        });

        it("should return 400 for missing author address", async () => {
            const payload = await createEvaluatePayload({
                omitAuthorAddress: true
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(400);
        });

        it("should return 400 for missing subplebbit address", async () => {
            const payload = await createEvaluatePayload({
                omitSubplebbitAddress: true
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(400);
        });

        it("should return 400 for IPNS-addressed subplebbit", async () => {
            // IPNS addresses are free to create, making them vulnerable to sybil attacks
            // Only domain-addressed subplebbits are supported
            const payload = await createEvaluatePayload({
                commentOverrides: { subplebbitAddress: "12D3KooWIPNSSubplebbit" }
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(400);
            const body = response.json();
            expect(body.error).toContain("Only domain-addressed subplebbits are supported");
        });

        it("should return 401 for forged publication signature (attack vector)", async () => {
            // SECURITY TEST: A malicious subplebbit could try to forge a publication
            // with a fake author address to inflate the victim's velocity scores
            // Create a publication with a mismatched signature
            const forgedPayload = await createEvaluatePayload({
                // Use valid signer to create request signature, but forge the publication signature
                commentOverrides: {
                    // Provide a fake signature that doesn't match the content
                    signature: {
                        type: "ed25519",
                        signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // Invalid base64 signature
                        publicKey: authorSigner.publicKey,
                        signedPropertyNames: ["author", "subplebbitAddress", "timestamp", "protocolVersion", "content"]
                    }
                }
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", forgedPayload);

            expect(response.statusCode).toBe(401);
            const body = response.json();
            expect(body.error).toContain("Publication signature is invalid");
        });

        it("should return 401 for publication signed by different author (impersonation attack)", async () => {
            // SECURITY TEST: Subplebbit tries to submit publication claiming to be from
            // author A but signed by author B
            const victimAddress = authorPlebbitAddress; // The victim's address

            // Build comment claiming to be from victim (without subplebbit for signing)
            const commentWithoutSig = {
                author: {
                    address: victimAddress // Claiming to be the victim
                },
                subplebbitAddress: "test-sub.eth",
                timestamp: baseTimestamp,
                protocolVersion: "1",
                content: "Forged content to inflate victim's velocity"
            };

            // Sign with the attacker's (testSigner) key, not the victim's
            const attackerSignature = await signPublication(
                commentWithoutSig,
                testSigner, // Using wrong signer (attacker's key)
                CommentSignedPropertyNames
            );

            // Add author.subplebbit after signing (matches production flow)
            const comment = {
                ...commentWithoutSig,
                author: { ...commentWithoutSig.author, subplebbit: baseSubplebbitAuthor },
                signature: attackerSignature
            };

            const challengeRequest = { comment };
            const timestamp = Math.floor(Date.now() / 1000);
            const propsToSign = { challengeRequest, timestamp };
            const requestSignature = await createRequestSignature(propsToSign, testSigner);

            const payload = {
                ...propsToSign,
                signature: requestSignature
            };

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            // Should be rejected because signature.publicKey doesn't match author.address
            expect(response.statusCode).toBe(401);
            const body = response.json();
            expect(body.error).toContain("Publication signature is invalid");
        });

        it("should return 400 for unknown publication type", async () => {
            // SECURITY TEST: Unknown publication types should be rejected
            // Build a request with no known publication type (no comment, vote, etc.)
            const timestamp = Math.floor(Date.now() / 1000);
            const challengeRequest = {
                // No comment, vote, commentEdit, commentModeration, or subplebbitEdit
                unknownType: {
                    author: { address: authorPlebbitAddress },
                    content: "This is not a valid publication type"
                }
            };

            const propsToSign = { challengeRequest, timestamp };
            const requestSignature = await createRequestSignature(propsToSign, testSigner);

            const payload = {
                ...propsToSign,
                signature: requestSignature
            };

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            expect(response.statusCode).toBe(400);
            const body = response.json();
            // Zod validation catches this first with "missing publication" error
            expect(body.error).toContain("missing publication");
        });

        it("should return 409 Conflict when same publication is submitted twice (replay attack prevention)", async () => {
            // Create a properly signed publication
            const payload1 = await createEvaluatePayload({
                commentOverrides: { content: "Replay attack test content" }
            });

            // First submission should succeed
            const firstResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload1);
            expect(firstResponse.statusCode).toBe(200);
            const firstBody = firstResponse.json();
            expect(firstBody.sessionId).toBeDefined();

            // Submit the exact same payload again (same publication signature)
            // Need to re-sign the request but keep the same challengeRequest
            const timestamp2 = Math.floor(Date.now() / 1000);
            const propsToSign2 = { challengeRequest: payload1.challengeRequest, timestamp: timestamp2 };
            const requestSignature2 = await createRequestSignature(propsToSign2, testSigner);
            const payload2 = {
                ...propsToSign2,
                signature: requestSignature2
            };

            // Second submission with same publication signature should fail with 409
            const secondResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload2);
            expect(secondResponse.statusCode).toBe(409);
            const secondBody = secondResponse.json();
            expect(secondBody.error).toContain("Publication already submitted");
        });

        it("should not inflate velocity when replay attack is attempted", async () => {
            // Create a properly signed publication
            const payload = await createEvaluatePayload({
                commentOverrides: { content: "Velocity replay test content" }
            });

            // Get the author's public key from the publication signature
            const pubSignature = payload.challengeRequest.comment.signature as { publicKey: string };

            // Submit the same publication multiple times (with fresh request signatures each time)
            for (let i = 0; i < 3; i++) {
                const timestamp = Math.floor(Date.now() / 1000);
                const propsToSign = { challengeRequest: payload.challengeRequest, timestamp };
                const requestSignature = await createRequestSignature(propsToSign, testSigner);
                const replayPayload = {
                    ...propsToSign,
                    signature: requestSignature
                };
                await injectCbor(server.fastify, "POST", "/api/v1/evaluate", replayPayload);
            }

            // Check that velocity only counts 1 (not 3)
            const stats = server.db.getAuthorVelocityStats(pubSignature.publicKey, "post");
            expect(stats.lastHour).toBe(1);
            expect(stats.last24Hours).toBe(1);
        });

        it("should verify signature correctly when challengeRequest has extra fields (like full ChallengeRequestMessage from plebbit-js)", async () => {
            // This replicates the real structure sent by plebbit-js challenge package
            // The challengeRequest includes extra fields like type, encrypted, challengeRequestId, etc.
            // that are not part of DecryptedChallengeRequestSchema but ARE signed

            // Build comment without signature first (no author.subplebbit for signing)
            // Note: author.address must match the publication signer's public key
            const commentWithoutSig = {
                title: "Test Post",
                author: {
                    address: authorPlebbitAddress
                },
                content: "This is a test comment to see the challenge response.",
                timestamp: baseTimestamp,
                protocolVersion: "1.0.0",
                subplebbitAddress: "test-sub.eth"
            };

            // Sign the comment properly
            const commentSignature = await signPublication(commentWithoutSig, authorSigner, CommentSignedPropertyNames);

            // Add author.subplebbit after signing (matches production flow)
            const comment = {
                ...commentWithoutSig,
                author: { ...commentWithoutSig.author, subplebbit: baseSubplebbitAuthor },
                signature: commentSignature
            };

            // Full ChallengeRequestMessage structure (as sent by plebbit-js)
            // This includes fields that are NOT in DecryptedChallengeRequestSchema
            const challengeRequest = {
                type: "CHALLENGEREQUEST",
                comment,
                encrypted: {
                    iv: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
                    tag: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
                    type: "ed25519-aes-gcm",
                    ciphertext: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
                },
                signature: {
                    type: "ed25519",
                    publicKey: new Uint8Array(32),
                    signature: new Uint8Array(64),
                    signedPropertyNames: [
                        "challengeRequestId",
                        "protocolVersion",
                        "userAgent",
                        "timestamp",
                        "type",
                        "encrypted",
                        "acceptedChallengeTypes"
                    ]
                },
                timestamp: baseTimestamp,
                userAgent: "/plebbit-js:0.0.7/",
                protocolVersion: "1.0.0",
                challengeRequestId: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
                acceptedChallengeTypes: []
            };

            const timestamp = Math.floor(Date.now() / 1000);
            const propsToSign = { challengeRequest, timestamp };
            const signature = await createRequestSignature(propsToSign, testSigner);

            const payload = {
                ...propsToSign,
                signature
            };

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

            // This should return 200 - the extra fields in challengeRequest are allowed
            // because they're not part of DecryptedChallengeRequestSchema
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.riskScore).toBeDefined();
            expect(body.sessionId).toBeDefined();
        });
    });

    describe("Publication signature with author.subplebbit added after signing", () => {
        // Regression tests: In production, the subplebbit adds author.subplebbit to the
        // challenge request AFTER the author signs the publication. Since author is a signed
        // property, the modified author object should still verify correctly.

        const validCid = "QmYwAPJzv5CZsnAzt8auVZRn9p6nxfZmZ75W6rS4ju4Khu";

        const buildAndSignPayload = async ({
            publicationWithoutSig,
            signedPropertyNames,
            publicationType
        }: {
            publicationWithoutSig: Record<string, unknown>;
            signedPropertyNames: string[];
            publicationType: "comment" | "vote" | "commentEdit" | "commentModeration" | "subplebbitEdit"; // Note: commentEdit/commentModeration/subplebbitEdit rejected with 400
        }) => {
            // 1. Sign the publication WITHOUT author.subplebbit
            const pubSignature = await signPublication(publicationWithoutSig, authorSigner, signedPropertyNames);
            const signedPublication = { ...publicationWithoutSig, signature: pubSignature };

            // 2. Add author.subplebbit AFTER signing (matches production flow)
            const authorWithSubplebbit = {
                ...(signedPublication.author as Record<string, unknown>),
                subplebbit: baseSubplebbitAuthor
            };
            const publicationWithSubplebbitAuthor = { ...signedPublication, author: authorWithSubplebbit };

            // 3. Wrap in challenge request
            const challengeRequest = { [publicationType]: publicationWithSubplebbitAuthor };
            const timestamp = Math.floor(Date.now() / 1000);
            const propsToSign = { challengeRequest, timestamp };
            const requestSignature = await createRequestSignature(propsToSign, testSigner);

            return { ...propsToSign, signature: requestSignature };
        };

        it("should accept Comment signed without author.subplebbit", async () => {
            const payload = await buildAndSignPayload({
                publicationWithoutSig: {
                    author: { address: authorPlebbitAddress },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    content: "Hello world"
                },
                signedPropertyNames: CommentSignedPropertyNames,
                publicationType: "comment"
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            if (response.statusCode !== 200) {
                console.log("Comment response:", response.json());
            }
            expect(response.statusCode).toBe(200);
        });

        it("should accept Vote signed without author.subplebbit", async () => {
            const payload = await buildAndSignPayload({
                publicationWithoutSig: {
                    author: { address: authorPlebbitAddress },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    commentCid: validCid,
                    vote: 1
                },
                signedPropertyNames: VoteSignedPropertyNames,
                publicationType: "vote"
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            if (response.statusCode !== 200) {
                console.log("Vote response:", response.json());
            }
            expect(response.statusCode).toBe(200);
        });

        it("should reject CommentEdit with 400", async () => {
            const CommentEditSignedPropertyNames = [
                "timestamp",
                "flair",
                "subplebbitAddress",
                "author",
                "protocolVersion",
                "commentCid",
                "content",
                "deleted",
                "spoiler",
                "nsfw",
                "reason"
            ];
            const payload = await buildAndSignPayload({
                publicationWithoutSig: {
                    author: { address: authorPlebbitAddress },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    commentCid: validCid,
                    content: "Edited content"
                },
                signedPropertyNames: CommentEditSignedPropertyNames,
                publicationType: "commentEdit"
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            expect(response.statusCode).toBe(400);
        });

        it("should reject CommentModeration with 400", async () => {
            const CommentModerationSignedPropertyNames = [
                "timestamp",
                "subplebbitAddress",
                "author",
                "protocolVersion",
                "commentCid",
                "commentModeration"
            ];
            const payload = await buildAndSignPayload({
                publicationWithoutSig: {
                    author: { address: authorPlebbitAddress },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    commentCid: validCid,
                    commentModeration: { removed: true }
                },
                signedPropertyNames: CommentModerationSignedPropertyNames,
                publicationType: "commentModeration"
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            expect(response.statusCode).toBe(400);
        });

        it("should reject SubplebbitEdit with 400", async () => {
            const SubplebbitEditSignedPropertyNames = ["timestamp", "subplebbitAddress", "author", "protocolVersion", "subplebbitEdit"];
            const payload = await buildAndSignPayload({
                publicationWithoutSig: {
                    author: { address: authorPlebbitAddress },
                    subplebbitAddress: "test-sub.eth",
                    timestamp: baseTimestamp,
                    protocolVersion: "1",
                    subplebbitEdit: { title: "New title" }
                },
                signedPropertyNames: SubplebbitEditSignedPropertyNames,
                publicationType: "subplebbitEdit"
            });

            const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);
            expect(response.statusCode).toBe(400);
        });
    });

    describe("POST /api/v1/challenge/verify", () => {
        let sessionId: string;

        beforeEach(async () => {
            // Create a challenge session first
            const evaluatePayload = await createEvaluatePayload({
                commentOverrides: { subplebbitAddress: "verify-sub.eth" }
            });
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", evaluatePayload);

            const evalBody = evalResponse.json();
            sessionId = evalBody.sessionId;
        });

        it("should return success when challenge is completed", async () => {
            // Mark the challenge as completed (simulating /complete was called)
            server.db.updateChallengeSessionStatus(sessionId, "completed", Math.floor(Date.now() / 1000));

            const payload = await createVerifyPayload({ sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(true);
            expect(body.challengeType).toBe("turnstile");
        });

        it("should return 200 with success:false when challenge is still pending", async () => {
            // Session is created as "pending" by default
            const payload = await createVerifyPayload({ sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("not yet completed");
        });

        it("should return unified pending error for oauth_sufficient tier", async () => {
            const captchaSession = server.db.insertChallengeSession({
                sessionId: "captcha-only-pending",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000,
                challengeTier: "oauth_sufficient",
                riskScore: 0.3
            });

            const payload = await createVerifyPayload({ sessionId: captchaSession.sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toBe("Challenge not yet completed");
        });

        it("should return unified pending error for oauth_plus_more tier", async () => {
            const combinedSession = server.db.insertChallengeSession({
                sessionId: "combined-neither-pending",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000,
                challengeTier: "oauth_plus_more",
                riskScore: 0.6
            });

            const payload = await createVerifyPayload({ sessionId: combinedSession.sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toBe("Challenge not yet completed");
        });

        it("should return unified pending error even when captcha is done but OAuth pending", async () => {
            const combinedSession = server.db.insertChallengeSession({
                sessionId: "combined-captcha-done",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000,
                challengeTier: "oauth_plus_more",
                riskScore: 0.6
            });
            server.db.updateChallengeSessionCaptchaCompleted(combinedSession.sessionId);

            const payload = await createVerifyPayload({ sessionId: combinedSession.sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toBe("Challenge not yet completed");
        });

        it("should return unified pending error when challengeTier is null", async () => {
            const noTierSession = server.db.insertChallengeSession({
                sessionId: "no-tier-pending",
                subplebbitPublicKey: testSigner.publicKey,
                expiresAt: Date.now() + 600_000
            });

            const payload = await createVerifyPayload({ sessionId: noTierSession.sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toBe("Challenge not yet completed");
        });

        it("should return 404 for non-existent challenge", async () => {
            const payload = await createVerifyPayload({
                sessionId: "non-existent-challenge-id"
            });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(404);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("not found");
        });

        it("should return 401 for mismatched signer", async () => {
            // Mark as completed first
            server.db.updateChallengeSessionStatus(sessionId, "completed", Math.floor(Date.now() / 1000));

            const payload = await createVerifyPayload({
                sessionId,
                signer: alternateSigner
            });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(401);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("signature");
        });

        it("should return 200 with success:false for failed challenge", async () => {
            // Mark challenge as failed
            server.db.updateChallengeSessionStatus(sessionId, "failed", Math.floor(Date.now() / 1000));

            const payload = await createVerifyPayload({ sessionId });
            const response = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", payload);

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("failed");
        });
    });

    describe("GET /api/v1/iframe/:sessionId", () => {
        let sessionId: string;

        beforeEach(async () => {
            // Create a challenge session first
            const evaluatePayload = await createEvaluatePayload({
                commentOverrides: { subplebbitAddress: "iframe-sub.eth" }
            });
            const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", evaluatePayload);

            const evalBody = evalResponse.json();
            sessionId = evalBody.sessionId;
        });

        it("should serve iframe HTML for valid challenge", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toContain("text/html");
            expect(response.body).toContain("<!DOCTYPE html>");
            expect(response.body).toContain("Verify you are human");
            expect(response.body).toContain("cf-turnstile");
            expect(response.body).toContain(sessionId);
        });

        it("should return 404 for non-existent challenge", async () => {
            const response = await server.fastify.inject({
                method: "GET",
                url: "/api/v1/iframe/non-existent-challenge-id"
            });

            expect(response.statusCode).toBe(404);
        });

        it("should return 409 for already completed challenge", async () => {
            // Complete the challenge first
            server.db.updateChallengeSessionStatus(sessionId, "completed", Math.floor(Date.now() / 1000));

            const response = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });

            expect(response.statusCode).toBe(409);
        });

        it("should return 409 on second iframe access", async () => {
            // First access should succeed
            const firstResponse = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });
            expect(firstResponse.statusCode).toBe(200);

            // Second access should return 409
            const secondResponse = await server.fastify.inject({
                method: "GET",
                url: `/api/v1/iframe/${sessionId}`
            });
            expect(secondResponse.statusCode).toBe(409);
            expect(secondResponse.body).toContain("Challenge already accessed and pending completion");
        });
    });
});

describe("allowNonDomainSubplebbits config", () => {
    let server: SpamDetectionServer;

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should accept IPNS-addressed subplebbit when allowNonDomainSubplebbits is true", async () => {
        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            allowNonDomainSubplebbits: true
        });
        await server.fastify.ready();

        const payload = await createEvaluatePayload({
            commentOverrides: { subplebbitAddress: "12D3KooWIPNSSubplebbit" }
        });

        const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.riskScore).toBeDefined();
        expect(body.sessionId).toBeDefined();
    });

    it("should reject IPNS-addressed subplebbit by default (allowNonDomainSubplebbits not set)", async () => {
        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY
        });
        await server.fastify.ready();

        const payload = await createEvaluatePayload({
            commentOverrides: { subplebbitAddress: "12D3KooWIPNSSubplebbit" }
        });

        const response = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", payload);

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toContain("Only domain-addressed subplebbits are supported");
    });
});

// Cloudflare Turnstile additional test keys
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"; // Always passes validation
const TURNSTILE_FAIL_SECRET_KEY = "2x0000000000000000000000000000000AA"; // Always fails validation

describe("Turnstile E2E Flow", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_TEST_SECRET_KEY
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should complete full Turnstile flow with Cloudflare test keys", async () => {
        // Step 1: Create challenge session via /evaluate
        const evaluatePayload = await createEvaluatePayload();
        const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", evaluatePayload);

        expect(evalResponse.statusCode).toBe(200);
        const evalBody = evalResponse.json();
        const sessionId = evalBody.sessionId;
        expect(sessionId).toBeDefined();

        // Step 2: Get iframe and verify it contains the test site key
        const iframeResponse = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        expect(iframeResponse.statusCode).toBe(200);
        expect(iframeResponse.body).toContain(`data-sitekey="${TURNSTILE_TEST_SITE_KEY}"`);

        // Step 3: Complete challenge with dummy token
        // Cloudflare test secret key accepts any token when paired with test site key
        const completeResponse = await server.fastify.inject({
            method: "POST",
            url: "/api/v1/challenge/complete",
            payload: {
                sessionId,
                challengeResponse: "XXXX.DUMMY.TOKEN.XXXX",
                challengeType: "turnstile"
            }
        });

        expect(completeResponse.statusCode).toBe(200);
        const completeBody = completeResponse.json();
        expect(completeBody.success).toBe(true);
        // No token returned - completion is tracked server-side

        // Step 4: Verify the challenge is completed (server checks DB status)
        const verifyPayload = await createVerifyPayload({ sessionId });
        const verifyResponse = await injectCbor(server.fastify, "POST", "/api/v1/challenge/verify", verifyPayload);

        expect(verifyResponse.statusCode).toBe(200);
        const verifyBody = verifyResponse.json();
        expect(verifyBody.success).toBe(true);
        expect(verifyBody.challengeType).toBe("turnstile");

        // Verify session is marked as completed
        const session = server.db.getChallengeSessionBySessionId(sessionId);
        expect(session?.status).toBe("completed");
    });

    it("should serve iframe with correct Turnstile site key", async () => {
        const evaluatePayload = await createEvaluatePayload();
        const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", evaluatePayload);

        const { sessionId } = evalResponse.json();

        const iframeResponse = await server.fastify.inject({
            method: "GET",
            url: `/api/v1/iframe/${sessionId}`
        });

        expect(iframeResponse.statusCode).toBe(200);
        expect(iframeResponse.headers["content-type"]).toContain("text/html");
        expect(iframeResponse.body).toContain("cf-turnstile");
        expect(iframeResponse.body).toContain(`data-sitekey="${TURNSTILE_TEST_SITE_KEY}"`);
        expect(iframeResponse.body).toContain("onTurnstileSuccess");
        expect(iframeResponse.body).toContain("onTurnstileError");
    });
});

describe("Turnstile Failure Scenarios", () => {
    let server: SpamDetectionServer;

    beforeEach(async () => {
        const getSubplebbit = vi.fn().mockResolvedValue({ signature: { publicKey: testSigner.publicKey } });
        setPlebbitLoaderForTest(async () => ({
            getSubplebbit,
            destroy: vi.fn().mockResolvedValue(undefined)
        }));
        // Use the always-failing secret key
        server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:",
            baseUrl: "http://localhost:3000",
            turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
            turnstileSecretKey: TURNSTILE_FAIL_SECRET_KEY
        });
        await server.fastify.ready();
    });

    afterEach(async () => {
        await server.stop();
        resetPlebbitLoaderForTest();
    });

    it("should return 401 when Turnstile verification fails", async () => {
        // Create challenge
        const evaluatePayload = await createEvaluatePayload();
        const evalResponse = await injectCbor(server.fastify, "POST", "/api/v1/evaluate", evaluatePayload);

        const { sessionId } = evalResponse.json();

        // Try to complete with failing secret key
        const completeResponse = await server.fastify.inject({
            method: "POST",
            url: "/api/v1/challenge/complete",
            payload: {
                sessionId,
                challengeResponse: "XXXX.DUMMY.TOKEN.XXXX",
                challengeType: "turnstile"
            }
        });

        expect(completeResponse.statusCode).toBe(401);
        const body = completeResponse.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("Turnstile verification failed");
    });
});
