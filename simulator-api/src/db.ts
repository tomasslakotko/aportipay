import {
  COLLECTIONS,
  getAdminAuth,
  getDb,
  isFirebaseConfigured,
  stripUndefined,
} from './firebaseAdmin.js'

export interface SessionRecord {
  id: string
  scenarioId: string
  score: number
  createdAt: string
  updatedAt: string
  snapshot: unknown
}

export interface FlightRecord {
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
  createdAt: string
  updatedAt: string
}

export interface ChatMessageRecord {
  id: string
  flightLabel: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
  status: 'sent' | 'published'
  createdAt: string
  updatedAt: string
}

export interface FlightClosureRecord {
  id: number
  flightLabel: string
  signatureData: string
  closedBy: string | null
  closedDevice: string | null
  closedAt: string
  createdAt: string
}

export interface UserRoleRecord {
  email: string
  role: string
  createdAt: string
  updatedAt: string
}

export interface AuthUserRecord {
  id: string
  email: string
  role: string
  emailConfirmed: boolean
}

interface StoredUser {
  id: string
  email: string
  passwordHash: string
  role: string
  emailConfirmed?: boolean
  createdAt?: string
  updatedAt?: string
}

const db = () => {
  if (!isFirebaseConfigured()) {
    throw new Error('FIREBASE_PROJECT_ID must be set for simulator-api.')
  }
  return getDb()
}

const simpleHash = (password: string) => {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash &= hash
  }
  return hash.toString()
}

const rowToRecord = (id: string, row: Record<string, unknown>): SessionRecord => ({
  id,
  scenarioId: String(row.scenarioId ?? row.scenario_id ?? 'turnaround-basic'),
  score: Number(row.score ?? 0),
  createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
  snapshot: row.snapshot ?? row.snapshot_json ?? {},
})

const rowToFlight = (id: string, row: Record<string, unknown>): FlightRecord => ({
  id,
  carrier: String(row.carrier ?? ''),
  flightNo: String(row.flightNo ?? row.flight_no ?? ''),
  date: String(row.date ?? row.flight_date ?? ''),
  dep: String(row.dep ?? ''),
  arr: String(row.arr ?? ''),
  time: String(row.time ?? row.flight_time ?? ''),
  status: String(row.status ?? ''),
  aircraft: String(row.aircraft ?? ''),
  controller: String(row.controller ?? ''),
  createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
})

const rowToChatMessage = (id: string, row: Record<string, unknown>): ChatMessageRecord => ({
  id,
  flightLabel: String(row.flightLabel ?? row.flight_label ?? ''),
  author: String(row.author ?? ''),
  text: String(row.text ?? ''),
  recipient: String(row.recipient ?? 'Ramp'),
  priority: (row.priority === 'low' || row.priority === 'high' ? row.priority : 'medium'),
  status: row.status === 'published' ? 'published' : 'sent',
  createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
})

const rowToFlightClosure = (id: string, row: Record<string, unknown>): FlightClosureRecord => {
  const combined = row.closedBy ?? row.closed_by ?? null
  let closedBy = typeof combined === 'string' ? combined : null
  let closedDevice = row.closedDevice ?? row.closed_device ?? null
  if (!closedDevice && typeof closedBy === 'string' && closedBy.includes(' @@ ')) {
    const [by, device] = closedBy.split(' @@ ')
    closedBy = by || null
    closedDevice = device || null
  }
  return {
    id: Number(row.legacyId ?? row.id ?? id) || 0,
    flightLabel: String(row.flightLabel ?? row.flight_label ?? id),
    signatureData: String(row.signatureData ?? row.signature_data ?? ''),
    closedBy: closedBy ? String(closedBy) : null,
    closedDevice: closedDevice ? String(closedDevice) : null,
    closedAt: String(row.closedAt ?? row.closed_at ?? new Date().toISOString()),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  }
}

const rowToUserRole = (row: Record<string, unknown>): UserRoleRecord => ({
  email: String(row.email ?? ''),
  role: String(row.role ?? ''),
  createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
})

const findStoredUserByEmail = async (email: string): Promise<StoredUser | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  const snapshot = await db().collection(COLLECTIONS.users)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get()
  const found = snapshot.docs[0]
  if (!found) return null
  return { id: found.id, ...found.data() } as StoredUser
}

export const listSessions = async (): Promise<SessionRecord[]> => {
  const snapshot = await db().collection(COLLECTIONS.sessions)
    .orderBy('updatedAt', 'desc')
    .get()
  return snapshot.docs.map((doc) => rowToRecord(doc.id, doc.data()))
}

export const getLatestSession = async (): Promise<SessionRecord | null> => {
  const snapshot = await db().collection(COLLECTIONS.sessions)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get()
  const doc = snapshot.docs[0]
  return doc ? rowToRecord(doc.id, doc.data()) : null
}

export const getSession = async (id: string): Promise<SessionRecord | null> => {
  const doc = await db().collection(COLLECTIONS.sessions).doc(id).get()
  return doc.exists ? rowToRecord(doc.id, doc.data()!) : null
}

export const upsertSession = async (
  id: string,
  scenarioId: string,
  score: number,
  snapshot: unknown,
): Promise<SessionRecord> => {
  const existing = await db().collection(COLLECTIONS.sessions).doc(id).get()
  const now = new Date().toISOString()
  const createdAt = String(existing.data()?.createdAt ?? existing.data()?.created_at ?? now)
  const record = stripUndefined({
    scenarioId,
    score,
    snapshot,
    createdAt,
    updatedAt: now,
  })
  await db().collection(COLLECTIONS.sessions).doc(id).set(record, { merge: true })
  return { id, scenarioId, score, createdAt, updatedAt: now, snapshot }
}

export const listFlights = async (): Promise<FlightRecord[]> => {
  const snapshot = await db().collection(COLLECTIONS.flights).get()
  return snapshot.docs
    .map((doc) => rowToFlight(doc.id, doc.data()))
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date)
      if (dateCompare !== 0) return dateCompare
      const timeCompare = b.time.localeCompare(a.time)
      if (timeCompare !== 0) return timeCompare
      return b.createdAt.localeCompare(a.createdAt)
    })
}

export const createFlight = async (
  input: Omit<FlightRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<FlightRecord> => {
  const now = new Date().toISOString()
  const id = `flt-${Date.now()}`
  const record = stripUndefined({ ...input, createdAt: now, updatedAt: now })
  await db().collection(COLLECTIONS.flights).doc(id).set(record)
  return { id, ...input, createdAt: now, updatedAt: now }
}

export const deleteFlight = async (id: string): Promise<boolean> => {
  const doc = await db().collection(COLLECTIONS.flights).doc(id).get()
  if (!doc.exists) return false
  await doc.ref.delete()
  return true
}

export const listChatMessages = async (flightLabel: string): Promise<ChatMessageRecord[]> => {
  const snapshot = await db().collection(COLLECTIONS.chatMessages)
    .where('flightLabel', '==', flightLabel)
    .limit(200)
    .get()
  return snapshot.docs
    .map((doc) => rowToChatMessage(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const createChatMessage = async (input: {
  flightLabel: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
}): Promise<ChatMessageRecord> => {
  const id = `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const now = new Date().toISOString()
  const record = stripUndefined({
    ...input,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  })
  await db().collection(COLLECTIONS.chatMessages).doc(id).set(record)
  return { id, ...input, status: 'sent', createdAt: now, updatedAt: now }
}

export const publishChatMessage = async (id: string): Promise<ChatMessageRecord | null> => {
  const ref = db.collection(COLLECTIONS.chatMessages).doc(id)
  const existing = await ref.get()
  if (!existing.exists) return null
  const now = new Date().toISOString()
  await ref.set(stripUndefined({ status: 'published', updatedAt: now }), { merge: true })
  return rowToChatMessage(id, { ...existing.data(), status: 'published', updatedAt: now })
}

export const listFlightClosures = async (): Promise<FlightClosureRecord[]> => {
  const snapshot = await db().collection(COLLECTIONS.flightClosures)
    .orderBy('closedAt', 'desc')
    .limit(500)
    .get()
  return snapshot.docs.map((doc) => rowToFlightClosure(doc.id, doc.data()))
}

export const upsertFlightClosure = async (input: {
  flightLabel: string
  signatureData: string
  closedBy?: string
  closedDevice?: string
}): Promise<FlightClosureRecord> => {
  const now = new Date().toISOString()
  const existing = await db().collection(COLLECTIONS.flightClosures).doc(input.flightLabel).get()
  const record = stripUndefined({
    flightLabel: input.flightLabel,
    signatureData: input.signatureData,
    closedBy: input.closedBy ?? null,
    closedDevice: input.closedDevice ?? null,
    closedAt: now,
    createdAt: String(existing.data()?.createdAt ?? existing.data()?.created_at ?? now),
    legacyId: existing.data()?.legacyId ?? existing.data()?.id ?? Date.now(),
  })
  await db().collection(COLLECTIONS.flightClosures).doc(input.flightLabel).set(record, { merge: true })
  return rowToFlightClosure(input.flightLabel, record)
}

export const deleteFlightClosure = async (flightLabel: string): Promise<boolean> => {
  const ref = db.collection(COLLECTIONS.flightClosures).doc(flightLabel)
  const existing = await ref.get()
  if (!existing.exists) return false
  await ref.delete()
  return true
}

export const getUserRoleByEmail = async (email: string): Promise<UserRoleRecord | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null
  const doc = await db().collection(COLLECTIONS.userRoles).doc(normalizedEmail).get()
  return doc.exists ? rowToUserRole({ email: normalizedEmail, ...doc.data() }) : null
}

export const upsertUserRoleByEmail = async (email: string, role: string): Promise<UserRoleRecord> => {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedRole = role.trim()
  const now = new Date().toISOString()
  const existing = await db().collection(COLLECTIONS.userRoles).doc(normalizedEmail).get()
  const record = stripUndefined({
    email: normalizedEmail,
    role: normalizedRole,
    createdAt: String(existing.data()?.createdAt ?? existing.data()?.created_at ?? now),
    updatedAt: now,
  })
  await db().collection(COLLECTIONS.userRoles).doc(normalizedEmail).set(record, { merge: true })
  return rowToUserRole(record)
}

export const listUserRoles = async (): Promise<UserRoleRecord[]> => {
  const snapshot = await db().collection(COLLECTIONS.userRoles)
    .orderBy('updatedAt', 'desc')
    .limit(1000)
    .get()
  return snapshot.docs.map((doc) => rowToUserRole({ email: doc.id, ...doc.data() }))
}

export const verifyAuthUserPassword = async (email: string, password: string): Promise<AuthUserRecord | null> => {
  const user = await findStoredUserByEmail(email)
  if (!user || user.passwordHash !== simpleHash(password)) return null
  const roleRecord = await getUserRoleByEmail(email)
  return {
    id: user.id,
    email: user.email,
    role: roleRecord?.role ?? user.role ?? 'Ramp Agent',
    emailConfirmed: Boolean(user.emailConfirmed ?? true),
  }
}

export const setAuthUserPasswordByEmail = async (email: string, password: string): Promise<boolean> => {
  const user = await findStoredUserByEmail(email)
  if (!user) return false
  const now = new Date().toISOString()
  await db().collection(COLLECTIONS.users).doc(user.id).set(
    stripUndefined({ passwordHash: simpleHash(password), updatedAt: now }),
    { merge: true },
  )
  return true
}

export const createAuthUserWithRole = async (input: {
  email: string
  password: string
  role: string
  autoConfirmEmail: boolean
}): Promise<AuthUserRecord> => {
  const normalizedEmail = input.email.trim().toLowerCase()
  const normalizedRole = input.role.trim()
  const existing = await findStoredUserByEmail(normalizedEmail)
  if (existing) {
    throw new Error('User already registered')
  }

  const now = new Date().toISOString()
  const userId = `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  await db().collection(COLLECTIONS.users).doc(userId).set(stripUndefined({
    email: normalizedEmail,
    passwordHash: simpleHash(input.password),
    role: normalizedRole,
    emailConfirmed: input.autoConfirmEmail,
    createdAt: now,
    updatedAt: now,
  }))

  try {
    await getAdminAuth().createUser({
      email: normalizedEmail,
      password: input.password,
      emailVerified: input.autoConfirmEmail,
    })
  } catch {
    // Custom auth in Firestore remains the source of truth for the simulator.
  }

  await upsertUserRoleByEmail(normalizedEmail, normalizedRole)
  return {
    id: userId,
    email: normalizedEmail,
    role: normalizedRole,
    emailConfirmed: input.autoConfirmEmail,
  }
}
