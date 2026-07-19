import { initializeApp, type FirebaseApp } from 'firebase/app'
import { collection, doc, getFirestore, onSnapshot, query, where, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const FIRESTORE_COLLECTIONS = {
  sessions: 'ramp_sessions',
  flights: 'aportipay_flights',
  aaLidsFlights: 'flights',
  aaLidsPassengers: 'passengers',
  chatMessages: 'operation_messages',
  flightClosures: 'aportipay_flight_closures',
} as const

let app: FirebaseApp | null = null
let firestore: Firestore | null = null

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)
}

export function getFirebaseDb() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID.')
  }
  if (!app) {
    app = initializeApp(firebaseConfig)
    firestore = getFirestore(app)
  }
  return firestore as Firestore
}

export function subscribeCollection(
  collectionName: string,
  onChange: () => void,
  options?: { field?: string; value?: string },
) {
  if (!isFirebaseConfigured()) return undefined

  const db = getFirebaseDb()
  const base = collection(db, collectionName)
  const target = options?.field && options.value
    ? query(base, where(options.field, '==', options.value))
    : base

  return onSnapshot(target, onChange, () => {
    // Fall back to polling when Firestore rules or indexes block live updates.
  })
}

export function subscribeWorkspaceSession(sessionId: string, onChange: () => void) {
  if (!isFirebaseConfigured()) return undefined
  return onSnapshot(doc(getFirebaseDb(), FIRESTORE_COLLECTIONS.sessions, sessionId), onChange, () => {})
}
