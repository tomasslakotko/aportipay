import { useEffect, useState } from 'react'
import { FIRESTORE_COLLECTIONS, isFirebaseConfigured, subscribeCollection } from './firebaseClient'
import * as firebaseDb from './firebaseDatabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

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
  source?: 'aportipay' | 'aa-lids' | 'snapp' | 'local'
  gate?: string
  boardingTime?: string
  delayMinutes?: number
  createdAt?: string
  updatedAt?: string
}

export const isAaLidsFlightId = (id: string) => id.startsWith('aalids-')

export type NewAdminFlight = Omit<AdminFlight, 'id' | 'createdAt' | 'updatedAt'>

export const fetchFlights = async (): Promise<AdminFlight[]> => {
  if (isFirebaseConfigured()) return firebaseDb.fetchFlights()

  const response = await fetch(`${API_BASE_URL}/api/flights`)
  if (!response.ok) throw new Error(`Unable to load flights: ${response.status}`)

  return response.json() as Promise<AdminFlight[]>
}

export const createFlight = async (flight: NewAdminFlight): Promise<AdminFlight> => {
  if (isFirebaseConfigured()) return firebaseDb.createFlight(flight)

  const response = await fetch(`${API_BASE_URL}/api/flights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flight),
  })

  if (!response.ok) throw new Error(`Unable to create flight: ${response.status}`)

  return response.json() as Promise<AdminFlight>
}

export const deleteFlight = async (id: string): Promise<void> => {
  if (isFirebaseConfigured()) {
    await firebaseDb.deleteFlight(id)
    return
  }

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

    const unsubscribeFirestore = isFirebaseConfigured()
      ? [
          subscribeCollection(FIRESTORE_COLLECTIONS.flights, () => { void load() }),
          subscribeCollection(FIRESTORE_COLLECTIONS.aaLidsFlights, () => { void load() }),
        ]
      : []

    const interval = window.setInterval(() => {
      void load()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      unsubscribeFirestore.forEach((unsubscribe) => unsubscribe?.())
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
