# RC Endurance Dashboard
Responsive RC endurance race management dashboard built with Next.js, Supabase and Vercel.

## Quick start
```bash
npm install
cp .env.example .env.local
npm run dev
```
Then add the SQL in `supabase/schema.sql` to the Supabase SQL Editor.

The app works in demo mode without environment variables. Add Supabase credentials to persist and synchronise state.

## Deploy
Push this folder to GitHub, import the repository into Vercel, and add:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

See Supabase's current Next.js quickstart for the recommended environment-variable setup.
