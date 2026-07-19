const SNAPP_BASE = () => (process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(/\/$/, '')
const SNAPP_KEY = () => process.env.SNAPP_API_KEY?.trim() || ''

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
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
    if (req.method === 'GET') {
      const upstream = await fetch(
        `${base}/api/integration/flights/${encodeURIComponent(id)}/conversations`,
        { headers: { 'x-snapp-api-key': key } },
      )
      const payload = await upstream.json().catch(() => ({}))
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: payload.error || `SNAPP conversations failed (${upstream.status})` })
        return
      }
      res.status(200).json(payload)
      return
    }

    if (req.method === 'POST') {
      const upstream = await fetch(
        `${base}/api/integration/flights/${encodeURIComponent(id)}/conversations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-snapp-api-key': key,
          },
          body: JSON.stringify(req.body || {}),
        },
      )
      const payload = await upstream.json().catch(() => ({}))
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: payload.error || `SNAPP conversation create failed (${upstream.status})` })
        return
      }
      res.status(upstream.status === 201 ? 201 : 200).json(payload)
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'SNAPP proxy failed' })
  }
}
