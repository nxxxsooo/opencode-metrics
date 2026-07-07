import type { MetricsScope } from "./types"

export interface SessionTree {
  setParent(sessionID: string, parentID: string | null): void
  deleteSession(sessionID: string): void
  clear(): void
  getScopeSessionIDs(sessionID: string, scope: MetricsScope): readonly string[]
  getChildSessionCount(sessionID: string): number
}

export function createSessionTree(): SessionTree {
  const parentBySession = new Map<string, string | null>()

  function collectDescendants(sessionID: string, seen: Set<string>): string[] {
    const descendants: string[] = []
    for (const [candidateID, parentID] of parentBySession) {
      if (parentID !== sessionID || seen.has(candidateID)) continue
      seen.add(candidateID)
      descendants.push(candidateID, ...collectDescendants(candidateID, seen))
    }
    return descendants
  }

  return {
    setParent(sessionID: string, parentID: string | null): void {
      parentBySession.set(sessionID, parentID)
    },
    deleteSession(sessionID: string): void {
      parentBySession.delete(sessionID)
    },
    clear(): void {
      parentBySession.clear()
    },
    getScopeSessionIDs(sessionID: string, scope: MetricsScope): readonly string[] {
      if (scope === "current") return [sessionID]
      const seen = new Set<string>([sessionID])
      return [sessionID, ...collectDescendants(sessionID, seen)]
    },
    getChildSessionCount(sessionID: string): number {
      return collectDescendants(sessionID, new Set<string>([sessionID])).length
    },
  }
}
