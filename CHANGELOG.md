# Changelog

All notable changes to this waste bin locator project are documented in this file.

Last updated: 2026-11-20 00:00:00 +0530

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
- Added bin type selection when creating a new bin.
- Added clearer in-app error handling for missing Supabase configuration.
- Added clearer in-app error handling for missing `public.bins` table errors.
- Added a daily GitHub Actions workflow that pings Supabase so the free project is not paused for inactivity.
- Added `CLOUDFLARE_MIGRATION_PLAN.md` describing the planned move to Cloudflare Workers + D1.
- Added a dashed draft pin that shows where a new bin will go. It can be dragged, and tapping the map again moves it without clearing the form.
- Added a `delete_bin()` database function and a `deleted_bins` archive table, so deleted bins can be restored (see the comment in `supabase/schema.sql`).
- Added database checks for bin type, coordinates and text length, with matching length limits on the forms.
- Added a dismiss button to the error banner.

### Changed
- Changed the default map center from Delhi to Kochi, Kerala, India.
- Changed the map heading from a static community label to a live location-based area label.
- Changed the add-bin flow from a browser `prompt()` to a proper inline form.
- Changed the `Locate Me` control from a plain button to a more map-style location button.
- Changed the Supabase schema to support optional `title` values for bins.
- Changed the Supabase schema to store a `bin_type` value with a default of `public`.
- Changed bin markers to use color-coded trash icons for public and private bins.
- Changed the Supabase schema to support public delete policy for hobby-project simplicity.
- Changed deleting to go through `delete_bin()`: one bin per request and at most 30 an hour across all visitors. The public API no longer accepts direct deletes, which let one request empty the table.
- Changed the service worker to load pages from the network first, to skip other origins, and to cache only successful responses (cache `bin-there-v2`).
- Changed the service worker to register only in production builds.
- Changed full-screen mode to keep the same map instead of creating a second one.
- Changed the feedback dialog backdrop to block map clicks and to close the dialog when clicked.
- Changed confirming a delete to close the bin's popup.

### Fixed
- Fixed the startup white-screen issue caused by missing Supabase environment variables.
- Fixed the app to show user-friendly setup messages instead of crashing when env vars are absent.
- Improved the UX around Supabase API errors by showing more specific guidance for schema issues.
- Fixed bin saves against older Supabase schemas by falling back to coordinate-only inserts and showing a clearer missing-column message.
- Fixed legacy save fallback handling so older Supabase tables can still accept new bins before `bin_type` is added.
- Fixed installed users staying on an old version of the app after a deploy.
- Fixed `npm run dev` serving stale code from a leftover service worker.
- Fixed the add-bin form, errors and status messages being hidden in full-screen mode.
- Fixed full-screen mode resetting the map position, zoom, open popup and page scroll position.
- Fixed the add-bin form opening after a click that closed a popup, after a double-click zoom, and after a click behind the feedback dialog.
- Fixed a second tap on the map clearing the title and description already typed.
- Fixed feedback made only of spaces being sent.
- Fixed a misleading "run schema.sql" message when deleting a bin that was already removed.

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
