import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export interface FlightClosure {
  id: number
  flightLabel: string
  signatureData: string
  closedBy: string | null
  closedDevice: string | null
  closedAt: string
  createdAt: string
}

export const fetchFlightClosures = async (): Promise<FlightClosure[]> => {
  const response = await fetch(`${API_BASE_URL}/api/flight-closures`)
  if (!response.ok) throw new Error(`Unable to load closures: ${response.status}`)
  return response.json() as Promise<FlightClosure[]>
}

export const closeFlightGlobally = async (
  flightLabel: string,
  signatureData: string,
  closedBy: string,
  closedDevice: string,
) => {
  const response = await fetch(`${API_BASE_URL}/api/flight-closures/${encodeURIComponent(flightLabel)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureData, closedBy, closedDevice }),
  })
  if (!response.ok) throw new Error(`Unable to close flight globally: ${response.status}`)
  return response.json() as Promise<FlightClosure>
}

export const reopenFlightGlobally = async (flightLabel: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/flight-closures/${encodeURIComponent(flightLabel)}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Unable to reopen flight globally: ${response.status}`)
  }
}

export const useLiveFlightClosures = () => {
  const [closures, setClosures] = useState<FlightClosure[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchFlightClosures()
        if (!cancelled) setClosures(data)
      } catch {
        // keep previous list
      }
    }
    void load()

    const interval = window.setInterval(() => {
      void load()
    }, 1500)

    let channel:
      | ReturnType<NonNullable<typeof supabase>['channel']>
      | undefined
    try {
      channel = supabase
        ?.channel('flight_closures:live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flight_closures' }, () => {
          void load()
        })
      if (channel) void channel.subscribe()
    } catch {
      channel = undefined
    }

    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [])

  return { closures }
}
