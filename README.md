# RC Pit Wall

A browser-based RC endurance racing pit-wall app built with React + Vite, with Supabase-backed multi-device live sharing.

## Features

- Race, battery and driver clocks
- Driver queue / rotation
- Driver load tracking
- Stint history and lap logging
- Pace charts and strategy simulator
- Excel and CSV export
- Shared session codes and links
- Live state synchronisation between devices
- Persistent race snapshots in Supabase

## 1. Install

```bash
npm install
npm run dev
```

## 2. Configure Supabase

Create a Supabase project, then run `supabase/schema.sql` in the SQL Editor.

Copy `.env.example` to `.env.local` and fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

The app also runs without Supabase, but live sharing will be disabled.

## 3. GitHub Pages

The included GitHub Actions workflow deploys the app to GitHub Pages.

If your repository has a different name, change the `base` value in `vite.config.js` from `/rc-pit-wall/` to `/<YOUR-REPOSITORY>/`.

In GitHub:

1. Settings → Pages
2. Source → GitHub Actions
3. Add repository secrets/variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Push to `main`.

The app will deploy automatically.

## Sharing

Open the Share button. A six-character session code is generated for a new race. Other devices can enter the code and join the same session. The app subscribes to Supabase Realtime and also persists the latest session snapshot in Postgres so a newly joined device can recover the current state.

For production club use, enable additional authentication/RLS controls in Supabase rather than treating the six-character code as a security boundary.
