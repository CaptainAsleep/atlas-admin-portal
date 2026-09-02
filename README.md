# Atlas Admin

Internal, read-only dashboard for a high-level view of Atlas: fields
claimed, paid bookings, booking-fee revenue, subscription MRR, and a
per-field breakdown.

Same stack as `atlas-owners-app` / `atlas-players-app` (Vite + React +
Tailwind + Firebase client SDK), same deploy pattern (GitHub Actions →
GitHub Pages). Reads from the same Firebase project as those two apps —
this repo has no backend of its own.

## Access

Gated to a single admin account (the same uid as `ATLAS_OWNER_UID` in the
player app). The real enforcement is server-side, in `atlas-players-app`'s
`firestore.rules` (`isAdmin()`) — this app's own uid check is only there
for a clean "not authorized" screen, not the actual security boundary.

Sign in with the existing Atlas owner-app account — no separate account
needed, since Firebase Auth users are shared across the whole project.

## Local development

```
npm install
cp .env.example .env.local   # fill in with the same Firebase config as the other two apps
npm run dev
```

## Deploy

Push to `main` — GitHub Actions builds and deploys to GitHub Pages
automatically. Needs these repo secrets set under Settings → Secrets and
variables → Actions (same 6 values as the owner/player app repos):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Custom domain: `admin.airsoftatlas.app` (see `CNAME`), matching the
`ownerapp.airsoftatlas.app` / `playerapp.airsoftatlas.app` pattern.
