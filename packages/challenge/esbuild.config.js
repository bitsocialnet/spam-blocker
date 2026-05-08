import * as esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/index.js",
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    // Bundle the shared package but keep other dependencies external
    external: ["@pkcprotocol/pkc-logger", "@noble/ed25519", "cborg", "uint8arrays", "zod", "i18n-iso-countries"]
});

console.log("Build complete");
