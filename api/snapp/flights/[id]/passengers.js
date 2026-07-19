const SNAPP_BASE = () => (process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(/\/$/, '')
const SNAPP_KEY = () => process.env.SNAPP_API_KEY?.trim() || ''

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

  const id = req.query.id
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Missing flight id' })
    return
  }

  const base = SNAPP_BASE()
  const key = SNAPP_KEY()
  if (!base || !key) {
    res.status(503).json({ error: 'SNAPP_BASE_URL and SNAPP_API_KEY must be set on Vercel' })
    return
  }

  try {
    const upstream = await fetch(
      `${base}/api/integration/flights/${encodeURIComponent(id)}/passengers`,
      { headers: { 'x-snapp-api-key': key } },
    )
    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: payload.error || `SNAPP passengers failed (${upstream.status})` })
      return
    }
    res.status(200).json(payload)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'SNAPP proxy failed' })
  }
}
