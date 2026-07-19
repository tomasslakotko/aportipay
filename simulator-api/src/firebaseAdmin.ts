import { readFileSync } from 'node:fs'
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

export const COLLECTIONS = {
  sessions: 'ramp_sessions',
  flights: 'aportipay_flights',
  chatMessages: 'operation_messages',
  flightClosures: 'aportipay_flight_closures',
  userRoles: 'aportipay_user_roles',
  users: 'aportipay_users',
} as const

let app: App | null = null
let firestore: Firestore | null = null

export function isFirebaseConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID)
}

function loadServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inlineJson) {
    return JSON.parse(inlineJson) as Record<string, string>
  }

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
  if (path) {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (projectId && clientEmail && privateKey) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey }
  }

  return null
}

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error('FIREBASE_PROJECT_ID must be set for simulator-api.')
  }

  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID as string
    const serviceAccount = loadServiceAccount()
    app = getApps()[0] ?? initializeApp(
      serviceAccount
        ? { credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId }
        : { credential: applicationDefault(), projectId },
    )
  }

  return app
}

export function getDb() {
  if (!firestore) {
    firestore = getFirestore(getFirebaseApp())
  }
  return firestore
}

export function getAdminAuth() {
  return getAuth(getFirebaseApp())
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    ) as T
  }
  return value
}
