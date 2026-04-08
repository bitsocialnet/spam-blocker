import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import * as ed from "@noble/ed25519";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";

const require = createRequire(import.meta.url);
const pkcEntry = require.resolve("@pkcprotocol/pkc-js");
const pkcRoot = path.resolve(path.dirname(pkcEntry), "..", "..");

const signerUtilUrl = pathToFileURL(path.join(pkcRoot, "dist/node/signer/util.js")).href;

const [{ getPublicKeyFromPrivateKey }] = await Promise.all([import(signerUtilUrl)]);

export const signBufferEd25519 = async (bufferToSign: Uint8Array, privateKeyBase64: string) => {
    const privateKeyBuffer = uint8ArrayFromString(privateKeyBase64, "base64");
    return ed.sign(bufferToSign, privateKeyBuffer);
};

export { getPublicKeyFromPrivateKey };
