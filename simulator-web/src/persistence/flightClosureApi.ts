import { useEffect, useState } from 'react'
import { FIRESTORE_COLLECTIONS, isFirebaseConfigured, subscribeCollection } from './firebaseClient'
import * as firebaseDb from './firebaseDatabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

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
  if (isFirebaseConfigured()) return firebaseDb.fetchFlightClosures()

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
  if (isFirebaseConfigured()) {
    return firebaseDb.closeFlightGlobally(flightLabel, signatureData, closedBy, closedDevice)
  }

  const response = await fetch(`${API_BASE_URL}/api/flight-closures/${encodeURIComponent(flightLabel)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureData, closedBy, closedDevice }),
  })
  if (!response.ok) throw new Error(`Unable to close flight globally: ${response.status}`)
  return response.json() as Promise<FlightClosure>
}

export const reopenFlightGlobally = async (flightLabel: string): Promise<void> => {
  if (isFirebaseConfigured()) {
    await firebaseDb.reopenFlightGlobally(flightLabel)
    return
  }

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

    const unsubscribeFirestore = isFirebaseConfigured()
      ? subscribeCollection(FIRESTORE_COLLECTIONS.flightClosures, () => { void load() })
      : undefined

    const interval = window.setInterval(() => {
      void load()
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      unsubscribeFirestore?.()
    }
  }, [])

  return { closures }
}
