import * as cborg from "cborg";
import { verifyBufferEd25519 } from "../pkc-js-signer.js";

export interface CborRequestSignature {
    signature: Uint8Array;
    publicKey: Uint8Array;
    type: string;
    signedPropertyNames: string[];
}

const requestSignatureError = (message: string) => {
    const error = new Error(message);
    (error as { statusCode?: number }).statusCode = 401;
    return error;
};

export const verifySignedRequest = async (payload: Record<string, unknown>, signature: CborRequestSignature): Promise<void> => {
    const signedKeys = signature.signedPropertyNames ?? [];

    if (!signedKeys.length) {
        throw requestSignatureError("Request signature has no signed fields");
    }

    // Build the signed payload from the specified properties
    const propsToSign: Record<string, unknown> = {};
    for (const key of signedKeys) {
        propsToSign[key] = payload[key];
    }

    // Encode and verify
    const encoded = cborg.encode(propsToSign);
    const isValid = await verifyBufferEd25519(encoded, signature.signature, signature.publicKey);

    if (!isValid) {
        throw requestSignatureError("Request signature is invalid");
    }
};
