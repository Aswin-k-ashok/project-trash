# Changelog

All notable changes to this waste bin locator project are documented in this file.

Last updated: 2026-11-24 00:00:00 +0530

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
- Added a "nearest bin" card after Locate Me, with the distance and buttons to show the bin or get walking directions (Google Maps link).
- Added the distance from you and a Directions button to every bin popup.
- Added editing: an Edit button in each popup, saved through a new `update_bin()` database function (one bin per call, at most 60 edits an hour, old version kept in a new `bin_edits` table).
- Added a map key for the green (public) and yellow (private) markers.
- Added short confirmations after adding, editing or deleting a bin.
- Added an "add a bin at the map centre" button, so bins can be added with the keyboard.
- Added a "Find nearest bin" button to the sheet shown when nothing else is open.
- Added voting: each bin's details ask "Is it usable?" with thumbs up and down. Whoever adds a bin gives it the first thumbs up. A bin is removed from the map once it has at least 3 thumbs down and 3 more down than up. Limits: 60 votes per device and 30 removals overall per hour.
- Added a full-screen button to the top bar. It hides the browser's address bar and buttons, and shows only where the browser allows it (not on iPhone, where installing the app comes closest).
- Added an anonymous voter id per browser (`src/lib/voter.js`), allowing one vote per bin per device without accounts.
- Added `supabase/migrations`, numbered SQL files run once each in order, with a `schema_migrations` table recording which have run. `0002_votes.sql` adds the `bin_votes` table, bin `status`, `removed_at` and vote totals, and the `create_bin()`, `vote_on_bin()` and `my_votes()` functions.
- Added a data layer (`src/lib/data`), the only code that talks to the backend, with the backend chosen by `VITE_DATA_PROVIDER` (default `supabase`), and `DATA_MODEL.md` describing the data and the rules any backend must enforce.
- Added the Inter font, bundled with the app (`@fontsource-variable/inter`); until now it was named in the CSS but never loaded.

### Changed
- Redesigned the app around the map: it fills the screen, with a floating top bar (name, area, install and feedback buttons) and a sheet for bin details, the add/edit form and the nearest bin. On phones the sheet runs along the bottom; from 900px wide it sits in a panel on the left. This replaces the hero section, the map card and the map popups.
- Changed the phone layout to leave far more of the screen to the map:
  - nothing rests at the bottom until a bin, the nearest bin or a form is open; "Nearest bin" and "Add bin" float in the bottom corner instead of the "Find the nearest bin" card;
  - the top bar is slimmer;
  - the map key and attribution share one small row under the top bar;
  - while a sheet is open, the map buttons shrink to icons;
  - the bin sheet drops the coordinates and the voting hint.
- Changed the map attribution to "© OpenStreetMap contributors" only, without Leaflet's prefix, so it fits beside the map key on phones.
- Changed buttons to black (primary) and grey (secondary). All icons now come from one line-icon set.
- Changed adding a bin to go through `create_bin()` instead of a direct insert, and `update_bin()` to edit only bins still on the map. The public API now lists only bins on the map and accepts no direct writes.
- Changed database errors to show one plain message per kind of problem (setup, invalid input, rate limit, network) instead of Supabase-specific ones.
- Changed bin markers to round markers with a drawn bin icon instead of an emoji; the open bin is ringed in black.
- Changed the bin type picker from a drop-down to two Public / Private buttons.
- Changed the feedback button from a pill on the map to an icon in the top bar, and the install button to an icon beside it.
- Changed the zoom buttons to match the new style, shown on wide screens only (phones pinch to zoom).
- Changed adding or editing a bin to show that bin's details afterwards.
- Changed map tiles to load from `tile.openstreetmap.org` without the a/b/c subdomains, as OpenStreetMap now recommends.
- Changed the app's theme colour to white, and the service worker cache to `bin-there-v3` so installed apps pick up the new manifest.
- Changed the page to run edge to edge on phones with a notch, keeping the floating UI inside the safe area, and to shrink for the Android keyboard so form fields stay visible.
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
- Changed the add/edit form, errors and status messages to float over the map in every view, instead of being inserted above it.
- Changed the map section from a 150vh sticky layout to a normal one.
- Changed mouse-wheel zooming on the page view to need Ctrl (⌘ on Mac) or a trackpad pinch; a plain wheel scrolls the page. Full screen zooms with the wheel as before.
- Changed Locate Me to zoom in to street level (16) and never zoom out.
- Changed the install button to appear only when it can do something: the browser's install prompt, or Add to Home Screen / Add to Dock steps on Safari. It hides once the app is installed.
- Changed the popup type badge to green for public and yellow for private bins.
- Changed muted text, placeholders, the danger button and success text to meet WCAG AA contrast, and focus rings to a solid 3px outline.

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
- Fixed bins beyond the first 1,000 silently missing from the map; bins now load in pages.
- Fixed every marker being rebuilt each time the map moved or a form changed.
- Fixed place-name lookups exceeding Nominatim's one-request-per-second limit; they now wait a second after the map stops and are cached by area.
- Fixed the install button doing nothing on iOS Safari, in browsers without an install prompt, after the prompt was dismissed, and in the installed app.
- Fixed feedback errors showing in the green success style.
- Fixed a reopened feedback dialog being closed by the previous submission's timer.
- Fixed the feedback dialog: Escape closes it, focus moves into it and back out, Tab stays inside it, and the map controls no longer draw over it.
- Fixed a double-tapped delete sending two requests, the status saying "Saving new bin..." while deleting, and Cancel staying active while saving.
- Fixed map markers having no accessible name for screen readers.
- Fixed text inside the map (popups, attribution) using Arial instead of the app font.

### Removed
- Removed the full-screen button and the Ctrl/⌘ + scroll rule: the map is always full screen now, so the mouse wheel simply zooms it.
- Removed deleting: the Delete button and the `delete_bin()` function are gone, and bins leave the map only by votes. Bins deleted earlier stay in `deleted_bins`.
- Removed `supabase/schema.sql` (now `supabase/migrations/0001_initial.sql`) and `src/lib/supabase.js` (now `src/lib/data/supabaseProvider.js`).
- Removed the fallback for databases missing the `title`, `description` or `bin_type` columns; run the migrations instead.

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
