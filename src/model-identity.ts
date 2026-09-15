import { createModelJsonScanner } from "./model-json-scanner"

/** Identifiers reported at the local HTTP boundary, not verified upstream identities. */
export interface ModelIdentity {
  requested: string | null
  reported: string | null
  source: string | null
  observedAt: number
  previous?: boolean
}

export function modelIdentifier(value: unknown): string | null {
  // Reject terminal control characters; never render arbitrary response text.
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && !/[\x00-\x1f\x7f-\x9f]/.test(value) ? value : null
}

export function reportedModel(value: unknown): { model: string; source: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  for (const key of ["response", "message"]) {
    const nested = data[key]
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const model = modelIdentifier((nested as Record<string, unknown>).model)
      if (model) return { model, source: `${key}.model` }
    }
  }
  const model = modelIdentifier(data.model)
  return model ? { model, source: "model" } : null
}

/** Bounded incremental parser. Oversized events are discarded, never buffered forever. */
export function createModelParser(sse: boolean, onModel: (model: string, source: string) => void) {
  const decoder = new TextDecoder()
  let scanner = createModelJsonScanner(onModel)
  let prefix = ""
  let dataLine = false
  let lineHasText = false
  function consume(text: string) {
    if (!sse) { scanner.push(text); return }
    // Only the SSE prefix is buffered; arbitrarily large data lines stream through.
    for (const char of text) {
      if (char === "\r") continue
      if (char === "\n") {
        if (!lineHasText) scanner = createModelJsonScanner(onModel)
        else if (dataLine) scanner.push("\n")
        prefix = ""
        dataLine = false
        lineHasText = false
        continue
      }
      lineHasText = true
      if (prefix.length < 5) {
        prefix += char
        if (prefix === "data:") dataLine = true
      } else if (dataLine) scanner.push(char)
    }
  }
  return {
    push(chunk: Uint8Array) { consume(decoder.decode(chunk, { stream: true })) },
    end() {
      consume(decoder.decode())
      prefix = ""
    },
  }
}

export async function readRequestModel(request: Request): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try { reader = request.clone().body?.getReader() } catch { return null }
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4 * 1024 * 1024) return null
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return modelIdentifier(JSON.parse(new TextDecoder().decode(bytes)).model)
  } catch { return null } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
