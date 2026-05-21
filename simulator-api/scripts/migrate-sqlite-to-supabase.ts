import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface SessionRow {
  id: string
  scenario_id: string
  score: number
  snapshot_json: string
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

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const sqlitePath = process.env.SQLITE_PATH ?? join(process.cwd(), 'data', 'simulator.sqlite')

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
}

if (!existsSync(sqlitePath)) {
  throw new Error(`SQLite file not found: ${sqlitePath}`)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const db = new DatabaseSync(sqlitePath, { readonly: true })

const parseSnapshot = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const main = async (): Promise<void> => {
  const sessions = db.prepare('SELECT * FROM sessions').all() as unknown as SessionRow[]
  const flights = db.prepare('SELECT * FROM flights').all() as unknown as FlightRow[]

  if (sessions.length > 0) {
    const sessionPayload = sessions.map((row) => ({
      id: row.id,
      scenario_id: row.scenario_id,
      score: row.score,
      snapshot_json: parseSnapshot(row.snapshot_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    const { error } = await supabase.from('sessions').upsert(sessionPayload, { onConflict: 'id' })
    if (error) throw error
  }

  if (flights.length > 0) {
    const flightPayload = flights.map((row) => ({
      id: row.id,
      carrier: row.carrier,
      flight_no: row.flight_no,
      flight_date: row.flight_date,
      dep: row.dep,
      arr: row.arr,
      flight_time: row.flight_time,
      status: row.status,
      aircraft: row.aircraft,
      controller: row.controller,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    const { error } = await supabase.from('flights').upsert(flightPayload, { onConflict: 'id' })
    if (error) throw error
  }

  db.close()
  console.log(`Migrated ${sessions.length} sessions and ${flights.length} flights from ${sqlitePath}`)
}

main().catch((error: unknown) => {
  db.close()
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Migration failed: ${message}`)
  process.exitCode = 1
})
