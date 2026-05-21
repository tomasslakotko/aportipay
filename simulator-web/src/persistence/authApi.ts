import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.')
}

export const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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

export const getAuthRole = (user: { user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null } | null | undefined) => {
  if (!user) return ''
  const fromUserMetadata = readRoleField(user.user_metadata?.role)
  if (fromUserMetadata) return fromUserMetadata
  return readRoleField(user.app_metadata?.role)
}

export const ensureAuthRole = async (role: string) => {
  const normalized = readRoleField(role) || DEFAULT_ROLE
  const { data, error } = await supabaseAuth.auth.updateUser({
    data: { role: normalized },
  })
  if (error) throw error
  return getAuthRole(data.user) || normalized
}

interface UserRoleRecord {
  email: string
  role: string
}

export const fetchRoleFromRoleTable = async (email: string): Promise<string | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null
  const response = await fetch(`${API_BASE_URL}/api/auth/role?email=${encodeURIComponent(normalizedEmail)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Unable to load role: ${response.status}`)
  const payload = await response.json() as UserRoleRecord
  return readRoleField(payload.role) || null
}

export const saveRoleToRoleTable = async (email: string, role: string): Promise<string> => {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedRole = readRoleField(role) || DEFAULT_ROLE
  const response = await fetch(`${API_BASE_URL}/api/auth/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail, role: normalizedRole }),
  })
  if (!response.ok) throw new Error(`Unable to save role: ${response.status}`)
  const payload = await response.json() as UserRoleRecord
  return readRoleField(payload.role) || normalizedRole
}

export const signInWithEmail = async (email: string, password: string) => {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export const signUpWithEmail = async (email: string, password: string, role: string) => {
  const normalized = readRoleField(role) || DEFAULT_ROLE
  const { data, error } = await supabaseAuth.auth.signUp({ email, password, options: { data: { role: normalized } } })
  if (error) throw error
  return data
}

export const signOutAuth = async () => {
  const { error } = await supabaseAuth.auth.signOut()
  if (error) throw error
}
