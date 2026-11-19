# Waste Bin Locator

A minimal hobby-friendly waste bin locator built with React, Vite, Leaflet, OpenStreetMap, and Supabase.

## Stack

- React + Vite
- Leaflet + React Leaflet
- OpenStreetMap tiles
- Supabase database and auto-generated API
- Vercel for frontend hosting

## Features

- View waste bins on a map
- Add a new bin by clicking anywhere on the map
- Save bins to Supabase
- Show marker popups with coordinates and optional description

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
        └── BinMap.jsx
```

## 1. Create a Supabase project

Create a free Supabase project and run the SQL from [supabase/schema.sql](./supabase/schema.sql) in the SQL Editor.

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
