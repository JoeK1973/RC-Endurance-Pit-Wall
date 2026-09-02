# RC Endurance Dashboard — Supabase Live

## Setup

1. Create a Supabase project.
2. Open **SQL Editor** and run the entire contents of `supabase/schema.sql`.
3. In Supabase, copy the Project URL and publishable/anon key.
4. Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

5. Install and run:

```bash
npm install
npm run dev
```

## How sessions work

- **Create New Session** calls the database function `create_race_session()`.
- Supabase creates a unique `XXXX-XXXX` code and one race row.
- **Join Session** looks up the share code.
- Drivers, queue, race controls and swap actions are stored against that session.
- Supabase Realtime refreshes connected clients when the race, drivers or queue change.

## Vercel

Add the same two environment variables in the Vercel project settings, then deploy from GitHub.

> Prototype note: the supplied RLS policies allow public read/write access so anyone with a valid session code can collaborate. Add Supabase Auth and session membership policies before making the app publicly discoverable.
