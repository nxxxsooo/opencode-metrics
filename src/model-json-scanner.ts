/** Streaming JSON field observer: ignores content strings, retaining only keys and model IDs. */
export function createModelJsonScanner(onModel: (model: string, source: string) => void) {
  interface Frame { object: boolean; path: string[]; key: string | null; keyMode: boolean }
  const stack: Frame[] = []
  let inString = false
  let escaped = false
  let token = ""
  let capture = false
  let isKey = false
  let source: string | null = null
  let invalid = false
  return {
    push(text: string) {
      for (const char of text) {
        if (invalid) continue
        if (inString) {
          if (capture) {
            if (token.length < 6144) token += char
            else capture = false
          }
          if (escaped) { escaped = false; continue }
          if (char === "\\") { escaped = true; continue }
          if (char !== '"') continue
          inString = false
          if (capture) {
            try {
              const value: unknown = JSON.parse(token)
              const frame = stack.at(-1)
              if (isKey && frame) { frame.key = typeof value === "string" ? value : null; frame.keyMode = false }
              else if (source && typeof value === "string" && value.length > 0 && value.length <= 512
                && !/[\x00-\x1f\x7f-\x9f]/.test(value)) onModel(value, source)
            } catch { /* Incomplete or invalid string has no evidence. */ }
          } else if (isKey && stack.at(-1)) { stack.at(-1)!.key = null; stack.at(-1)!.keyMode = false }
          token = ""
          continue
        }
        const frame = stack.at(-1)
        if (char === '"') {
          inString = true
          escaped = false
          isKey = Boolean(frame?.object && frame.keyMode)
          source = !isKey && frame?.object && frame.key === "model"
            ? frame.path.length === 0 ? "model"
              : frame.path.length === 1 && ["response", "message"].includes(frame.path[0]!) ? `${frame.path[0]}.model` : null
            : null
          capture = isKey || source !== null
          token = capture ? '"' : ""
        } else if (char === "{" || char === "[") {
          if (stack.length >= 128) { invalid = true; continue }
          stack.push({ object: char === "{", path: frame ? [...frame.path, frame.object ? frame.key ?? "*" : "*"] : [], key: null, keyMode: char === "{" })
        } else if (char === "}" || char === "]") {
          if (!frame || frame.object !== (char === "}")) invalid = true
          else stack.pop()
        } else if (char === "," && frame?.object) { frame.key = null; frame.keyMode = true }
      }
    },
  }
}
