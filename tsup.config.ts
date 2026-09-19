import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/tui.tsx", "src/server.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "@opentui/solid", "@opentui/core", "solid-js"],
  target: "esnext",
  esbuildOptions(options) {
    options.jsx = "preserve"
    // Keep lazy server dependencies inside the published dist/chunk-*.js set.
    options.chunkNames = "chunk-[hash]"
  },
})
