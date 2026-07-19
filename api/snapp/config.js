const SNAPP_BASE = () => (process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(/\/$/, '')
const SNAPP_KEY = () => process.env.SNAPP_API_KEY?.trim() || ''
const PUBLIC_URL = () =>
  (process.env.SNAPP_PUBLIC_URL || process.env.SNAPP_BASE_URL || 'https://snapp-ops.vercel.app').replace(
    /\/$/,
    '',
  )

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  res.status(200).json({
    configured: Boolean(SNAPP_BASE() && SNAPP_KEY()),
    publicBaseUrl: PUBLIC_URL(),
  })
}
