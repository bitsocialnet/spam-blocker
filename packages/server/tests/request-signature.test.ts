import { describe, it, expect } from "vitest";
import * as cborg from "cborg";
import * as ed from "@noble/ed25519";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { verifySignedRequest, type CborRequestSignature } from "../src/security/request-signature.js";

// Generate a test keypair
const generateTestKeypair = async () => {
    const privateKeyBytes = ed.utils.randomPrivateKey();
    const publicKeyBytes = await ed.getPublicKey(privateKeyBytes);
    return {
        privateKey: privateKeyBytes,
        privateKeyBase64: uint8ArrayToString(privateKeyBytes, "base64"),
        publicKey: publicKeyBytes,
        publicKeyBase64: uint8ArrayToString(publicKeyBytes, "base64"),
        type: "ed25519"
    };
};

// Create a CBOR signature (mimics the challenge package's createRequestSignature)
const createCborSignature = async (
    propsToSign: Record<string, unknown>,
    privateKey: Uint8Array,
    publicKey: Uint8Array
): Promise<CborRequestSignature> => {
    const encoded = cborg.encode(propsToSign);
    const signatureBuffer = await ed.sign(encoded, privateKey);
    return {
        signature: signatureBuffer,
        publicKey: publicKey,
        type: "ed25519",
        signedPropertyNames: Object.keys(propsToSign)
    };
};

describe("verifySignedRequest with CBOR", () => {
    it("should verify a valid signature", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            message: "hello",
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // Should not throw
        await expect(verifySignedRequest(propsToSign, signature)).resolves.toBeUndefined();
    });

    it("should verify signature with nested objects", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            challengeRequest: {
                comment: {
                    author: { address: "12D3KooWTest" },
                    content: "Hello world",
                    communityAddress: "test-sub.eth"
                }
            },
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        await expect(verifySignedRequest(propsToSign, signature)).resolves.toBeUndefined();
    });

    it("should verify signature with Uint8Array fields preserved by CBOR", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            challengeRequest: {
                comment: {
                    author: { address: "12D3KooWTest" },
                    signature: {
                        signature: new Uint8Array([10, 20, 30, 40, 50]),
                        publicKey: "testPublicKey",
                        type: "ed25519"
                    }
                }
            },
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // With CBOR, Uint8Array is preserved through encode/decode
        await expect(verifySignedRequest(propsToSign, signature)).resolves.toBeUndefined();
    });

    it("should verify signature after CBOR encode/decode round-trip", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            data: new Uint8Array([1, 2, 3, 4, 5]),
            nested: {
                more: new Uint8Array([10, 20, 30])
            },
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // Simulate CBOR round-trip (what happens over HTTP with CBOR content type)
        const encoded = cborg.encode(propsToSign);
        const decoded = cborg.decode(encoded);

        // CBOR preserves Uint8Array perfectly
        expect(decoded.data).toBeInstanceOf(Uint8Array);
        expect(decoded.nested.more).toBeInstanceOf(Uint8Array);

        await expect(verifySignedRequest(decoded, signature)).resolves.toBeUndefined();
    });

    it("should reject signature with tampered data", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            message: "hello",
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // Tamper with the payload
        const tamperedPayload = {
            message: "goodbye",
            timestamp: 1234567890
        };

        await expect(verifySignedRequest(tamperedPayload, signature)).rejects.toThrow("Request signature is invalid");
    });

    it("should reject signature with wrong public key", async () => {
        const keypair1 = await generateTestKeypair();
        const keypair2 = await generateTestKeypair();
        const propsToSign = {
            message: "hello",
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair1.privateKey, keypair1.publicKey);

        // Use wrong public key
        const signatureWithWrongKey: CborRequestSignature = {
            ...signature,
            publicKey: keypair2.publicKey
        };

        await expect(verifySignedRequest(propsToSign, signatureWithWrongKey)).rejects.toThrow("Request signature is invalid");
    });

    it("should reject signature with tampered signature bytes", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            message: "hello",
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // Tamper with signature bytes
        const tamperedSignature: CborRequestSignature = {
            ...signature,
            signature: new Uint8Array(64) // All zeros - invalid
        };

        await expect(verifySignedRequest(propsToSign, tamperedSignature)).rejects.toThrow("Request signature is invalid");
    });

    it("should reject when signedPropertyNames is empty", async () => {
        const keypair = await generateTestKeypair();
        const payload = {
            message: "hello"
        };

        const signature: CborRequestSignature = {
            signature: new Uint8Array(64),
            publicKey: keypair.publicKey,
            type: "ed25519",
            signedPropertyNames: []
        };

        await expect(verifySignedRequest(payload, signature)).rejects.toThrow("Request signature has no signed fields");
    });

    it("should only verify signed properties (extra properties ignored)", async () => {
        const keypair = await generateTestKeypair();
        const propsToSign = {
            message: "hello",
            timestamp: 1234567890
        };

        const signature = await createCborSignature(propsToSign, keypair.privateKey, keypair.publicKey);

        // Add extra property to payload (not in signedPropertyNames)
        const payloadWithExtra = {
            ...propsToSign,
            extra: "this is not signed"
        };

        // Should still verify because we only verify the signed properties
        await expect(verifySignedRequest(payloadWithExtra, signature)).resolves.toBeUndefined();
    });
});

describe("CBOR encoding consistency", () => {
    it("should produce identical encoding for Uint8Array across encode/decode", () => {
        const original = { data: new Uint8Array([1, 2, 3, 4, 5]) };
        const encoded = cborg.encode(original);
        const decoded = cborg.decode(encoded);

        // CBOR preserves Uint8Array
        expect(decoded.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(decoded.data)).toEqual([1, 2, 3, 4, 5]);

        // Re-encoding should produce identical bytes
        const reencoded = cborg.encode(decoded);
        expect(Buffer.from(reencoded).toString("hex")).toBe(Buffer.from(encoded).toString("hex"));
    });

    it("should preserve nested Uint8Arrays through CBOR round-trip", () => {
        const original = {
            level1: {
                level2: {
                    data: new Uint8Array([255, 128, 64])
                }
            },
            array: [{ bytes: new Uint8Array([1, 2]) }, { bytes: new Uint8Array([3, 4]) }]
        };

        const encoded = cborg.encode(original);
        const decoded = cborg.decode(encoded);

        expect(decoded.level1.level2.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(decoded.level1.level2.data)).toEqual([255, 128, 64]);
        expect(decoded.array[0].bytes).toBeInstanceOf(Uint8Array);
        expect(decoded.array[1].bytes).toBeInstanceOf(Uint8Array);
    });
});
