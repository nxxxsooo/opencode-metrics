import { applyAssistantDelta, applyAssistantPartDelta, applyAssistantProgress } from "./assistant-progress"
import { createFreshMetrics, estimateTokens } from "./metrics"
import {
  parseAssistantMessage,
  parseAssistantProgressPart,
  parseAssistantStepEnded,
  parseAssistantStepStarted,
  parseSessionInfo,
  parseTextPart,
  parseUserMessage,
} from "./event-shapes"
import { applyAssistantTokens, applySessionModel, hasPositiveAssistantTokens, mergeAssistantModel } from "./request-updates"
import { completeRequest, currentRequest } from "./request-state"
import { eventAggregateID, eventID, eventProperties, eventProperty, statusType, stringEventProperty } from "./event-bus"
import type { EventHandlerContext } from "./collector-state"
import { clearLiveSpeed, resetLiveSpeed } from "./live-speed"
import { ensureTurn, retireRequestIntoTurn, startTurn } from "./turn-state"

export function registerEventHandlers(ctx: EventHandlerContext): Array<() => void> {
  const { api, config, log, state, actions } = ctx
  const disposers: Array<() => void> = []

  function recordSession(value: unknown, defaultParentWhenMissing: boolean): void {
    const info = parseSessionInfo(value)
    if (!info) return
    if (info.hasParentID) {
      state.sessionTree.setParent(info.id, info.parentID)
    } else if (defaultParentWhenMissing) {
      state.sessionTree.setParent(info.id, null)
    }
  }

  function on(type: string, handler: (event: unknown) => void): void {
    for (const eventType of [type, `${type}.1`, `${type}.2`]) {
      disposers.push(api.event.on(eventType, (event) => {
        const id = eventID(event)
        const properties = eventProperties(event)
        let serialized = ""
        try {
          serialized = JSON.stringify(properties)
        } catch {
          serialized = ""
        }
        const key = id && eventAggregateID(event) ? `${type}:${id}:${serialized}` : ""
        if (key && state.seenEventKeys.has(key)) return
        if (key) {
          state.seenEventKeys.add(key)
          state.seenEventOrder.push(key)
          if (state.seenEventOrder.length > 4096) {
            const oldest = state.seenEventOrder.shift()
            if (oldest) state.seenEventKeys.delete(oldest)
          }
        }
        handler(event)
      }))
    }
  }

  function addAlias(left: string, right: string): void {
    if (left.length === 0 || right.length === 0 || left === right) return
    const leftAliases = state.sessionAliases.get(left) ?? new Set<string>()
    leftAliases.add(right)
    state.sessionAliases.set(left, leftAliases)
    const rightAliases = state.sessionAliases.get(right) ?? new Set<string>()
    rightAliases.add(left)
    state.sessionAliases.set(right, rightAliases)
  }

  function recordEventAlias(event: unknown, sessionID: string): void {
    addAlias(eventAggregateID(event), sessionID)
  }

  function clearPartEstimates(sessionID: string): void {
    for (const key of state.partTokenEstimates.keys()) {
      if (key.startsWith(`${sessionID}:`)) state.partTokenEstimates.delete(key)
    }
  }

  // ── session.created ──
  on("session.created", (event) => {
    recordSession(eventProperty(event, "info"), true)
    actions.notify()
  })

  // ── session.updated ──
  on("session.updated", (event) => {
    recordSession(eventProperty(event, "info"), false)
    actions.notify()
  })

  // ── session.status ──
  on("session.status", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    if (sessionID.length === 0) return
    recordEventAlias(event, sessionID)
    const type = statusType(event)
    log(`session.status: ${sessionID} -> ${type}`)

    if (type === "busy") {
      const now = performance.now()
      actions.startSessionTiming(sessionID, now)
      actions.clearHoldTimer(sessionID)
      const existingTurn = state.turns.get(sessionID)
      if (!existingTurn || existingTurn.isComplete) startTurn(state.turns, sessionID, now)
      const existing = state.requests.get(sessionID)
      if (existing && existing.isComplete) {
        const prev = existing
        state.requests.set(sessionID, createFreshMetrics(sessionID, "", prev.modelID, prev.providerID, now))
        clearLiveSpeed(state.liveSpeeds, sessionID)
        state.lastRequestSessionID = sessionID
        log(`new turn after idle: session=${sessionID}`)
        actions.notify()
      } else if (!existing) {
        state.requests.set(sessionID, createFreshMetrics(sessionID, "", "", "", now))
        state.lastRequestSessionID = sessionID
        actions.notify()
      }
    }

    if (type === "idle") {
      completeRequest({ state, actions, sessionID, now: performance.now(), holdDurationMs: config.holdDurationMs, log })
    }
  })

  on("session.idle", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    if (sessionID.length === 0) return
    recordEventAlias(event, sessionID)
    completeRequest({ state, actions, sessionID, now: performance.now(), holdDurationMs: config.holdDurationMs, log })
  })

  // ── message.part.delta ──
  on("message.part.delta", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    const messageID = stringEventProperty(event, "messageID")
    const delta = stringEventProperty(event, "delta")
    const field = stringEventProperty(event, "field")
    const partID = stringEventProperty(event, "partID") || `${messageID}:stream`
    if (sessionID.length === 0 || messageID.length === 0) return
    recordEventAlias(event, sessionID)
    if (field !== "text") return
    actions.startSessionTiming(sessionID, performance.now())

    const now = performance.now()
    ensureTurn(state.turns, sessionID, now)
    applyAssistantPartDelta(ctx, sessionID, messageID, partID, delta, now)
  })

  on("session.next.step.started", (event) => {
    const step = parseAssistantStepStarted(eventProperties(event), eventID(event))
    if (!step) return
    recordEventAlias(event, step.sessionID)
    const now = performance.now()
    actions.startSessionTiming(step.sessionID, now)
    const existingTurn = state.turns.get(step.sessionID)
    if (!existingTurn || existingTurn.isComplete) startTurn(state.turns, step.sessionID, now)
    state.assistantMessageIds.set(step.sessionID, step.messageID)
    clearPartEstimates(step.sessionID)
    if (step.modelID || step.providerID) {
      state.sessionModels.set(step.sessionID, { modelID: step.modelID, providerID: step.providerID })
    }
    const current = currentRequest({ state, actions, sessionID: step.sessionID, messageID: step.messageID, now })
    resetLiveSpeed(state.liveSpeeds, step.sessionID, step.messageID)
    applySessionModel(current, state.sessionModels.get(step.sessionID))
    actions.notify()
  })

  on("session.next.text.delta", (event) => applyAssistantDelta(ctx, event))

  on("session.next.reasoning.delta", (event) => applyAssistantDelta(ctx, event))

  on("session.next.step.ended", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    const fallbackMessageID = sessionID ? state.assistantMessageIds.get(sessionID) ?? eventID(event) : eventID(event)
    const step = parseAssistantStepEnded(eventProperties(event), fallbackMessageID)
    if (!step) return
    recordEventAlias(event, step.sessionID)
    const now = performance.now()
    actions.startSessionTiming(step.sessionID, now)
    const turn = ensureTurn(state.turns, step.sessionID, now)
    const existing = state.requests.get(step.sessionID)
    const isCurrent = existing?.messageID === step.messageID
    if (turn.finalizedSteps.get(step.messageID)?.exact) {
      log(`duplicate finalized step ignored: session=${step.sessionID} message=${step.messageID}`)
      return
    }
    const shouldStore = !existing
      || existing.messageID.length === 0
      || Boolean(state.userMessageIds.get(step.sessionID)?.has(existing.messageID))
    const current = isCurrent
      ? existing
      : createFreshMetrics(step.sessionID, step.messageID, existing?.modelID ?? "", existing?.providerID ?? "", now)
    if (shouldStore) {
      state.requests.set(step.sessionID, current)
      state.lastRequestSessionID = step.sessionID
    }
    if (applyAssistantTokens(current, step.tokens)) {
      log(`exact: in=${step.tokens.input} out=${step.tokens.output} cr=${step.tokens.cacheRead} cw=${step.tokens.cacheWrite}`)
    } else {
      log("assistant tokens all zero, skipping overwrite")
    }
    current.lastDeltaTime = now
    current.isStreaming = false
    retireRequestIntoTurn(turn, current, isCurrent || shouldStore)
    if (state.liveSpeeds.get(step.sessionID)?.messageID === step.messageID) {
      clearLiveSpeed(state.liveSpeeds, step.sessionID)
    }
    actions.notify()
  })

  // ── message.part.updated ──
  on("message.part.updated", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    if (sessionID.length === 0) return
    recordEventAlias(event, sessionID)
    const rawPart = eventProperty(event, "part")
    const part = parseTextPart(rawPart)
    const now = performance.now()
    const msgIds = state.userMessageIds.get(sessionID)
    if (part && msgIds?.has(part.messageID)) {
      const current = state.requests.get(sessionID)
      if (current) {
        if (!current.isComplete) actions.startSessionTiming(sessionID, now)
        current.estimatedInputTokens = estimateTokens(part.text, config.estimationRatio)
        log(`estimated input tokens: ${current.estimatedInputTokens} (textLen=${part.text.length})`)
        actions.notify()
      }
      return
    }

    const assistantPart = parseAssistantProgressPart(rawPart)
    if (assistantPart) {
      applyAssistantProgress(ctx, sessionID, assistantPart, now)
    }
  })

  // ── message.updated ──
  on("message.updated", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    if (sessionID.length === 0) return
    recordEventAlias(event, sessionID)
    const info = eventProperty(event, "info")

    const assistant = parseAssistantMessage(info)
    if (assistant) {
      const nextModel = mergeAssistantModel(state.sessionModels.get(sessionID), assistant)
      if (nextModel) state.sessionModels.set(sessionID, nextModel)

      const now = performance.now()
      const tokens = assistant.tokens
      const existing = state.requests.get(sessionID)
      const turn = ensureTurn(state.turns, sessionID, now)
      const hasPositive = hasPositiveAssistantTokens(tokens)
      const isCurrent = existing?.messageID === assistant.messageID
      const shouldUseAssistantMessage = assistant.messageID.length > 0 && (hasPositive || isCurrent)
      const current = shouldUseAssistantMessage
        ? isCurrent
          ? existing
          : turn.finalizedSteps.has(assistant.messageID)
            ? createFreshMetrics(sessionID, assistant.messageID, assistant.modelID, assistant.providerID, now)
            : currentRequest({ state, actions, sessionID, messageID: assistant.messageID, now })
        : existing
      if (current) {
        if (!current.isComplete) actions.startSessionTiming(sessionID, now)
        if (tokens) {
          if (applyAssistantTokens(current, tokens)) {
            log(`exact: in=${tokens.input} out=${tokens.output} cr=${tokens.cacheRead} cw=${tokens.cacheWrite}`)
            retireRequestIntoTurn(turn, current, isCurrent || state.requests.get(sessionID) === current)
          } else {
            log(`assistant tokens all zero, skipping overwrite`)
          }
        }
        applySessionModel(current, state.sessionModels.get(sessionID))
        if (assistant.completed && state.liveSpeeds.get(sessionID)?.messageID === assistant.messageID) {
          clearLiveSpeed(state.liveSpeeds, sessionID)
        }
        actions.notify()
      }
    }

    const user = parseUserMessage(info)
    if (user) {
      const userMsgID = user.messageID
      const current = state.requests.get(sessionID)
      if (current && current.messageID === userMsgID) {
        return
      }
      if (userMsgID && state.userMessageIds.get(sessionID)?.has(userMsgID)) {
        return
      }
      const now = performance.now()
      const previous = state.requests.get(sessionID)
      const previousTurn = state.turns.get(sessionID)
      if (previous && previousTurn) retireRequestIntoTurn(previousTurn, previous)
      startTurn(state.turns, sessionID, now)
      clearLiveSpeed(state.liveSpeeds, sessionID)
      clearPartEstimates(sessionID)
      const fresh = createFreshMetrics(sessionID, userMsgID, "", "", now)
      actions.startSessionTiming(sessionID, fresh.requestStartTime)
      if (userMsgID) {
        let msgIds = state.userMessageIds.get(sessionID)
        if (!msgIds) {
          msgIds = new Set()
          state.userMessageIds.set(sessionID, msgIds)
        }
        msgIds.add(userMsgID)
      }
      log(`user msg: id=${userMsgID}`)
      applySessionModel(fresh, state.sessionModels.get(sessionID))
      state.requests.set(sessionID, fresh)
      state.lastRequestSessionID = sessionID
      actions.notify()
    }
  })

  // ── session.deleted ──
  on("session.deleted", (event) => {
    const sessionID = stringEventProperty(event, "sessionID")
    if (sessionID.length === 0) return
    state.sessionTree.deleteSession(sessionID)
    state.sessionModels.delete(sessionID)
    state.sessionTimings.delete(sessionID)
    state.turns.delete(sessionID)
    state.liveSpeeds.delete(sessionID)
    state.userMessageIds.delete(sessionID)
    state.assistantMessageIds.delete(sessionID)
    state.sessionAliases.delete(sessionID)
    for (const aliases of state.sessionAliases.values()) {
      aliases.delete(sessionID)
    }
    for (const key of state.partTokenEstimates.keys()) {
      if (key.startsWith(`${sessionID}:`)) state.partTokenEstimates.delete(key)
    }
    actions.clearHoldTimer(sessionID)
    if (state.requests.has(sessionID)) {
      state.requests.delete(sessionID)
      if (state.lastRequestSessionID === sessionID) {
        state.lastRequestSessionID = [...state.requests.keys()].at(-1) ?? null
      }
      actions.notify()
    }
  })

  return disposers
}
