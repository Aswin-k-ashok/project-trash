# Changelog

All notable changes to this waste bin locator project are documented in this file.

Last updated: 2026-04-09 23:37:29 +0530

## [Unreleased]

### Added
- Bootstrapped a React + Vite frontend for a waste bin locator web app.
- Added Leaflet with OpenStreetMap tiles for free map rendering.
- Added Supabase client integration for loading and saving bin data.
- Added a `supabase/schema.sql` file for creating the `public.bins` table.
- Added beginner-friendly setup documentation in `README.md`.
- Added support for creating bins by clicking on the map.
- Added a draft bin form with `title` and `description` fields.
- Added marker popups showing bin title, description, and coordinates.
- Added delete functionality for bins from the popup.
- Added a custom trash-can marker for bin locations.
- Added reverse geocoding with OpenStreetMap Nominatim to display the current area name.
- Added a `Locate Me` feature using the browser Geolocation API.
- Added a live user-location marker and map recentering for mobile usage.
- Added clearer in-app error handling for missing Supabase configuration.
- Added clearer in-app error handling for missing `public.bins` table errors.

### Changed
- Changed the default map center from Delhi to Kochi, Kerala, India.
- Changed the map heading from a static community label to a live location-based area label.
- Changed the add-bin flow from a browser `prompt()` to a proper inline form.
- Changed the `Locate Me` control from a plain button to a more map-style location button.
- Changed the Supabase schema to support optional `title` values for bins.
- Changed the Supabase schema to support public delete policy for hobby-project simplicity.

### Fixed
- Fixed the startup white-screen issue caused by missing Supabase environment variables.
- Fixed the app to show user-friendly setup messages instead of crashing when env vars are absent.
- Improved the UX around Supabase API errors by showing more specific guidance for schema issues.
- Fixed bin saves against older Supabase schemas by falling back to coordinate-only inserts and showing a clearer missing-column message.

### Notes
- The app is designed around a zero-cost hobby stack:
  - React + Vite
  - Leaflet + OpenStreetMap
  - Supabase free tier
  - Vercel deployment
- The frontend requires:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- The Postgres connection string and database password must not be used in the browser app.
