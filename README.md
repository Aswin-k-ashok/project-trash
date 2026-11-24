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
- Tap a bin to see its details, edit it or delete it
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
├── supabase
│   └── schema.sql
└── src
    ├── App.jsx
    ├── main.jsx
    ├── index.css
    ├── config.js
    ├── lib
    │   └── supabase.js
    └── components
        ├── BinMap.jsx
        ├── InstallButton.jsx
        └── icons.jsx
```

## 1. Create a Supabase project

Create a free Supabase project and run the SQL from [supabase/schema.sql](./supabase/schema.sql) in the SQL Editor.

Run it again whenever `schema.sql` changes. It is safe to re-run.

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
- Anyone can delete or edit a bin, but only one per request, and at most 30 deletes and 60 edits an hour across all visitors. Every deleted bin is copied to the `deleted_bins` table and every edited bin's old version to `bin_edits`; the comments above those tables in `schema.sql` have queries to restore them.
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so no font service is contacted.
- The service worker only runs in production builds (`npm run build`, then `npm run preview` or a deploy), so `npm run dev` always serves fresh code.
