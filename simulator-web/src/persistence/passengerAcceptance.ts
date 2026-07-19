import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { getFirebaseDb, isFirebaseConfigured } from './firebaseClient'

const COLLECTION = 'aportipay_passenger_acceptance'

const toDocId = (aaLidsFlightId: string | null, flightLabel: string) => {
  if (aaLidsFlightId) return aaLidsFlightId
  return flightLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'unknown-flight'
}

export const setPassengerAcceptanceFinalised = async (input: {
  flightLabel: string
  aaLidsFlightId?: string | null
  finalised: boolean
}) => {
  if (!isFirebaseConfigured()) return
  const now = new Date().toISOString()
  const aaLidsFlightId = input.aaLidsFlightId ?? null
  const docId = toDocId(aaLidsFlightId, input.flightLabel)
  await setDoc(doc(getFirebaseDb(), COLLECTION, docId), {
    flightLabel: input.flightLabel,
    aaLidsFlightId,
    finalised: input.finalised,
    finalisedAt: input.finalised ? now : null,
    updatedAt: now,
  }, { merge: true })
}

export const fetchPassengerAcceptanceFinalised = async (
  flightLabel: string,
  aaLidsFlightId?: string | null,
): Promise<boolean> => {
  if (!isFirebaseConfigured()) return false
  const docId = toDocId(aaLidsFlightId ?? null, flightLabel)
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTION, docId))
  if (!snapshot.exists()) return false
  return Boolean(snapshot.data().finalised)
}

export const subscribePassengerAcceptanceFinalised = (
  flightLabel: string,
  aaLidsFlightId: string | null | undefined,
  onChange: (finalised: boolean) => void,
) => {
  if (!isFirebaseConfigured()) return undefined
  const docId = toDocId(aaLidsFlightId ?? null, flightLabel)
  return onSnapshot(doc(getFirebaseDb(), COLLECTION, docId), (snapshot) => {
    onChange(Boolean(snapshot.data()?.finalised))
  })
}
