import { isFirebaseConfigured } from './firebaseClient'
import * as firebaseDb from './firebaseDatabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const AUTH_STORAGE_KEY = 'aportipay-auth-session'

export interface AuthSession {
  id: string
  email: string
  role: string
  emailConfirmed: boolean
}

const allowedRoles = new Set([
  'Ramp Agent',
  'Passenger Agent',
  'Freight Agent',
  'Fuel Agent',
  'Load Controller',
  'Check-in',
  'Supervisor',
  'Admin',
])
const DEFAULT_ROLE = 'Ramp Agent'

const readRoleField = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return allowedRoles.has(trimmed) ? trimmed : ''
}

const readStoredSession = (): AuthSession | null => {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed?.email || !parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

const writeStoredSession = (session: AuthSession | null) => {
  if (!session) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.dispatchEvent(new CustomEvent('aportipay-auth-changed', { detail: null }))
    return
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
  window.dispatchEvent(new CustomEvent('aportipay-auth-changed', { detail: session }))
}

export const authClient = {
  auth: {
    getSession: async () => ({ data: { session: readStoredSession() ? { user: readStoredSession() } : null } }),
    onAuthStateChange: (callback: (event: string, session: { user: AuthSession } | null) => void) => {
      const emit = () => {
        const user = readStoredSession()
        callback(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? { user } : null)
      }
      emit()
      const listener = () => emit()
      window.addEventListener('aportipay-auth-changed', listener)
      return {
        data: {
          subscription: {
            unsubscribe: () => window.removeEventListener('aportipay-auth-changed', listener),
          },
        },
      }
    },
  },
}

export const supabaseAuth = authClient

export const getAuthRole = (user: { role?: string } | null | undefined) =>
  readRoleField(user?.role) || DEFAULT_ROLE

export const ensureAuthRole = async (role: string) => {
  const session = readStoredSession()
  if (!session?.email) throw new Error('Not signed in')
  const normalized = readRoleField(role) || DEFAULT_ROLE
  const savedRole = await saveRoleToRoleTable(session.email, normalized)
  const updated = { ...session, role: savedRole }
  writeStoredSession(updated)
  return savedRole
}

export const fetchRoleFromRoleTable = async (email: string): Promise<string | null> => {
  if (isFirebaseConfigured()) {
    const role = await firebaseDb.fetchRoleFromRoleTable(email)
    return readRoleField(role) || null
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null
  const response = await fetch(`${API_BASE_URL}/api/auth/role?email=${encodeURIComponent(normalizedEmail)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Unable to load role: ${response.status}`)
  const payload = await response.json() as { role: string }
  return readRoleField(payload.role) || null
}

export const saveRoleToRoleTable = async (email: string, role: string): Promise<string> => {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedRole = readRoleField(role) || DEFAULT_ROLE

  if (isFirebaseConfigured()) {
    return firebaseDb.saveRoleToRoleTable(normalizedEmail, normalizedRole)
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail, role: normalizedRole }),
  })
  if (!response.ok) throw new Error(`Unable to save role: ${response.status}`)
  const payload = await response.json() as { role: string }
  return readRoleField(payload.role) || normalizedRole
}

export const signInWithEmail = async (email: string, password: string) => {
  const user = isFirebaseConfigured()
    ? await firebaseDb.loginUser(email, password)
    : await (async () => {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(payload?.error || `Login failed: ${response.status}`)
        }
        return response.json() as Promise<AuthSession>
      })()

  writeStoredSession(user)
  return { user, session: { user } }
}

export const signUpWithEmail = async (email: string, password: string, role: string) => {
  const normalized = readRoleField(role) || DEFAULT_ROLE
  const user = isFirebaseConfigured()
    ? await firebaseDb.registerUser(email, password, normalized)
    : await (async () => {
        const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role: normalized }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(payload?.error || `Signup failed: ${response.status}`)
        }
        return response.json() as Promise<AuthSession>
      })()

  writeStoredSession(user)
  return { user, session: { user } }
}

export const signOutAuth = async () => {
  writeStoredSession(null)
}
