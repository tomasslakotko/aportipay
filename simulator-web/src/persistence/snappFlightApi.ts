import { useEffect, useState } from 'react'
import type { AdminFlight } from './flightApi'

const FALLBACK_PUBLIC_URL =
  (import.meta.env.VITE_SNAPP_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://snapp-ops.vercel.app'

/**
 * Resolve API base for SNAPP proxy.
 * - Local Vite: prefer localhost:8787 (or VITE_API_BASE_URL)
 * - Hosted (aportipay.vercel.app): always same-origin "" so /api/snapp hits Vercel functions
 *   (never call localhost from a user's browser on production)
 */
export function resolveSnappApiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || ''
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    const isLocalHost = host === 'localhost' || host === '127.0.0.1'
    if (!isLocalHost) {
      // Production / preview / LAN IP to Vercel — use same-origin serverless
      if (!raw || /localhost|127\.0\.0\.1/i.test(raw)) return ''
      return raw.replace(/\/$/, '')
    }
  }
  if (raw) return raw.replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://localhost:8787'
  return ''
}

export type FlightCatalogSource = 'local' | 'snapp'

export const fetchSnappFlights = async (): Promise<AdminFlight[]> => {
  const base = resolveSnappApiBase()
  const response = await fetch(`${base}/api/snapp/flights`)
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
  const base = resolveSnappApiBase()
  const response = await fetch(`${base}/api/snapp/flights/${encodeURIComponent(id)}`, {
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

export const fetchSnappConfig = async (): Promise<{
  configured: boolean
  publicBaseUrl: string
  detail?: string
}> => {
  const base = resolveSnappApiBase()
  try {
    const response = await fetch(`${base}/api/snapp/config`)
    if (!response.ok) {
      return {
        configured: false,
        publicBaseUrl: FALLBACK_PUBLIC_URL,
        detail: `Config HTTP ${response.status} via ${base || window.location.origin}`,
      }
    }
    const data = (await response.json()) as { configured?: boolean; publicBaseUrl?: string }
    return {
      configured: Boolean(data.configured),
      publicBaseUrl: (data.publicBaseUrl || FALLBACK_PUBLIC_URL).replace(/\/$/, ''),
      detail: base || 'same-origin',
    }
  } catch (err) {
    return {
      configured: false,
      publicBaseUrl: FALLBACK_PUBLIC_URL,
      detail: err instanceof Error ? err.message : 'Network error',
    }
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
  const [statusDetail, setStatusDetail] = useState('Checking SNAPP…')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      const cfg = await fetchSnappConfig()
      if (cancelled) return
      setConfigured(cfg.configured)
      setPublicBaseUrl(cfg.publicBaseUrl)
      setStatusDetail(cfg.detail || '')

      try {
        const data = await fetchSnappFlights()
        if (cancelled) return
        setFlights(data)
        setError('')
        // Flights loaded ⇒ treat as configured even if config probe was flaky
        if (data.length >= 0) setConfigured(true)
      } catch (err) {
        if (cancelled) return
        setFlights([])
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
    statusDetail,
    refresh: async () => {
      try {
        setFlights(await fetchSnappFlights())
        setConfigured(true)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh SNAPP flights.')
      }
    },
  }
}
