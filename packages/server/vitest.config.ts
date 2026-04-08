import { defineConfig } from "vitest/config";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const plebbitEntry = require.resolve("@plebbit/plebbit-js");
const plebbitRoot = path.resolve(path.dirname(plebbitEntry), "..", "..");

export default defineConfig({
    test: {
        setupFiles: ["tests/setup.ts"],
        alias: {
            "@plebbit/plebbit-js/dist/node": path.join(plebbitRoot, "dist/node")
        }
    }
});
