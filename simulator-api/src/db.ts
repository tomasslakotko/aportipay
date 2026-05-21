import { createClient } from '@supabase/supabase-js'

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

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for simulator-api.')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

interface SessionRow {
  id: string
  scenario_id: string
  score: number
  snapshot_json: unknown
  created_at: string
  updated_at: string
}

interface FlightRow {
  id: string
  carrier: string
  flight_no: string
  flight_date: string
  dep: string
  arr: string
  flight_time: string
  status: string
  aircraft: string
  controller: string
  created_at: string
  updated_at: string
}

interface ChatMessageRow {
  id: string
  flight_label: string
  author: string
  text: string
  recipient: string
  priority: 'low' | 'medium' | 'high'
  status: 'sent' | 'published'
  created_at: string
  updated_at: string
}

interface FlightClosureRow {
  id: number
  flight_label: string
  signature_data: string
  closed_by: string | null
  closed_device: string | null
  closed_at: string
  created_at: string
}

interface UserRoleRow {
  email: string
  role: string
  created_at: string
  updated_at: string
}

const rowToRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  scenarioId: row.scenario_id,
  score: row.score,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  snapshot: row.snapshot_json,
})

const rowToFlight = (row: FlightRow): FlightRecord => ({
  id: row.id,
  carrier: row.carrier,
  flightNo: row.flight_no,
  date: row.flight_date,
  dep: row.dep,
  arr: row.arr,
  time: row.flight_time,
  status: row.status,
  aircraft: row.aircraft,
  controller: row.controller,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const rowToChatMessage = (row: ChatMessageRow): ChatMessageRecord => ({
  id: row.id,
  flightLabel: row.flight_label,
  author: row.author,
  text: row.text,
  recipient: row.recipient,
  priority: row.priority,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const rowToFlightClosure = (row: FlightClosureRow): FlightClosureRecord => ({
  ...(() => {
    const combined = row.closed_by ?? ''
    if (!row.closed_device && combined.includes(' @@ ')) {
      const [by, device] = combined.split(' @@ ')
      return {
        closedBy: by || null,
        closedDevice: device || null,
      }
    }
    return {
      closedBy: row.closed_by,
      closedDevice: row.closed_device ?? null,
    }
  })(),
  id: row.id,
  flightLabel: row.flight_label,
  signatureData: row.signature_data,
  closedAt: row.closed_at,
  createdAt: row.created_at,
})

const rowToUserRole = (row: UserRoleRow): UserRoleRecord => ({
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const listSessions = async (): Promise<SessionRecord[]> => {
  const { data: rows, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (rows ?? []).map(rowToRecord)
}

export const getLatestSession = async (): Promise<SessionRecord | null> => {
  const { data: row, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return row ? rowToRecord(row) : null
}

export const getSession = async (id: string): Promise<SessionRecord | null> => {
  const { data: row, error } = await supabase.from('sessions').select('*').eq('id', id).maybeSingle()

  if (error) throw error
  return row ? rowToRecord(row) : null
}

export const upsertSession = async (
  id: string,
  scenarioId: string,
  score: number,
  snapshot: unknown,
): Promise<SessionRecord> => {
  const { data: existing, error: existingError } = await supabase
    .from('sessions')
    .select('created_at')
    .eq('id', id)
    .maybeSingle()

  if (existingError) throw existingError
  const now = new Date().toISOString()
  const createdAt = existing?.created_at ?? now

  const { error: upsertError } = await supabase.from('sessions').upsert(
    {
      id,
      scenario_id: scenarioId,
      score,
      snapshot_json: snapshot,
      created_at: createdAt,
      updated_at: now,
    },
    { onConflict: 'id' },
  )

  if (upsertError) throw upsertError

  return {
    id,
    scenarioId,
    score,
    createdAt,
    updatedAt: now,
    snapshot,
  }
}

export const listFlights = async (): Promise<FlightRecord[]> => {
  const { data: rows, error } = await supabase
    .from('flights')
    .select('*')
    .order('flight_date', { ascending: false })
    .order('flight_time', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (rows ?? []).map(rowToFlight)
}

export const createFlight = async (
  input: Omit<FlightRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<FlightRecord> => {
  const now = new Date().toISOString()
  const id = `flt-${Date.now()}`

  const { error } = await supabase.from('flights').insert({
    id,
    carrier: input.carrier,
    flight_no: input.flightNo,
    flight_date: input.date,
    dep: input.dep,
    arr: input.arr,
    flight_time: input.time,
    status: input.status,
    aircraft: input.aircraft,
    controller: input.controller,
    created_at: now,
    updated_at: now,
  })

  if (error) throw error

  return {
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  }
}

export const deleteFlight = async (id: string): Promise<boolean> => {
  const { data, error } = await supabase.from('flights').delete().eq('id', id).select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export const listChatMessages = async (flightLabel: string): Promise<ChatMessageRecord[]> => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('flight_label', flightLabel)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error
  return (data ?? []).map(rowToChatMessage)
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
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      id,
      flight_label: input.flightLabel,
      author: input.author,
      text: input.text,
      recipient: input.recipient,
      priority: input.priority,
      status: 'sent',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (error) throw error
  return rowToChatMessage(data)
}

export const publishChatMessage = async (id: string): Promise<ChatMessageRecord | null> => {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('chat_messages')
    .update({ status: 'published', updated_at: now })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw error
  return data ? rowToChatMessage(data) : null
}

export const listFlightClosures = async (): Promise<FlightClosureRecord[]> => {
  const { data, error } = await supabase
    .from('flight_closures')
    .select('*')
    .order('closed_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []).map(rowToFlightClosure)
}

export const upsertFlightClosure = async (input: {
  flightLabel: string
  signatureData: string
  closedBy?: string
  closedDevice?: string
}): Promise<FlightClosureRecord> => {
  const now = new Date().toISOString()
  const payload = {
    flight_label: input.flightLabel,
    signature_data: input.signatureData,
    closed_by: input.closedBy ?? null,
    closed_device: input.closedDevice ?? null,
    closed_at: now,
  }
  let { data, error } = await supabase
    .from('flight_closures')
    .upsert(
      payload,
      { onConflict: 'flight_label' },
    )
    .select('*')
    .single()
  if (error?.message?.toLowerCase().includes('closed_device')) {
    ;({ data, error } = await supabase
      .from('flight_closures')
      .upsert(
        {
          flight_label: input.flightLabel,
          signature_data: input.signatureData,
          closed_by: [input.closedBy ?? '', input.closedDevice ?? ''].filter(Boolean).join(' @@ ') || null,
          closed_at: now,
        },
        { onConflict: 'flight_label' },
      )
      .select('*')
      .single())
  }
  if (error) throw error
  return rowToFlightClosure(data)
}

export const deleteFlightClosure = async (flightLabel: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('flight_closures')
    .delete()
    .eq('flight_label', flightLabel)
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export const getUserRoleByEmail = async (email: string): Promise<UserRoleRecord | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null
  const { data, error } = await supabase
    .from('user_roles')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (error) {
    if (error.message.toLowerCase().includes('user_roles')) return null
    throw error
  }
  return data ? rowToUserRole(data) : null
}

export const upsertUserRoleByEmail = async (email: string, role: string): Promise<UserRoleRecord> => {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedRole = role.trim()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('user_roles')
    .upsert(
      {
        email: normalizedEmail,
        role: normalizedRole,
        updated_at: now,
      },
      { onConflict: 'email' },
    )
    .select('*')
    .single()
  if (error) {
    if (error.message.toLowerCase().includes('user_roles')) {
      return {
        email: normalizedEmail,
        role: normalizedRole,
        createdAt: now,
        updatedAt: now,
      }
    }
    throw error
  }
  return rowToUserRole(data)
}

export const listUserRoles = async (): Promise<UserRoleRecord[]> => {
  const { data, error } = await supabase
    .from('user_roles')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (error) {
    if (error.message.toLowerCase().includes('user_roles')) return []
    throw error
  }
  return (data ?? []).map(rowToUserRole)
}

const findAuthUserByEmail = async (email: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  let page = 1
  const perPage = 200
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data.users ?? []
    const matched = users.find((user) => (user.email ?? '').toLowerCase() === normalizedEmail)
    if (matched) return matched
    if (users.length < perPage) break
    page += 1
  }
  return null
}

export const setAuthUserPasswordByEmail = async (email: string, password: string): Promise<boolean> => {
  const user = await findAuthUserByEmail(email)
  if (!user) return false
  const { error } = await supabase.auth.admin.updateUserById(user.id, { password })
  if (error) throw error
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
  const { data, error } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password: input.password,
    email_confirm: input.autoConfirmEmail,
    user_metadata: { role: normalizedRole },
  })
  if (error) throw error
  await upsertUserRoleByEmail(normalizedEmail, normalizedRole)
  return {
    id: data.user.id,
    email: data.user.email ?? normalizedEmail,
    role: normalizedRole,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
  }
}
