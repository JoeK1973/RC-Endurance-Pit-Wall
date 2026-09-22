# Firebase migration status

## Completed

- Replaced the Supabase browser backend with the Firebase Web SDK.
- Added Firebase Anonymous Authentication bootstrap.
- Added Firestore-backed session creation with unique session-code mapping.
- Added Firestore membership records per session/user.
- Added a compatibility query layer so the existing Pit Wall page retains its table-oriented data operations while the backend changes underneath it.
- Added Firestore realtime listeners for races, drivers, queue, live-results configuration and laps.
- Realtime updates are applied incrementally with `docChanges()`; they do not reload the complete session.
- Race updates now update only the local race state rather than calling `loadSession()`.
- Queue changes therefore produce one Firestore write and one realtime document change rather than a write followed by a full multi-query refresh.
- ID-only race updates/deletes avoid an extra read before the write/delete.
- RC-Results remains an HTTP poller; Firestore is written only when a genuinely new lap is detected.
- Retained the existing RC-Results Next.js route and five-tab UI.
- Added Firestore security rules and indexes.
- Removed Supabase runtime dependencies/source files from this migration copy.

## Not completed yet

- Existing Supabase data is not automatically imported.
- A production race-day test against a real Firebase project has not been run here.
- A full `next build` could not be executed in this environment because `npm install` could not complete due to the available network/package-install environment.

## Next test

1. Create a Firebase project.
2. Enable Anonymous Authentication and Firestore.
3. Register a Firebase Web App.
4. Copy its configuration into `.env.local` using `.env.example`.
5. Deploy `firestore.rules` and `firestore.indexes.json`.
6. Run `npm install` and `npm run dev` locally.
7. Create a session on one browser/device.
8. Join the session from a second browser/device using the session code.
9. Test driver add/edit, duplicate queue entries, queue removal, timer, swaps, settings, lap storage, history, RC-Results and all five tabs.
10. Only after that, deploy the Firebase branch to Vercel.
