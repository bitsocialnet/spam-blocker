import { defineConfig } from "vitest/config";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkcEntry = require.resolve("@pkcprotocol/pkc-js");
const pkcRoot = path.resolve(path.dirname(pkcEntry), "..", "..");

export default defineConfig({
    test: {
        setupFiles: ["tests/setup.ts"],
        alias: {
            "@pkcprotocol/pkc-js/dist/node": path.join(pkcRoot, "dist/node")
        }
    }
});
