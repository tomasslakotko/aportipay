/** AirportPay catalog row shape (matches simulator-web AdminFlight). */
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
  createdAt?: string
  updatedAt?: string
  source?: 'local' | 'snapp'
  gate?: string
  boardingTime?: string
  delayMinutes?: number
}

/** Minimal SNAPP flight shape from /api/integration/flights */
export interface SnappFlight {
  id: string
  flight_number: string
  origin: string
  destination: string
  status: string
  boarding_time: string
  gate_departure: string
  gate_arrival: string
  aircraft_type: string
  scheduled_dep: string
  scheduled_arr: string
  delay_minutes: number
  operated_by?: string
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function splitFlightNumber(flightNumber: string): { carrier: string; flightNo: string } {
  const raw = flightNumber.trim().toUpperCase()
  const match = raw.match(/^([A-Z0-9]{2})\s*(.*)$/)
  if (match) {
    return { carrier: match[1]!, flightNo: (match[2] || raw).replace(/\s/g, '') }
  }
  return { carrier: raw.slice(0, 2) || 'XX', flightNo: raw.slice(2) || raw }
}

function formatDateTimeParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return { date: iso.slice(0, 10) || '', time: '' }
  }
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  }
}

export function mapSnappFlightToAdmin(flight: SnappFlight): AdminFlight {
  const { carrier, flightNo } = splitFlightNumber(flight.flight_number)
  const { date, time } = formatDateTimeParts(flight.scheduled_dep)
  return {
    id: flight.id,
    carrier,
    flightNo,
    date,
    dep: (flight.origin || '').toUpperCase(),
    arr: (flight.destination || '').toUpperCase(),
    time,
    status: flight.status || 'Scheduled',
    aircraft: flight.aircraft_type || '—',
    controller: flight.operated_by || 'SNAPP Ops',
    source: 'snapp',
    gate: flight.gate_departure || '',
    boardingTime: flight.boarding_time || '',
    delayMinutes: flight.delay_minutes ?? 0,
  }
}

export async function fetchSnappFlightsFromUpstream(): Promise<AdminFlight[]> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(`${base}/api/integration/flights`, {
    headers: { 'x-snapp-api-key': key },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP list failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { flights?: SnappFlight[]; error?: string }
  if (!payload.flights) {
    throw new Error(payload.error || 'SNAPP returned no flights')
  }
  return payload.flights.map(mapSnappFlightToAdmin)
}

export async function fetchSnappFlightFromUpstream(id: string): Promise<AdminFlight> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(`${base}/api/integration/flights/${encodeURIComponent(id)}`, {
    headers: { 'x-snapp-api-key': key },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP get failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { flight?: SnappFlight; error?: string }
  if (!payload.flight) {
    throw new Error(payload.error || 'Flight not found')
  }
  return mapSnappFlightToAdmin(payload.flight)
}

export async function patchSnappFlightUpstream(
  id: string,
  body: {
    status?: string
    gate_departure?: string
    gate_arrival?: string
    boarding_time?: string
    delay_minutes?: number
  },
): Promise<AdminFlight> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(`${base}/api/integration/flights/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-snapp-api-key': key,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP update failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { flight?: SnappFlight; error?: string }
  if (!payload.flight) {
    throw new Error(payload.error || 'Update succeeded but no flight returned')
  }
  return mapSnappFlightToAdmin(payload.flight)
}

export async function fetchSnappPassengersFromUpstream(id: string): Promise<unknown> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(
    `${base}/api/integration/flights/${encodeURIComponent(id)}/passengers`,
    { headers: { 'x-snapp-api-key': key } },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP passengers failed (${response.status}): ${text.slice(0, 200)}`)
  }
  return response.json()
}

export async function fetchSnappConversationsFromUpstream(id: string): Promise<unknown> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(
    `${base}/api/integration/flights/${encodeURIComponent(id)}/conversations`,
    { headers: { 'x-snapp-api-key': key } },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP conversations failed (${response.status}): ${text.slice(0, 200)}`)
  }
  return response.json()
}

export async function postSnappConversationUpstream(
  id: string,
  body: {
    body: string
    authorRole?: string
    authorId?: string
    priority?: 'normal' | 'high'
    recipients?: string[]
    source?: string
  },
): Promise<unknown> {
  const base = (process.env.SNAPP_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SNAPP_API_KEY?.trim()
  if (!base || !key) {
    throw new Error('SNAPP_BASE_URL and SNAPP_API_KEY must be set on simulator-api')
  }

  const response = await fetch(
    `${base}/api/integration/flights/${encodeURIComponent(id)}/conversations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-snapp-api-key': key,
      },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SNAPP conversation create failed (${response.status}): ${text.slice(0, 200)}`)
  }
  return response.json()
}

export function snappPublicBaseUrl() {
  return (process.env.SNAPP_PUBLIC_URL || process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(
    /\/$/,
    '',
  )
}
