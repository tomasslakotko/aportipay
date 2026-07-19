const SNAPP_BASE = () => (process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(/\/$/, '')
const SNAPP_KEY = () => process.env.SNAPP_API_KEY?.trim() || ''

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function splitFlightNumber(flightNumber) {
  const raw = String(flightNumber || '').trim().toUpperCase()
  const match = raw.match(/^([A-Z0-9]{2})\s*(.*)$/)
  if (match) return { carrier: match[1], flightNo: (match[2] || raw).replace(/\s/g, '') }
  return { carrier: raw.slice(0, 2) || 'XX', flightNo: raw.slice(2) || raw }
}

function mapFlight(flight) {
  const { carrier, flightNo } = splitFlightNumber(flight.flight_number)
  const d = new Date(flight.scheduled_dep)
  const pad = (n) => String(n).padStart(2, '0')
  const date = Number.isNaN(d.getTime())
    ? String(flight.scheduled_dep || '').slice(0, 10)
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = Number.isNaN(d.getTime())
    ? ''
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return {
    id: flight.id,
    carrier,
    flightNo,
    date,
    dep: String(flight.origin || '').toUpperCase(),
    arr: String(flight.destination || '').toUpperCase(),
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

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const base = SNAPP_BASE()
  const key = SNAPP_KEY()
  if (!base || !key) {
    res.status(503).json({ error: 'SNAPP_BASE_URL and SNAPP_API_KEY must be set on Vercel' })
    return
  }

  try {
    const upstream = await fetch(`${base}/api/integration/flights`, {
      headers: { 'x-snapp-api-key': key },
    })
    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: payload.error || `SNAPP list failed (${upstream.status})` })
      return
    }
    const flights = Array.isArray(payload.flights) ? payload.flights.map(mapFlight) : []
    res.status(200).json(flights)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'SNAPP proxy failed' })
  }
}
