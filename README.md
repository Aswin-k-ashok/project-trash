# Waste Bin Locator

A minimal hobby-friendly waste bin locator built with React, Vite, Leaflet, OpenStreetMap, and Supabase.

## Stack

- React + Vite
- Leaflet + React Leaflet
- OpenStreetMap tiles
- Supabase database and auto-generated API
- Vercel for frontend hosting

## Features

- A full-screen map of waste bins, with a key for public (green) and private (yellow) bins
- Find your nearest bin, see how far it is, and open walking directions
- Add a bin by tapping the map, or with Add bin, which drops a pin at the map centre (works from the keyboard)
- Tap a bin to see its details, edit it, or vote on whether it's usable (thumbs up or down)
- Bins that enough people vote down are removed from the map; nobody can delete one on their own
- Send suggestions and feedback from the top bar
- Install as an app (PWA)

On phones, details and forms open in a sheet along the bottom of the screen; from 900px wide they open in a panel on the left.

## Project Structure

```text
.
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── .gitignore
├── README.md
├── DATA_MODEL.md              # the data and rules any backend must provide
├── supabase
│   └── migrations             # database changes, run in order
│       ├── 0001_initial.sql
│       └── 0002_votes.sql
└── src
    ├── App.jsx
    ├── main.jsx
    ├── index.css
    ├── config.js
    ├── lib
    │   ├── voter.js           # this browser's anonymous voter id
    │   └── data               # the only code that talks to the backend
    │       ├── index.js
    │       └── supabaseProvider.js
    └── components
        ├── BinMap.jsx
        ├── InstallButton.jsx
        └── icons.jsx
```

## 1. Create a Supabase project

Create a free Supabase project. Then, in its SQL Editor, run each file in [supabase/migrations](./supabase/migrations) once, in order: first `0001_initial.sql`, then `0002_votes.sql`, and so on.

**Already have a project?** Run only the migrations it hasn't had yet.
- Projects set up with the old `supabase/schema.sql` already have `0001`; start from `0002_votes.sql`.
- From `0002` on, `select * from public.schema_migrations;` lists the migrations already run.
- Don't run an older migration again: later ones change what it set up.

Deploy the app's code together with a new migration. For example, once `0002` has run, the previous version of the app can no longer add or delete bins.

To change the schema later, add a new numbered file; see [DATA_MODEL.md](./DATA_MODEL.md).

## 2. Add environment variables

Copy `.env.example` to `.env` and fill in your project values:

```bash
cp .env.example .env
```

## 3. Install dependencies

```bash
npm install
```

## 4. Start the app

```bash
npm run dev
```

Open the local URL shown by Vite.

Don't open the app with VS Code's Live Server or by double-clicking `index.html`: the page stays blank. The app is written in JSX, which browsers can't run directly. `npm run dev` translates it as it serves the page; Live Server sends the raw files. To try the production build locally, run `npm run build` and then `npm run preview`.

## 5. Deploy to Vercel

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. Add these environment variables in Vercel project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

## 6. Keep the database awake

Supabase pauses free projects after 7 days without activity. The GitHub Actions workflow in [.github/workflows/keep-supabase-awake.yml](./.github/workflows/keep-supabase-awake.yml) sends one small read request every day to prevent that.

1. In the GitHub repo, open Settings > Secrets and variables > Actions and add two repository secrets:
   - `SUPABASE_URL`: same value as `VITE_SUPABASE_URL`
   - `SUPABASE_ANON_KEY`: same value as `VITE_SUPABASE_ANON_KEY`
2. Merge the workflow into `main`. Scheduled runs only happen from the default branch.
3. Open the Actions tab, pick "Keep Supabase awake", and click "Run workflow" to check that it passes.

The ping cannot wake a project that is already paused. If the job fails with a DNS or connection error, restore the project from the Supabase dashboard first.

## Notes

- The map uses OpenStreetMap tiles, so there is no Google Maps cost.
- Supabase free tier is enough for a hobby project, as long as the keep-awake workflow is running.
- For production, make sure your Supabase Row Level Security policies match how open you want the project to be.
- Voting: each browser gets a random, anonymous voter id, allowing one vote per bin per device. Whoever adds a bin gives it the first thumbs up. A bin is removed from the map once it has at least 3 thumbs down and 3 more thumbs down than up. Limits: 60 votes per device and 30 removals overall per hour, and 60 edits per hour. Full rules are in [DATA_MODEL.md](./DATA_MODEL.md).
- Removed bins stay in the database with `status = 'removed'`. The comment at the top of `0002_votes.sql` shows how to list them and put one back. Every edit keeps the old version in `bin_edits`; `0001_initial.sql` shows how to undo one.
- The backend can be swapped: all data access goes through `src/lib/data`, and `VITE_DATA_PROVIDER` (default `supabase`) picks the provider. See [DATA_MODEL.md](./DATA_MODEL.md).
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so no font service is contacted.
- The service worker only runs in production builds (`npm run build`, then `npm run preview` or a deploy), so `npm run dev` always serves fresh code.
