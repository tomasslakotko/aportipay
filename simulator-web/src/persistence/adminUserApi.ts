import { isFirebaseConfigured } from './firebaseClient'
import * as firebaseDb from './firebaseDatabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export interface CreateAdminUserInput {
  email: string
  password: string
  role: string
  autoConfirmEmail: boolean
}

export interface CreatedAdminUser {
  id: string
  email: string
  role: string
  emailConfirmed: boolean
}

export interface AdminUserRow {
  email: string
  role: string
  createdAt: string
  updatedAt: string
}

export const createAdminUser = async (input: CreateAdminUserInput): Promise<CreatedAdminUser> => {
  if (isFirebaseConfigured()) {
    return firebaseDb.createAdminUser({
      email: input.email,
      password: input.password,
      role: input.role,
    })
  }

  const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Unable to create user: ${response.status}`)
  }
  return response.json() as Promise<CreatedAdminUser>
}

export const listAdminUsers = async (): Promise<AdminUserRow[]> => {
  if (isFirebaseConfigured()) return firebaseDb.listAdminUsers()

  const response = await fetch(`${API_BASE_URL}/api/admin/users`)
  if (!response.ok) throw new Error(`Unable to load users: ${response.status}`)
  return response.json() as Promise<AdminUserRow[]>
}

export const updateAdminUserRole = async (email: string, role: string): Promise<AdminUserRow> => {
  if (isFirebaseConfigured()) return firebaseDb.updateAdminUserRole(email, role)

  const response = await fetch(`${API_BASE_URL}/api/admin/users/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  if (!response.ok) throw new Error(`Unable to update role: ${response.status}`)
  return response.json() as Promise<AdminUserRow>
}

export const resetAdminUserPassword = async (email: string, password: string): Promise<void> => {
  if (isFirebaseConfigured()) {
    await firebaseDb.resetAdminUserPassword(email, password)
    return
  }

  const response = await fetch(`${API_BASE_URL}/api/admin/users/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Unable to reset password: ${response.status}`)
  }
}
