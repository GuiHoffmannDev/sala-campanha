import type { Membership } from '../data/team.ts'

const KEY = 'sala.workspace'

/** The stored workspace while the person is still a member of it; else the first one; null without any. */
export function pickWorkspace(memberships: Membership[], stored: string | null): string | null {
  if (stored && memberships.some((m) => m.teamId === stored)) return stored
  return memberships[0]?.teamId ?? null
}

/** The last workspace the person opened, or null when nothing is stored or storage is unavailable. */
export function loadStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Remembers the open workspace. A storage failure only loses the memory, never the switch. */
export function storeWorkspace(teamId: string): void {
  try {
    localStorage.setItem(KEY, teamId)
  } catch {
    // Private mode or blocked storage: the next start opens the first workspace.
  }
}
