import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import {
  createAuthUserWithRole,
  verifyAuthUserPassword,
  createChatMessage,
  createFlight,
  deleteFlightClosure,
  deleteFlight,
  getLatestSession,
  getUserRoleByEmail,
  getSession,
  listUserRoles,
  listChatMessages,
  listFlightClosures,
  listFlights,
  listSessions,
  publishChatMessage,
  setAuthUserPasswordByEmail,
  upsertUserRoleByEmail,
  upsertFlightClosure,
  upsertSession,
} from './db.js'

const app = express()
app.use(cors())
app.use(express.json())

const scenarios = [
  { id: 'turnaround-basic', title: 'Basic Turnaround', level: 'basic' },
  { id: 'clearance-pressure', title: 'Clearance Under Time Pressure', level: 'intermediate' },
]

const readSnapshot = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object') return {}
  const candidate = 'snapshot' in body ? (body as { snapshot?: unknown }).snapshot : body
  return candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
}

const readScenarioId = (snapshot: Record<string, unknown>, fallback = 'turnaround-basic') =>
  typeof snapshot.scenarioId === 'string' ? snapshot.scenarioId : fallback

const readScore = (snapshot: Record<string, unknown>) =>
  typeof snapshot.score === 'number' ? snapshot.score : Number(snapshot.score ?? 0)

const readTextField = (body: Record<string, unknown>, key: string, fallback = '') =>
  typeof body[key] === 'string' ? body[key].trim() : fallback

const cleanSessionId = (id: string) => id.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80)
const cleanFlightLabel = (value: string) => value.trim().slice(0, 180)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/scenarios', (_req, res) => {
  res.json(scenarios)
})

app.get('/api/flights', async (_req, res) => {
  res.json(await listFlights())
})

app.post('/api/flights', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const flight = {
    carrier: readTextField(body, 'carrier', '6X').toUpperCase(),
    flightNo: readTextField(body, 'flightNo'),
    date: readTextField(body, 'date'),
    dep: readTextField(body, 'dep').toUpperCase(),
    arr: readTextField(body, 'arr').toUpperCase(),
    time: readTextField(body, 'time'),
    status: readTextField(body, 'status', 'GO-RO-LI-AN-BN'),
    aircraft: readTextField(body, 'aircraft', '319-ALD').toUpperCase(),
    controller: readTextField(body, 'controller', 'Training Controller'),
  }

  if (!flight.flightNo || !flight.date || !flight.dep || !flight.arr || !flight.time) {
    res.status(400).json({ error: 'flightNo, date, dep, arr, and time are required.' })
    return
  }

  res.status(201).json(await createFlight(flight))
})

app.delete('/api/flights/:id', async (req, res) => {
  if (!(await deleteFlight(req.params.id))) {
    res.status(404).json({ error: 'Flight not found.' })
    return
  }

  res.status(204).send()
})

app.get('/api/sessions', async (_req, res) => {
  res.json(await listSessions())
})

app.get('/api/sessions/latest', async (_req, res) => {
  const latest = await getLatestSession()
  if (!latest) {
    res.status(404).json({ error: 'No saved session found.' })
    return
  }
  res.json(latest)
})

app.put('/api/sessions/current', async (req, res) => {
  const snapshot = readSnapshot(req.body)
  const record = await upsertSession(
    'current',
    readScenarioId(snapshot),
    readScore(snapshot),
    snapshot,
  )

  res.json(record)
})

app.get('/api/sessions/:id', async (req, res) => {
  const id = cleanSessionId(req.params.id)
  const session = id ? await getSession(id) : null
  if (!session) {
    res.status(404).json({ error: 'No saved session found.' })
    return
  }
  res.json(session)
})

app.put('/api/sessions/:id', async (req, res) => {
  const id = cleanSessionId(req.params.id)
  if (!id) {
    res.status(400).json({ error: 'Session id is required.' })
    return
  }

  const snapshot = readSnapshot(req.body)
  const record = await upsertSession(
    id,
    readScenarioId(snapshot),
    readScore(snapshot),
    snapshot,
  )

  res.json(record)
})

app.post('/api/sessions', async (req, res) => {
  const id = `sess-${Date.now()}`
  const snapshot = readSnapshot(req.body)
  const record = await upsertSession(id, readScenarioId(snapshot), readScore(snapshot), snapshot)
  res.status(201).json(record)
})

app.get('/api/chat/messages', async (req, res) => {
  const flightLabel = typeof req.query.flightLabel === 'string' ? cleanFlightLabel(req.query.flightLabel) : ''
  if (!flightLabel) {
    res.status(400).json({ error: 'flightLabel is required.' })
    return
  }

  res.json(await listChatMessages(flightLabel))
})

app.post('/api/chat/messages', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const flightLabel = cleanFlightLabel(readTextField(body, 'flightLabel'))
  const author = readTextField(body, 'author')
  const text = readTextField(body, 'text')
  const recipient = readTextField(body, 'recipient', 'Ramp')
  const priorityRaw = readTextField(body, 'priority', 'medium').toLowerCase()
  const priority = priorityRaw === 'low' || priorityRaw === 'high' ? priorityRaw : 'medium'

  if (!flightLabel || !author || !text) {
    res.status(400).json({ error: 'flightLabel, author, and text are required.' })
    return
  }

  const message = await createChatMessage({ flightLabel, author, text, recipient, priority })
  res.status(201).json(message)
})

app.patch('/api/chat/messages/:id/publish', async (req, res) => {
  const id = cleanSessionId(req.params.id)
  if (!id) {
    res.status(400).json({ error: 'Message id is required.' })
    return
  }

  const updated = await publishChatMessage(id)
  if (!updated) {
    res.status(404).json({ error: 'Message not found.' })
    return
  }

  res.json(updated)
})

app.get('/api/flight-closures', async (_req, res) => {
  res.json(await listFlightClosures())
})

app.put('/api/flight-closures/:flightLabel', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const flightLabel = cleanFlightLabel(req.params.flightLabel)
  const signatureData = readTextField(body, 'signatureData')
  const closedBy = readTextField(body, 'closedBy')
  const closedDevice = readTextField(body, 'closedDevice')

  if (!flightLabel || !signatureData) {
    res.status(400).json({ error: 'flightLabel and signatureData are required.' })
    return
  }

  res.json(await upsertFlightClosure({ flightLabel, signatureData, closedBy, closedDevice }))
})

app.delete('/api/flight-closures/:flightLabel', async (req, res) => {
  const flightLabel = cleanFlightLabel(req.params.flightLabel)
  if (!flightLabel) {
    res.status(400).json({ error: 'flightLabel is required.' })
    return
  }
  if (!(await deleteFlightClosure(flightLabel))) {
    res.status(404).json({ error: 'Flight closure not found.' })
    return
  }
  res.status(204).send()
})

app.post('/api/auth/login', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const email = readTextField(body, 'email').toLowerCase()
  const password = readTextField(body, 'password')
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' })
    return
  }
  const user = await verifyAuthUserPassword(email, password)
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password.' })
    return
  }
  res.json(user)
})

app.post('/api/auth/signup', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const email = readTextField(body, 'email').toLowerCase()
  const password = readTextField(body, 'password')
  const role = readTextField(body, 'role', 'Ramp Agent')
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' })
    return
  }
  try {
    res.status(201).json(await createAuthUserWithRole({
      email,
      password,
      role,
      autoConfirmEmail: true,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create user.'
    if (message.toLowerCase().includes('already registered')) {
      res.status(409).json({ error: message })
      return
    }
    throw error
  }
})

app.get('/api/auth/role', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : ''
  if (!email) {
    res.status(400).json({ error: 'email is required.' })
    return
  }
  const record = await getUserRoleByEmail(email)
  if (!record) {
    res.status(404).json({ error: 'Role not found.' })
    return
  }
  res.json(record)
})

app.put('/api/auth/role', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const email = readTextField(body, 'email').toLowerCase()
  const role = readTextField(body, 'role')
  if (!email || !role) {
    res.status(400).json({ error: 'email and role are required.' })
    return
  }
  res.json(await upsertUserRoleByEmail(email, role))
})

app.post('/api/admin/users', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const email = readTextField(body, 'email').toLowerCase()
  const password = readTextField(body, 'password')
  const role = readTextField(body, 'role', 'Ramp Agent')
  const autoConfirmEmail = body.autoConfirmEmail !== false
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' })
    return
  }
  try {
    res.status(201).json(await createAuthUserWithRole({ email, password, role, autoConfirmEmail }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create user.'
    if (message.toLowerCase().includes('already registered')) {
      res.status(409).json({ error: message })
      return
    }
    throw error
  }
})

app.get('/api/admin/users', async (_req, res) => {
  res.json(await listUserRoles())
})

app.put('/api/admin/users/role', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const email = readTextField(body, 'email').toLowerCase()
  const role = readTextField(body, 'role')
  if (!email || !role) {
    res.status(400).json({ error: 'email and role are required.' })
    return
  }
  res.json(await upsertUserRoleByEmail(email, role))
})

app.put('/api/admin/users/password', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  const email = readTextField(body, 'email').toLowerCase()
  const password = readTextField(body, 'password')
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' })
    return
  }
  const updated = await setAuthUserPasswordByEmail(email, password)
  if (!updated) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  res.status(204).send()
})

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unknown server error'
  res.status(500).json({ error: message })
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`simulator-api listening on ${port}`)
})
