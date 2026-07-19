# AportiPay Firebase Setup

AportiPay uses the same Firebase project as **aa-lids**: `aa-lids-simulator`.

## Collections

| Data | Firestore collection |
|------|-------------------|
| Ramp sessions | `ramp_sessions` |
| Admin flights | `aportipay_flights` |
| Chat messages | `operation_messages` |
| Flight closures | `aportipay_flight_closures` |
| User roles | `aportipay_user_roles` |
| Auth users | `aportipay_users` |

## 1. Web app config

Copy values from the aa-lids Firebase Web app into `simulator-web/.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=aa-lids-simulator.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=aa-lids-simulator
VITE_FIREBASE_STORAGE_BUCKET=aa-lids-simulator.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 2. How data flows

The **web app** reads and writes Firestore directly (same pattern as aa-lids). No service account is required for normal use — only the Web app config above.

The Express API still serves `/api/scenarios` and `/health`. Optional Admin SDK credentials in `simulator-api/.env` enable legacy API data routes:

```env
FIREBASE_PROJECT_ID=aa-lids-simulator
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/serviceAccount.json
PORT=8787
```

## 3. Firestore rules (simulator/demo)

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Tighten these rules before storing real customer data.

## 4. Migrate existing Supabase data

```bash
cd simulator-api
# .env needs Firebase Web config (FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, …)
# plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the old project
npm run migrate:supabase
```

Run this while the Supabase project is reachable. Migrated auth users need a password reset in Admin unless they sign up again in Firebase.

Migrated Supabase Auth users keep their email and role, but passwords must be reset in Admin because only password hashes that existed in Firestore are usable.

## 5. Run locally

```bash
cd simulator-api && npm install && npm run dev
cd simulator-web && npm install && npm run dev
```
