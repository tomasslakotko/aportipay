import type { SimulatorSnapshot } from '../store/useSimulatorStore'
import * as firebaseDb from './firebaseDatabase'
import { isFirebaseConfigured } from './firebaseClient'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const LOCAL_WORKSPACE_KEY = 'aportipay-workspace-snapshot'
const LOCAL_WORKSPACE_META_KEY = 'aportipay-workspace-meta'

interface SessionRecord {
  id: string
  scenarioId: string
  score: number
  createdAt: string
  updatedAt: string
  snapshot: SimulatorSnapshot
}

/** Stable workspace id — keeps open flights across page refresh/restart. */
export const getWorkspaceSessionId = () => {
  const configured = import.meta.env.VITE_SHARED_SESSION_ID as string | undefined
  return configured?.trim() || 'aportipay-workspace'
}

export const readLocalWorkspaceSnapshot = (): SimulatorSnapshot | null => {
  const raw = localStorage.getItem(LOCAL_WORKSPACE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SimulatorSnapshot
    return parsed?.version === 1 ? parsed : null
  } catch {
    return null
  }
}

export const readLocalWorkspaceUpdatedAt = () => {
  const raw = localStorage.getItem(LOCAL_WORKSPACE_META_KEY)
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: string }
    return Date.parse(parsed.updatedAt ?? '') || 0
  } catch {
    return 0
  }
}

export const writeLocalWorkspaceSnapshot = (snapshot: SimulatorSnapshot, updatedAt = new Date().toISOString()) => {
  localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(snapshot))
  localStorage.setItem(LOCAL_WORKSPACE_META_KEY, JSON.stringify({ updatedAt }))
}

export const fetchWorkspaceSession = async (): Promise<SessionRecord | null> =>
  fetchLatestSession(getWorkspaceSessionId())

export const saveWorkspaceSession = async (snapshot: SimulatorSnapshot): Promise<SessionRecord> => {
  writeLocalWorkspaceSnapshot(snapshot)
  return saveCurrentSession(snapshot, getWorkspaceSessionId())
}

export const fetchLatestSession = async (sessionId: string): Promise<SessionRecord | null> => {
  if (isFirebaseConfigured()) {
    return firebaseDb.fetchLatestSession(sessionId)
  }

  const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Unable to load session: ${response.status}`)

  return response.json() as Promise<SessionRecord>
}

export const saveCurrentSession = async (
  snapshot: SimulatorSnapshot,
  sessionId: string,
): Promise<SessionRecord> => {
  if (isFirebaseConfigured()) {
    return firebaseDb.saveCurrentSession(snapshot, sessionId)
  }

  const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })

  if (!response.ok) throw new Error(`Unable to save session: ${response.status}`)

  return response.json() as Promise<SessionRecord>
}
