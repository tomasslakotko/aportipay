import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export interface AdminFlight {
  id: string
  carrier: string
  flightNo: string
  date: string
  dep: string
  arr: string
  time: string
  status: string
  aircraft: string
  controller: string
  createdAt?: string
  updatedAt?: string
}

export type NewAdminFlight = Omit<AdminFlight, 'id' | 'createdAt' | 'updatedAt'>

export const fetchFlights = async (): Promise<AdminFlight[]> => {
  const response = await fetch(`${API_BASE_URL}/api/flights`)
  if (!response.ok) throw new Error(`Unable to load flights: ${response.status}`)

  return response.json() as Promise<AdminFlight[]>
}

export const createFlight = async (flight: NewAdminFlight): Promise<AdminFlight> => {
  const response = await fetch(`${API_BASE_URL}/api/flights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flight),
  })

  if (!response.ok) throw new Error(`Unable to create flight: ${response.status}`)

  return response.json() as Promise<AdminFlight>
}

export const deleteFlight = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/flights/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) throw new Error(`Unable to delete flight: ${response.status}`)
}

export const useLiveFlights = () => {
  const [flights, setFlights] = useState<AdminFlight[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchFlights()
        if (!cancelled) {
          setFlights(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load flights.')
        }
      }
    }

    void load()

    let channel:
      | ReturnType<NonNullable<typeof supabase>['channel']>
      | undefined

    try {
      channel = supabase
        ?.channel('flights:live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flights' }, () => {
          void load()
        })
      if (channel) void channel.subscribe()
    } catch {
      channel = undefined
    }

    const interval = channel
      ? undefined
      : window.setInterval(() => {
          void load()
        }, 1500)

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [])

  return {
    flights,
    error,
    refresh: async () => {
      try {
        setFlights(await fetchFlights())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh flights.')
      }
    },
  }
}
