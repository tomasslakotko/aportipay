import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import type { SimulatorSnapshot } from '../store/useSimulatorStore'
import { FIRESTORE_COLLECTIONS, getFirebaseDb, isFirebaseConfigured } from './firebaseClient'

export interface SessionRecord {
  id: string
  scenarioId: string
  score: number
  createdAt: string
  updatedAt: string
  snapshot: SimulatorSnapshot
}

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
  source?: 'aportipay' | 'aa-lids'
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

const USER_ROLES_COLLECTION = 'aportipay_user_roles'
const USERS_COLLECTION = 'aportipay_users'

const stripUndefined = <T,>(value: T): T => {
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

const simpleHash = (password: string) => {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash &= hash
  }
  return hash.toString()
}

const getDb = () => getFirebaseDb()

const findStoredUserByEmail = async (email: string): Promise<StoredUser | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  const snapshot = await getDocs(query(
    collection(getDb(), USERS_COLLECTION),
    where('email', '==', normalizedEmail),
    limit(1),
  ))
  const found = snapshot.docs[0]
  if (!found) return null
  return { id: found.id, ...found.data() } as StoredUser
}

export const fetchLatestSession = async (sessionId: string): Promise<SessionRecord | null> => {
  const docSnap = await getDoc(doc(getDb(), FIRESTORE_COLLECTIONS.sessions, sessionId))
  if (!docSnap.exists()) return null
  const row = docSnap.data()
  return {
    id: docSnap.id,
    scenarioId: String(row.scenarioId ?? 'turnaround-basic'),
    score: Number(row.score ?? 0),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    snapshot: (row.snapshot ?? {}) as SimulatorSnapshot,
  }
}

export const saveCurrentSession = async (
  snapshot: SimulatorSnapshot,
  sessionId: string,
): Promise<SessionRecord> => {
  const existing = await getDoc(doc(getDb(), FIRESTORE_COLLECTIONS.sessions, sessionId))
  const now = new Date().toISOString()
  const createdAt = String(existing.data()?.createdAt ?? now)
  const scenarioId = typeof snapshot.scenarioId === 'string' ? snapshot.scenarioId : 'turnaround-basic'
  const score = typeof snapshot.score === 'number' ? snapshot.score : Number(snapshot.score ?? 0)
  const record = stripUndefined({
    scenarioId,
    score,
    snapshot,
    createdAt,
    updatedAt: now,
  })
  await setDoc(doc(getDb(), FIRESTORE_COLLECTIONS.sessions, sessionId), record, { merge: true })
  return { id: sessionId, scenarioId, score, createdAt, updatedAt: now, snapshot }
}

const parseFlightNumber = (flightNumber: string) => {
  const normalized = flightNumber.trim().toUpperCase()
  const spaced = normalized.match(/^([A-Z0-9]{2,3})\s+(\S+)$/)
  if (spaced) return { carrier: spaced[1], flightNo: spaced[2] }
  const compact = normalized.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/)
  if (compact) return { carrier: compact[1], flightNo: compact[2] }
  return {
    carrier: normalized.slice(0, 2) || '6X',
    flightNo: normalized.slice(2) || normalized,
  }
}

const formatAaLidsTime = (std?: unknown, etd?: unknown) => {
  const raw = String(etd ?? std ?? '').trim()
  if (!raw) return '14:15'
  const isoMatch = raw.match(/T(\d{2}:\d{2})/)
  if (isoMatch) return isoMatch[1]
  if (/^\d{2}:\d{2}/.test(raw)) return raw.slice(0, 5)
  return raw
}

const mapAaLidsStatus = (status: unknown) => {
  const normalized = String(status ?? 'SCHEDULED').toUpperCase()
  if (normalized === 'BOARDING' || normalized === 'SCHEDULED') return 'GO-RO-LI-AN-BN'
  if (normalized === 'DEPARTED' || normalized === 'ARRIVED') return normalized
  if (normalized === 'DELAYED') return 'DELAYED'
  if (normalized === 'CANCELLED') return 'CANCELLED'
  return normalized
}

const mapAaLidsFlight = (id: string, row: Record<string, unknown>): AdminFlight => {
  const flightNumber = String(row.flightNumber ?? row.flight_number ?? '')
  const { carrier, flightNo } = parseFlightNumber(flightNumber)
  const registration = String(row.registration ?? '').trim()
  const aircraft = String(row.aircraft ?? '').trim()
  return {
    id: `aalids-${id}`,
    carrier,
    flightNo,
    date: String(row.date ?? '').trim() || new Date().toISOString().slice(0, 10),
    dep: String(row.origin ?? row.dep ?? '').trim().toUpperCase(),
    arr: String(row.destination ?? row.arr ?? '').trim().toUpperCase(),
    time: formatAaLidsTime(row.std, row.etd),
    status: mapAaLidsStatus(row.status),
    aircraft: registration || aircraft || 'N/A',
    controller: 'aa-lids',
    source: 'aa-lids',
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? ''),
  }
}

const sortFlights = (flights: AdminFlight[]) =>
  flights.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date)
    if (dateCompare !== 0) return dateCompare
    const timeCompare = b.time.localeCompare(a.time)
    if (timeCompare !== 0) return timeCompare
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })

const fetchAaLidsFlights = async (): Promise<AdminFlight[]> => {
  const snapshot = await getDocs(collection(getDb(), FIRESTORE_COLLECTIONS.aaLidsFlights))
  return snapshot.docs.map((document) => mapAaLidsFlight(document.id, document.data()))
}

export const fetchFlights = async (): Promise<AdminFlight[]> => {
  const [aportipaySnapshot, aaLidsFlights] = await Promise.all([
    getDocs(collection(getDb(), FIRESTORE_COLLECTIONS.flights)),
    fetchAaLidsFlights(),
  ])

  const aportipayFlights = aportipaySnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
    source: 'aportipay' as const,
  })) as AdminFlight[]

  return sortFlights([...aportipayFlights, ...aaLidsFlights])
}

export const createFlight = async (
  flight: Omit<AdminFlight, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<AdminFlight> => {
  const now = new Date().toISOString()
  const id = `flt-${Date.now()}`
  const record = stripUndefined({ ...flight, createdAt: now, updatedAt: now })
  await setDoc(doc(getDb(), FIRESTORE_COLLECTIONS.flights, id), record)
  return { id, ...flight, createdAt: now, updatedAt: now }
}

export const deleteFlight = async (id: string): Promise<void> => {
  if (id.startsWith('aalids-')) {
    throw new Error('aa-lids flights can only be changed in the aa-lids app.')
  }
  await deleteDoc(doc(getDb(), FIRESTORE_COLLECTIONS.flights, id))
}

export const fetchChatMessages = async (flightLabel: string): Promise<ChatMessageRecord[]> => {
  const snapshot = await getDocs(query(
    collection(getDb(), FIRESTORE_COLLECTIONS.chatMessages),
    where('flightLabel', '==', flightLabel),
    limit(200),
  ))
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }) as ChatMessageRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const sendChatMessage = async (input: {
  flightLabel: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
}): Promise<ChatMessageRecord> => {
  const id = `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const now = new Date().toISOString()
  const record = stripUndefined({ ...input, status: 'sent', createdAt: now, updatedAt: now })
  await setDoc(doc(getDb(), FIRESTORE_COLLECTIONS.chatMessages, id), record)
  return { id, ...input, status: 'sent', createdAt: now, updatedAt: now }
}

export const publishChatMessage = async (id: string): Promise<ChatMessageRecord> => {
  const ref = doc(getDb(), FIRESTORE_COLLECTIONS.chatMessages, id)
  const existing = await getDoc(ref)
  if (!existing.exists()) throw new Error('Message not found')
  const now = new Date().toISOString()
  await setDoc(ref, stripUndefined({ status: 'published', updatedAt: now }), { merge: true })
  return { id, ...existing.data(), status: 'published', updatedAt: now } as ChatMessageRecord
}

export const fetchFlightClosures = async (): Promise<FlightClosureRecord[]> => {
  const snapshot = await getDocs(query(
    collection(getDb(), FIRESTORE_COLLECTIONS.flightClosures),
    orderBy('closedAt', 'desc'),
    limit(500),
  ))
  return snapshot.docs.map((document) => {
    const row = document.data()
    return {
      id: Number(row.legacyId ?? 0) || 0,
      flightLabel: String(row.flightLabel ?? document.id),
      signatureData: String(row.signatureData ?? ''),
      closedBy: row.closedBy ? String(row.closedBy) : null,
      closedDevice: row.closedDevice ? String(row.closedDevice) : null,
      closedAt: String(row.closedAt ?? new Date().toISOString()),
      createdAt: String(row.createdAt ?? new Date().toISOString()),
    }
  })
}

export const closeFlightGlobally = async (
  flightLabel: string,
  signatureData: string,
  closedBy: string,
  closedDevice: string,
): Promise<FlightClosureRecord> => {
  const now = new Date().toISOString()
  const existing = await getDoc(doc(getDb(), FIRESTORE_COLLECTIONS.flightClosures, flightLabel))
  const record = stripUndefined({
    flightLabel,
    signatureData,
    closedBy,
    closedDevice,
    closedAt: now,
    createdAt: String(existing.data()?.createdAt ?? now),
    legacyId: existing.data()?.legacyId ?? Date.now(),
  })
  await setDoc(doc(getDb(), FIRESTORE_COLLECTIONS.flightClosures, flightLabel), record, { merge: true })
  return {
    id: Number(record.legacyId),
    flightLabel,
    signatureData,
    closedBy,
    closedDevice,
    closedAt: now,
    createdAt: String(record.createdAt),
  }
}

export const reopenFlightGlobally = async (flightLabel: string): Promise<void> => {
  await deleteDoc(doc(getDb(), FIRESTORE_COLLECTIONS.flightClosures, flightLabel))
}

export const fetchRoleFromRoleTable = async (email: string): Promise<string | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  const docSnap = await getDoc(doc(getDb(), USER_ROLES_COLLECTION, normalizedEmail))
  if (!docSnap.exists()) return null
  const role = docSnap.data().role
  return typeof role === 'string' ? role : null
}

export const saveRoleToRoleTable = async (email: string, role: string): Promise<string> => {
  const normalizedEmail = email.trim().toLowerCase()
  const now = new Date().toISOString()
  const existing = await getDoc(doc(getDb(), USER_ROLES_COLLECTION, normalizedEmail))
  await setDoc(doc(getDb(), USER_ROLES_COLLECTION, normalizedEmail), stripUndefined({
    email: normalizedEmail,
    role,
    createdAt: String(existing.data()?.createdAt ?? now),
    updatedAt: now,
  }), { merge: true })
  return role
}

export const loginUser = async (email: string, password: string): Promise<AuthUserRecord> => {
  const user = await findStoredUserByEmail(email)
  if (!user || user.passwordHash !== simpleHash(password)) {
    throw new Error('Invalid email or password')
  }
  const role = (await fetchRoleFromRoleTable(email)) ?? user.role ?? 'Ramp Agent'
  return {
    id: user.id,
    email: user.email,
    role,
    emailConfirmed: Boolean(user.emailConfirmed ?? true),
  }
}

export const registerUser = async (email: string, password: string, role: string): Promise<AuthUserRecord> => {
  const normalizedEmail = email.trim().toLowerCase()
  const existing = await findStoredUserByEmail(normalizedEmail)
  if (existing) throw new Error('Email already registered')
  const now = new Date().toISOString()
  const userId = `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  await setDoc(doc(getDb(), USERS_COLLECTION, userId), stripUndefined({
    email: normalizedEmail,
    passwordHash: simpleHash(password),
    role,
    emailConfirmed: true,
    createdAt: now,
    updatedAt: now,
  }))
  await saveRoleToRoleTable(normalizedEmail, role)
  return { id: userId, email: normalizedEmail, role, emailConfirmed: true }
}

export const listAdminUsers = async (): Promise<UserRoleRecord[]> => {
  const snapshot = await getDocs(query(
    collection(getDb(), USER_ROLES_COLLECTION),
    orderBy('updatedAt', 'desc'),
    limit(1000),
  ))
  return snapshot.docs.map((document) => ({
    email: document.id,
    role: String(document.data().role ?? ''),
    createdAt: String(document.data().createdAt ?? new Date().toISOString()),
    updatedAt: String(document.data().updatedAt ?? new Date().toISOString()),
  }))
}

export const createAdminUser = async (input: {
  email: string
  password: string
  role: string
}): Promise<AuthUserRecord> => registerUser(input.email, input.password, input.role)

export const updateAdminUserRole = async (email: string, role: string): Promise<UserRoleRecord> => {
  const normalizedEmail = email.trim().toLowerCase()
  const now = new Date().toISOString()
  const existing = await getDoc(doc(getDb(), USER_ROLES_COLLECTION, normalizedEmail))
  await setDoc(doc(getDb(), USER_ROLES_COLLECTION, normalizedEmail), stripUndefined({
    email: normalizedEmail,
    role,
    createdAt: String(existing.data()?.createdAt ?? now),
    updatedAt: now,
  }), { merge: true })
  return {
    email: normalizedEmail,
    role,
    createdAt: String(existing.data()?.createdAt ?? now),
    updatedAt: now,
  }
}

export const resetAdminUserPassword = async (email: string, password: string): Promise<void> => {
  const user = await findStoredUserByEmail(email)
  if (!user) throw new Error('User not found')
  await setDoc(doc(getDb(), USERS_COLLECTION, user.id), stripUndefined({
    passwordHash: simpleHash(password),
    updatedAt: new Date().toISOString(),
  }), { merge: true })
}

export { isFirebaseConfigured }
