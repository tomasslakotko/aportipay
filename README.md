# AportiPay Simulator

Airline operations simulator with a React web client and Express API backed by Supabase.

## Quick start (localhost)

```bash
# Terminal 1 — API (port 8787)
cd simulator-api
cp .env.example .env   # fill in Supabase credentials
npm install
npm run dev

# Terminal 2 — Web (port 5173)
cd simulator-web
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173/

## LAN / iPad testing

From the project root:

```bash
./start-lan.sh
```

## Structure

- `simulator-api` — Express API
- `simulator-web` — Vite + React frontend
