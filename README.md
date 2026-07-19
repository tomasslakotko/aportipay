# AportiPay Simulator

Airline operations simulator with a React web client and Express API backed by Firebase Firestore (project `aa-lids-simulator`, shared with aa-lids).

## Quick start (localhost)

```bash
# Terminal 1 — API (port 8787)
cd simulator-api
cp .env.example .env   # Firebase service account + project id
npm install
npm run dev

# Terminal 2 — Web (port 5173)
cd simulator-web
cp .env.example .env   # Firebase Web app config
npm install
npm run dev
```

Open http://localhost:5173/

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) for credentials and one-time Supabase migration.

## LAN / iPad testing

From the project root:

```bash
./start-lan.sh
```

## Structure

- `simulator-api` — Express API (Firestore via Firebase Admin)
- `simulator-web` — Vite + React frontend (Firestore realtime + API)
