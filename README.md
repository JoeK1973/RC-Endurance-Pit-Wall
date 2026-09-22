# RC Endurance Pit Wall — Firebase migration

This is a **separate Firebase/Firestore migration build** of the confirmed RC Endurance Pit Wall frontend baseline.

The original Supabase baseline ZIP remains unchanged and is the rollback/reference version.

## What changed

- Supabase browser client → Firebase Web SDK
- Supabase Realtime → Firestore `onSnapshot`
- Supabase `create_race_session` RPC → Firestore transaction
- Supabase tables → Firestore collections
- Anonymous Firebase Authentication is used so race-day users do not need accounts
- Vercel remains the recommended host
- The existing `/api/rc-results` route remains in Next.js
- Session sharing remains `?session=SESSIONCODE`
- The existing five-tab Pit Wall UI is preserved

## Firestore data model

The migration deliberately keeps a simple top-level collection model so the existing UI can be migrated without changing its data terminology:

- `sessions`
- `sessionCodes`
- `races`
- `drivers`
- `driver_queue`
- `live_results_config`
- `race_laps`
- `driver_stints`
- `race_events`
- `sessions/{sessionId}/members/{uid}`

Every race-owned record contains `session_id`. Firestore security rules use the membership document to isolate sessions.

## Firebase setup

1. Create a Firebase project.
2. Add a **Web App** in Project settings.
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Create a **Cloud Firestore database**.
5. Publish `firestore.rules`.
6. Deploy `firestore.indexes.json` (the supplied `firebase.json` is configured for both).
7. Copy `.env.example` to `.env.local` and paste the Web App configuration values into it.
8. Run `npm install`.
9. Run `npm run dev`.

### Environment variables

```text
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

These are Firebase Web App configuration values. They are intended to be exposed to the browser; Firestore security rules are what protect the data.

## Firebase CLI deployment

After installing the Firebase CLI and logging in:

```bash
firebase use --add
firebase deploy --only firestore
```

Select the Firebase project when prompted.

## GitHub / Vercel

Push the contents of this folder to GitHub. Import the repository into Vercel and add the six `NEXT_PUBLIC_FIREBASE_*` variables in the Vercel project settings.

Vercel can continue to host the Next.js app; Firebase does not need to host the frontend.

## Important: existing Supabase data

This migration does **not** automatically copy existing Supabase sessions, drivers, laps, stints or events into Firestore. The Firebase build starts new sessions in Firestore.

Keep the original Supabase project and the known-working Supabase ZIP until the Firebase version has been tested at an actual race.

## RC-Results

The existing Next.js `/api/rc-results` proxy/parser is retained. The browser polls RC-Results as before, but completed laps are stored in Firestore instead of Supabase.

The Firestore build does not write a Firestore document every five seconds. It only writes newly detected laps, while Firestore realtime listeners distribute stored changes to connected Pit Wall clients.

## Free-tier consideration

Firebase and Supabase have different quota/billing models. This build is intended to avoid the Supabase Free inactivity-pause behaviour by moving the persistent backend to Firebase, but Firebase usage is still subject to the limits and billing rules of the Firebase plan you choose. Monitor Firestore reads/writes and the project's billing/quota settings before a major event.
