import { useEffect, useState } from 'react'
import type { AdminFlight } from './flightApi'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const FALLBACK_PUBLIC_URL =
  (import.meta.env.VITE_SNAPP_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://snapp-ops.vercel.app'

export type FlightCatalogSource = 'local' | 'snapp'

export const fetchSnappFlights = async (): Promise<AdminFlight[]> => {
  const response = await fetch(`${API_BASE_URL}/api/snapp/flights`)
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Unable to load SNAPP flights: ${response.status}`)
  }
  const rows = (await response.json()) as AdminFlight[]
  return rows.map((row) => ({ ...row, source: 'snapp' as const }))
}

export const patchSnappFlight = async (
  id: string,
  patch: {
    status?: string
    gate_departure?: string
    gate_arrival?: string
    boarding_time?: string
    delay_minutes?: number
  },
): Promise<AdminFlight> => {
  const response = await fetch(`${API_BASE_URL}/api/snapp/flights/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Unable to update SNAPP flight: ${response.status}`)
  }
  return response.json() as Promise<AdminFlight>
}

export const fetchSnappConfig = async (): Promise<{ configured: boolean; publicBaseUrl: string }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/snapp/config`)
    if (!response.ok) return { configured: false, publicBaseUrl: FALLBACK_PUBLIC_URL }
    const data = (await response.json()) as { configured?: boolean; publicBaseUrl?: string }
    return {
      configured: Boolean(data.configured),
      publicBaseUrl: (data.publicBaseUrl || FALLBACK_PUBLIC_URL).replace(/\/$/, ''),
    }
  } catch {
    return { configured: false, publicBaseUrl: FALLBACK_PUBLIC_URL }
  }
}

export const snappBoardingUrl = (flightId: string, publicBaseUrl = FALLBACK_PUBLIC_URL) =>
  `${publicBaseUrl.replace(/\/$/, '')}/boarding/${encodeURIComponent(flightId)}`

export const snappFlightUrl = (flightId: string, publicBaseUrl = FALLBACK_PUBLIC_URL) =>
  `${publicBaseUrl.replace(/\/$/, '')}/flights/${encodeURIComponent(flightId)}`

export const useLiveSnappFlights = (enabled: boolean) => {
  const [flights, setFlights] = useState<AdminFlight[]>([])
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(false)
  const [publicBaseUrl, setPublicBaseUrl] = useState(FALLBACK_PUBLIC_URL)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      try {
        const [cfg, data] = await Promise.all([fetchSnappConfig(), fetchSnappFlights()])
        if (cancelled) return
        setConfigured(cfg.configured)
        setPublicBaseUrl(cfg.publicBaseUrl)
        setFlights(data)
        setError('')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load SNAPP flights.')
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void load()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled])

  return {
    flights,
    error,
    configured,
    publicBaseUrl,
    refresh: async () => {
      try {
        setFlights(await fetchSnappFlights())
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh SNAPP flights.')
      }
    },
  }
}
