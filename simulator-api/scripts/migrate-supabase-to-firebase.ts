import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { initializeApp } from 'firebase/app'
import { doc, getFirestore, setDoc } from 'firebase/firestore'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY ?? process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET ?? process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID ?? process.env.FIREBASE_APP_ID,
}

const COLLECTIONS = {
  sessions: 'ramp_sessions',
  flights: 'aportipay_flights',
  chatMessages: 'operation_messages',
  flightClosures: 'aportipay_flight_closures',
  userRoles: 'aportipay_user_roles',
  users: 'aportipay_users',
} as const

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for export.')
}
if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
  throw new Error('Set Firebase Web config (VITE_FIREBASE_* or FIREBASE_* env vars).')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const firestore = getFirestore(initializeApp(firebaseConfig))

const toIso = (value: unknown) => {
  if (typeof value !== 'string' || !value) return new Date().toISOString()
  return value
}

const toNullableString = (value: unknown) => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item) ?? null)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    )
  }
  return value
}

async function migrateTable<T extends Record<string, unknown>>(
  table: string,
  collectionName: string,
  mapRow: (row: T) => { id: string; data: Record<string, unknown> },
) {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw error
  const rows = (data ?? []) as T[]
  let migrated = 0
  for (const row of rows) {
    const mapped = mapRow(row)
    await setDoc(
      doc(firestore, collectionName, mapped.id),
      stripUndefined(mapped.data) as Record<string, unknown>,
      { merge: true },
    )
    migrated += 1
  }
  console.log(`Migrated ${migrated} rows from ${table} -> ${collectionName}`)
}

async function migrateAuthUsers() {
  let page = 1
  let migrated = 0
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data.users ?? []
    for (const user of users) {
      const email = (user.email ?? '').trim().toLowerCase()
      if (!email) continue
      const role = typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : 'Ramp Agent'
      const userId = user.id
      await setDoc(doc(firestore, COLLECTIONS.users, userId), stripUndefined({
        email,
        passwordHash: '',
        role,
        emailConfirmed: Boolean(user.email_confirmed_at),
        createdAt: toIso(user.created_at),
        updatedAt: new Date().toISOString(),
        migratedFromSupabase: true,
      }) as Record<string, unknown>, { merge: true })
      await setDoc(doc(firestore, COLLECTIONS.userRoles, email), stripUndefined({
        email,
        role,
        createdAt: toIso(user.created_at),
        updatedAt: new Date().toISOString(),
      }) as Record<string, unknown>, { merge: true })
      migrated += 1
    }
    if (users.length < 200) break
    page += 1
  }
  console.log(`Migrated ${migrated} auth users (reset passwords for accounts migrated without a local hash).`)
}

async function main() {
  await migrateTable('sessions', COLLECTIONS.sessions, (row) => ({
    id: String(row.id),
    data: {
      scenarioId: row.scenario_id,
      score: row.score,
      snapshot: row.snapshot_json,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  }))

  await migrateTable('flights', COLLECTIONS.flights, (row) => ({
    id: String(row.id),
    data: {
      carrier: row.carrier,
      flightNo: row.flight_no,
      date: row.flight_date,
      dep: row.dep,
      arr: row.arr,
      time: row.flight_time,
      status: row.status,
      aircraft: row.aircraft,
      controller: row.controller,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  }))

  await migrateTable('chat_messages', COLLECTIONS.chatMessages, (row) => ({
    id: String(row.id),
    data: {
      flightLabel: row.flight_label,
      author: row.author,
      text: row.text,
      recipient: row.recipient,
      priority: row.priority,
      status: row.status,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  }))

  await migrateTable('flight_closures', COLLECTIONS.flightClosures, (row) => ({
    id: String(row.flight_label),
    data: {
      flightLabel: row.flight_label,
      signatureData: row.signature_data,
      closedBy: toNullableString(row.closed_by),
      closedDevice: toNullableString(row.closed_device),
      closedAt: toIso(row.closed_at),
      createdAt: toIso(row.created_at),
      legacyId: row.id,
    },
  }))

  await migrateTable('user_roles', COLLECTIONS.userRoles, (row) => ({
    id: String(row.email).trim().toLowerCase(),
    data: {
      email: String(row.email).trim().toLowerCase(),
      role: row.role,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  }))

  await migrateAuthUsers()
  console.log('Supabase -> Firebase migration complete.')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
