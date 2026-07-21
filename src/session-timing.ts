export interface SessionTiming {
  elapsedMs: number
  activeSince: number | null
  intervals?: Array<{ start: number; end: number }>
}

export function startSessionTiming(
  timings: Map<string, SessionTiming>,
  sessionID: string,
  now: number,
): void {
  const timing = timings.get(sessionID)
  if (!timing) {
    timings.set(sessionID, { elapsedMs: 0, activeSince: now, intervals: [] })
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
  timing.intervals ??= []
  timing.intervals.push({ start: timing.activeSince, end: now })
  timing.activeSince = null
}

export function getScopeElapsedMs(
  timings: Map<string, SessionTiming>,
  sessionIDs: readonly string[],
  now: number,
): number {
  const intervals: Array<{ start: number; end: number }> = []
  let unpositionedElapsedMs = 0

  for (const sessionID of sessionIDs) {
    const timing = timings.get(sessionID)
    if (!timing) continue
    const positionedMs = (timing.intervals ?? []).reduce(
      (total, interval) => total + Math.max(0, interval.end - interval.start),
      0,
    )
    for (const interval of timing.intervals ?? []) intervals.push(interval)
    if (timing.activeSince !== null) intervals.push({ start: timing.activeSince, end: now })
    unpositionedElapsedMs += Math.max(0, timing.elapsedMs - positionedMs)
  }

  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  let unionMs = 0
  let start: number | null = null
  let end: number | null = null
  for (const interval of intervals) {
    if (start === null || end === null) {
      start = interval.start
      end = interval.end
      continue
    }
    if (interval.start <= end) {
      end = Math.max(end, interval.end)
      continue
    }
    unionMs += Math.max(0, end - start)
    start = interval.start
    end = interval.end
  }
  if (start !== null && end !== null) unionMs += Math.max(0, end - start)
  return unionMs + unpositionedElapsedMs
}

export function getSessionElapsedMs(timing: SessionTiming | undefined, now: number): number {
  if (!timing) return 0
  return timing.elapsedMs + (timing.activeSince === null ? 0 : Math.max(0, now - timing.activeSince))
}
