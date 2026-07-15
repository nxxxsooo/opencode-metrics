export interface SessionTiming {
  elapsedMs: number
  activeSince: number | null
}

export function startSessionTiming(
  timings: Map<string, SessionTiming>,
  sessionID: string,
  now: number,
): void {
  const timing = timings.get(sessionID)
  if (!timing) {
    timings.set(sessionID, { elapsedMs: 0, activeSince: now })
    return
  }
  if (timing.activeSince === null) timing.activeSince = now
}

export function stopSessionTiming(
  timings: Map<string, SessionTiming>,
  sessionID: string,
  now: number,
): void {
  const timing = timings.get(sessionID)
  if (!timing || timing.activeSince === null) return
  timing.elapsedMs += Math.max(0, now - timing.activeSince)
  timing.activeSince = null
}

export function getSessionElapsedMs(timing: SessionTiming | undefined, now: number): number {
  if (!timing) return 0
  return timing.elapsedMs + (timing.activeSince === null ? 0 : Math.max(0, now - timing.activeSince))
}
