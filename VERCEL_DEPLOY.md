# Deploy AportiPay to Vercel

Deploy **only** `simulator-web`. Data and auth use Firebase in the browser; you do not need `simulator-api` on Vercel for normal use.

## Option A — Vercel Dashboard (GitHub import)

1. Push this repo to GitHub (if not already).
2. Go to [vercel.com/new](https://vercel.com/new) → Import the repository.
3. **Either:**
   - Leave **Root Directory** empty and use the repo-root `vercel.json` (builds `simulator-web` automatically), **or**
   - Set **Root Directory** to `simulator-web` and use `simulator-web/vercel.json` only.

   If you import the repo root **without** either of the above, Vercel deploys an empty site → **404 NOT_FOUND**.
4. **Framework Preset:** Vite
5. **Build Command:** `npm run build`
6. **Output Directory:** `dist`
7. **Environment variables** (Production + Preview) — copy from `simulator-web/.env`:

   | Name | Notes |
   |------|--------|
   | `VITE_FIREBASE_API_KEY` | Required |
   | `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `aa-lids-simulator.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | `aa-lids-simulator` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | |
   | `VITE_FIREBASE_APP_ID` | Required |
   | `VITE_SHARED_SESSION_ID` | e.g. `shared-main` (shared workspace across devices) |

   Do **not** set `VITE_API_BASE_URL` unless you also host `simulator-api` elsewhere.

8. Deploy.

## Option B — Vercel CLI

```bash
cd simulator-web
vercel link          # once: pick team + project name
vercel env add VITE_FIREBASE_API_KEY production
# ... repeat for each VITE_* variable
vercel --prod
```

## aa-lids (Medi) on Vercel

Deploy the **Medi** repo separately (it already has `vercel.json`). Use the same Firebase `VITE_*` variables so Passenger Finalize sync works with AportiPay.

## After deploy

- Open the Vercel URL → login with an account from `aportipay_users` in Firestore.
- In Firebase Console → Authentication is not used; ensure Firestore rules allow your demo (see `FIREBASE_SETUP.md`).
- Optional: add your Vercel domain under Firebase **Authorized domains** if you use Firebase Auth later.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank page on `/search` refresh | `vercel.json` SPA rewrite (included) |
| Login fails | Add all `VITE_FIREBASE_*` env vars; redeploy |
| No flights / no sync | Same Firebase project as aa-lids; check Firestore data |
| Session lost between users | Change `VITE_SHARED_SESSION_ID` per environment or user |
