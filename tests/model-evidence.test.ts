import { describe, expect, test } from "bun:test"
import { createModelEvidence } from "../src/model-evidence"

describe("OpenLLMetry local model evidence", () => {
  test("keeps missing or invalid identifiers unknown, without a request-model fallback", () => {
    const evidence = createModelEvidence(123)
    evidence.request("alias")
    expect(evidence.identity).toEqual({ requested: "alias", reported: null, source: null, observedAt: 123 })
    evidence.request(null)
    expect(evidence.identity.requested).toBeNull()
    evidence.request("unsafe\x1b[31m")
    evidence.response("x".repeat(513), "model")
    expect(evidence.identity).toEqual({ requested: null, reported: null, source: null, observedAt: 123 })
    evidence.response("provider-model", "response.model")
    expect(evidence.identity).toMatchObject({ reported: "provider-model", source: "response.model" })
  })

  test("default-off server setup never loads the OpenLLMetry SDK", () => {
    const result = Bun.spawnSync([process.execPath, "--eval", `
      import { plugin } from "bun";
      plugin({ name: "block-sdk", setup(build) {
        build.onResolve({ filter: /^@traceloop\\// }, () => { throw new Error("SDK must stay unloaded"); });
      } });
      const { default: server } = await import("./src/server.ts");
      for (const options of [undefined, {}, { modelMonitor: false }, { modelMonitor: "true" }]) {
        await server.setup({ options });
      }
      console.log("disabled-ok");
    `], { cwd: import.meta.dir + "/..", timeout: 10_000 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe("disabled-ok")
    expect(result.stderr.toString()).toBe("")
  })

  test("SDK reporting preserves host tracing and performs no network exports", () => {
    const result = Bun.spawnSync([process.execPath, "--eval", `
      import { trace } from "@opentelemetry/api";
      import http from "node:http";
      import https from "node:https";
      let network = 0;
      const blocked = () => { network++; throw new Error("Unexpected network access"); };
      globalThis.fetch = blocked;
      http.request = https.request = http.get = https.get = blocked;
      let hostSpans = 0;
      const provider = { getTracer: () => ({ startSpan: () => { hostSpans++; throw new Error("Host tracer used"); } }) };
      trace.setGlobalTracerProvider(provider);
      const before = trace.getTracerProvider();
      const { createModelEvidence } = await import("./src/model-evidence.ts");
      const evidence = createModelEvidence(123);
      evidence.request("alias");
      evidence.response("replacement", "model");
      // Let any mistakenly scheduled exporter run before the subprocess exits.
      await new Promise(resolve => setTimeout(resolve, 30));
      console.log(JSON.stringify({ network, hostSpans, sameProvider: before === trace.getTracerProvider(), identity: evidence.identity }));
    `], {
      cwd: import.meta.dir + "/..",
      timeout: 10_000,
      env: { ...process.env, TRACELOOP_API_KEY: "test-only", TRACELOOP_BASE_URL: "http://127.0.0.1:9" },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe("")
    expect(JSON.parse(result.stdout.toString())).toEqual({
      network: 0, hostSpans: 0, sameProvider: true,
      identity: { requested: "alias", reported: "replacement", source: "model", observedAt: 123 },
    })
  })
})
