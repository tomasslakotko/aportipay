import type { SimulatorSnapshot } from '../store/useSimulatorStore'
import { useSimulatorStore } from '../store/useSimulatorStore'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

interface SessionRecord {
  id: string
  scenarioId: string
  score: number
  createdAt: string
  updatedAt: string
  snapshot: SimulatorSnapshot
}

const toSessionKeyPart = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const getRampSessionId = () => {
  const { openFlights, activeFlightIndex } = useSimulatorStore.getState()
  const activeFlight = openFlights[Math.max(0, Math.min(activeFlightIndex, openFlights.length - 1))]
  if (!activeFlight) return 'ramp-lobby'
  return `ramp-flight-${toSessionKeyPart(activeFlight) || 'unknown'}`
}

export const fetchLatestSession = async (sessionId = getRampSessionId()): Promise<SessionRecord | null> => {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Unable to load session: ${response.status}`)

  return response.json() as Promise<SessionRecord>
}

export const saveCurrentSession = async (
  snapshot: SimulatorSnapshot,
  sessionId = getRampSessionId(),
): Promise<SessionRecord> => {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })

  if (!response.ok) throw new Error(`Unable to save session: ${response.status}`)

  return response.json() as Promise<SessionRecord>
}
