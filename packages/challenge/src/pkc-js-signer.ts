import * as ed from "@noble/ed25519";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";

export const signBufferEd25519 = async (bufferToSign: Uint8Array, privateKeyBase64: string) => {
    const privateKeyBuffer = uint8ArrayFromString(privateKeyBase64, "base64");
    return ed.sign(bufferToSign, privateKeyBuffer);
};

export const getPublicKeyFromPrivateKey = async (privateKeyBase64: string) => {
    const privateKeyBuffer = uint8ArrayFromString(privateKeyBase64, "base64");
    const publicKeyBuffer = await ed.getPublicKey(privateKeyBuffer);
    return uint8ArrayToString(publicKeyBuffer, "base64");
};
