/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import type { TuiPlugin, TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { Event } from "@opencode-ai/sdk/v2"
import type { RequestMetrics } from "./types"
import { getConfig } from "./config"
import { createFreshMetrics, estimateTokens } from "./metrics"
import { log } from "./logger"
import { BarFooter } from "./components/BarFooter"

interface SessionInfoExt {
  id?: string
  parentID?: string | null
}
interface AssistantMessageExt {
  role?: string
  modelID?: string
  providerID?: string
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}
interface UserMessageExt {
  id?: string
  role?: string
}
interface PartExt {
  type?: string
  messageID?: string
  text?: string
}

const plugin: TuiPlugin = async (api, _options, _meta) => {
  const config = getConfig()

  let currentRequest: RequestMetrics | null = null
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  const sessionParents = new Map<string, string | null | undefined>()
  const sessionModels = new Map<string, { modelID: string; providerID: string }>()
  const userMessageIds = new Map<string, Set<string>>()

  const defaultFilter = (session: { parentID?: string | null }) => !session.parentID

  function shouldTrackSession(sessionID: string): boolean {
    const parentID = sessionParents.get(sessionID)
    if (parentID === undefined) return true
    return defaultFilter({ parentID })
  }

  // ── session.created ──
  api.event.on("session.created", (event: Extract<Event, { type: "session.created" }>) => {
    const info = event.properties.info
    if (info?.id) {
      sessionParents.set(info.id, (info as SessionInfoExt).parentID ?? null)
    }
  })

  // ── session.updated ──
  api.event.on("session.updated", (event: Extract<Event, { type: "session.updated" }>) => {
    const info = event.properties.info
    if (info?.id) {
      sessionParents.set(info.id, (info as SessionInfoExt).parentID ?? null)
    }
  })

  // ── session.status ──
  api.event.on("session.status", (event: Extract<Event, { type: "session.status" }>) => {
    const sessionID = event.properties.sessionID
    const status = event.properties.status
    log(`session.status: ${sessionID} -> ${status?.type}`)
    if (!shouldTrackSession(sessionID)) return

    if (status?.type === "busy") {
      // Cancel hold timer (new model request after tool call should not be cleared by previous timer)
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
      if (currentRequest && currentRequest.sessionID !== sessionID) {
        currentRequest = null
      } else if (currentRequest && currentRequest.sessionID === sessionID && currentRequest.isComplete) {
        const prev = currentRequest
        currentRequest = createFreshMetrics(sessionID, "", prev.modelID, prev.providerID, performance.now())
        log(`new model request after tool call: session=${sessionID}`)
      }
    }

    if (status?.type === "idle") {
      if (currentRequest && currentRequest.sessionID === sessionID) {
        currentRequest.isStreaming = false
        currentRequest.isComplete = true
        currentRequest.completeTime = performance.now()
        log(`request complete: session=${sessionID}`)
        if (config.holdDurationMs > 0) {
          holdTimer = setTimeout(() => {
            holdTimer = null
            if (currentRequest?.sessionID === sessionID) {
              currentRequest = null
            }
          }, config.holdDurationMs)
        }
      }
    }
  })

  // ── message.part.delta (assistant streaming output estimation) ──
  api.event.on("message.part.delta", (event: Extract<Event, { type: "message.part.delta" }>) => {
    const sessionID = event.properties.sessionID
    const messageID = event.properties.messageID
    const delta = event.properties.delta ?? ""
    const field = event.properties.field ?? ""
    if (!shouldTrackSession(sessionID)) return
    if (field !== "text") return

    if (!currentRequest || currentRequest.sessionID !== sessionID) {
      currentRequest = createFreshMetrics(sessionID, messageID, "", "", performance.now())
      const cached = sessionModels.get(sessionID)
      if (cached) {
        currentRequest.modelID = cached.modelID
        currentRequest.providerID = cached.providerID
      }
    }

    if (currentRequest.firstTokenTime === null) {
      currentRequest.firstTokenTime = performance.now()
    }

    currentRequest.estimatedOutputTokens += estimateTokens(delta, config.estimationRatio)
    currentRequest.lastDeltaTime = performance.now()
    currentRequest.isStreaming = true
  })

  // ── message.part.updated (collect user text for input token estimation) ──
  api.event.on("message.part.updated", (event: Extract<Event, { type: "message.part.updated" }>) => {
    const sessionID = event.properties.sessionID
    const part = event.properties.part as PartExt
    if (!part || part.type !== "text" || !part.messageID || !part.text) return
    if (!shouldTrackSession(sessionID)) return
    const msgIds = userMessageIds.get(sessionID)
    if (!msgIds || !msgIds.has(part.messageID)) return

    if (currentRequest && currentRequest.sessionID === sessionID) {
      currentRequest.estimatedInputTokens = estimateTokens(part.text, config.estimationRatio)
      log(`estimated input tokens: ${currentRequest.estimatedInputTokens} (textLen=${part.text.length})`)
    }
  })

  // ── message.updated ──
  api.event.on("message.updated", (event: Extract<Event, { type: "message.updated" }>) => {
    const sessionID = event.properties.sessionID
    const info = event.properties.info
    if (!shouldTrackSession(sessionID)) return

    const role: string = (info as AssistantMessageExt)?.role ?? ""

    if (role === "assistant") {
      const mid = (info as AssistantMessageExt).modelID
      const pid = (info as AssistantMessageExt).providerID
      if (mid || pid) {
        const existing = sessionModels.get(sessionID)
        sessionModels.set(sessionID, {
          modelID: mid || existing?.modelID || "",
          providerID: pid || existing?.providerID || "",
        })
      }

      if (currentRequest && currentRequest.sessionID === sessionID) {
        const tokens = (info as AssistantMessageExt).tokens
        if (tokens) {
          const input = Math.max(0, tokens.input ?? 0)
          const output = Math.max(0, tokens.output ?? 0)
          const reasoning = Math.max(0, tokens.reasoning ?? 0)
          const cacheRead = Math.max(0, tokens.cache?.read ?? 0)
          const cacheWrite = Math.max(0, tokens.cache?.write ?? 0)
          // Only overwrite when at least one value is non-zero (avoid all-zero tokens from message creation overwriting estimation)
          if (input + output + reasoning + cacheRead + cacheWrite > 0) {
            currentRequest.exactInputTokens = input
            currentRequest.exactOutputTokens = output
            currentRequest.exactReasoningTokens = reasoning
            currentRequest.exactCacheReadTokens = cacheRead
            currentRequest.exactCacheWriteTokens = cacheWrite
            currentRequest.hasExactTokens = true
            log(`exact: in=${input} out=${output} cr=${cacheRead} cw=${cacheWrite}`)
          } else {
            log(`assistant tokens all zero, skipping overwrite`)
          }
        }
        const cached = sessionModels.get(sessionID)
        if (cached) {
          currentRequest.modelID = cached.modelID
          currentRequest.providerID = cached.providerID
        }
      }
    }

    if (role === "user") {
      const userMsgID = (info as UserMessageExt).id ?? ""
      if (currentRequest && currentRequest.sessionID === sessionID && currentRequest.messageID === userMsgID) {
        return
      }
      currentRequest = createFreshMetrics(sessionID, userMsgID, "", "", performance.now())
      if (userMsgID) {
        let msgIds = userMessageIds.get(sessionID)
        if (!msgIds) {
          msgIds = new Set()
          userMessageIds.set(sessionID, msgIds)
        }
        msgIds.add(userMsgID)
      }
      log(`user msg: id=${userMsgID}`)
      const cached = sessionModels.get(sessionID)
      if (cached) {
        currentRequest.modelID = cached.modelID
        currentRequest.providerID = cached.providerID
      }
    }
  })

  // ── session.deleted ──
  api.event.on("session.deleted", (event: Extract<Event, { type: "session.deleted" }>) => {
    const sessionID = event.properties.sessionID
    sessionParents.delete(sessionID)
    sessionModels.delete(sessionID)
    userMessageIds.delete(sessionID)
    if (currentRequest?.sessionID === sessionID) {
      currentRequest = null
    }
  })

  // ── Slot registration ──
  api.slots.register({
    order: 50,
    slots: {
      session_prompt_right(ctx: TuiSlotContext, _props: { session_id: string }) {
        return (
          <BarFooter
            getMetrics={() => currentRequest}
            refreshIntervalMs={config.refreshIntervalMs}
            barConfig={config}
            theme={ctx.theme}
          />
        )
      },
    },
  })

  api.lifecycle.onDispose(() => {
    currentRequest = null
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    sessionParents.clear()
    sessionModels.clear()
    userMessageIds.clear()
  })

  log("opencode-bar initialized")
}

const pluginModule: { id: string; tui: TuiPlugin } = {
  id: "opencode-bar",
  tui: plugin,
}

export default pluginModule
