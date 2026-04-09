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

## Notes

- The map uses OpenStreetMap tiles, so there is no Google Maps cost.
- Supabase free tier is enough for a hobby project.
- For production, make sure your Supabase Row Level Security policies match how open you want the project to be.
