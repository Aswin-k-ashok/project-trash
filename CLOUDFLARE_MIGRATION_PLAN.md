# Cloudflare Migration Plan

Move **Bin There** from **Supabase (database) + Vercel (hosting)** to **Cloudflare Workers (hosting + API) + Cloudflare D1 (database)**, staying on free plans.

- Written: 2026-11-19
- Status: Phase 0 step 1 (the service worker fix) is done in code as of 2026-11-20 and needs deploying. Later phases not started. The daily Supabase ping (`.github/workflows/keep-supabase-awake.yml`) covers the gap until cutover.
- Rough effort: 1 to 2 focused days, plus a few days of waiting between phases for browsers to pick up the service worker fix.

---

## 1. Why migrate

| Problem today | After migration |
|---|---|
| Supabase pauses free projects after 7 days with no activity. On 2026-11-19 the project hostname already returned "no such domain", meaning it was paused. | D1 on the Workers Free plan does not pause. |
| Running depends on a keep-awake workaround. | Nothing to keep awake. |
| Any visitor can delete or edit any bin, through the `delete_bin()` and `update_bin()` functions: one bin per call, at most 30 deletes and 60 edits an hour, with the old version copied to `deleted_bins` / `bin_edits` first. | All writes go through our own API, so delete and edit rules can be tightened (Phase 8). |
| Hosting and database are with two providers, set up with two sets of env vars. | One provider and one config file, with no secrets in the frontend. |

Vercel itself works fine. It moves only because Cloudflare can serve the site and the API from the same Worker.

---

## 2. Current state (verified in code on 2026-11-20)

**Frontend:** React 18 + Vite 5.4 single-page app, Leaflet/OpenStreetMap, Nominatim reverse geocoding, and a PWA (`public/manifest.webmanifest`, `public/sw.js`). It has no router and is served from `/`.

**Database:** two tables, defined in [supabase/schema.sql](supabase/schema.sql).

| Table | Columns | Anon access (RLS) |
|---|---|---|
| `bins` | `id uuid`, `latitude double`, `longitude double`, `bin_type text default 'public'`, `title text`, `description text`, `created_at timestamptz` | select, insert; delete only through `delete_bin(bin_id)`, update only through `update_bin(...)` |
| `app_feedback` | `id uuid`, `name text`, `feedback text`, `created_at timestamptz` | insert only |
| `deleted_bins` | the `bins` columns plus `deletion_id`, `deleted_at`; an archive of deleted bins | none |
| `bin_edits` | the `bins` columns plus `edit_id`, `edited_at`; the version of a bin from before each edit | none |

Check constraints limit `bin_type` to `public`/`private`, coordinates to valid ranges, and text to the same lengths as the Phase 4 validation rules.

**Every database call** is in [src/components/BinMap.jsx](src/components/BinMap.jsx) and goes through [src/lib/supabase.js](src/lib/supabase.js):

| What | Where (`BinMap.jsx`) | Supabase call |
|---|---|---|
| Load all bins | `loadBins` → `fetchAllBins` | `from('bins').select('*', { count: 'exact' }).order(...).range(...)` in 1,000-row pages, because Supabase caps each response at 1,000 rows |
| Add a bin | `handleSaveDraftBin` | `insert(payload).select().single()`, plus a "legacy insert" fallback for old schemas |
| Edit a bin | `saveBinChanges` | `rpc('update_bin', { bin_id, new_latitude, new_longitude, new_bin_type, new_title, new_description })`, which returns the updated row, or no row if the bin was already gone |
| Delete a bin | `handleDeleteBin` | `rpc('delete_bin', { bin_id })`, which returns `false` if the bin was already gone |
| Send feedback | `handleFeedbackSubmit` | `from('app_feedback').insert({ name, feedback })` |

The app does not use Supabase auth, storage or realtime. Its two RPCs are `delete_bin` and `update_bin`.

**Service worker problems found during review** (they affect the cutover, so Phase 0 fixes them first):

1. Every same-origin GET is served **cache-first**, and the app shell `/` is precached. Returning users keep getting the old `index.html` and the old JS bundle after a deploy, until `CACHE_NAME` changes. After cutover they would keep running the Supabase build.
2. Once the API is same-origin, `GET /api/bins` would be cached on first load and **never refreshed**.

---

## 3. Target architecture

```text
Browser (React SPA + service worker)
   |
   |  https://bin-there.<your-subdomain>.workers.dev  (or a custom domain)
   v
Cloudflare Worker "bin-there"
   |-- static assets (dist/client: index.html, JS, CSS, icons, sw.js)  <- served directly, Worker not invoked
   |-- /api/*  -> worker/index.js (run_worker_first)
                    |
                    v
                D1 database "bin-there-db"  (binding: env.DB)
```

- **Workers with static assets, not Pages.** Cloudflare now points new projects to Workers, and `@cloudflare/vite-plugin` runs the React app, the Worker and a local D1 together under `npm run dev`. Pages + Pages Functions would also work and would avoid the Vite upgrade, but that path no longer gets new features.
- **The API is on the same origin as the site**, so CORS isn't needed.
- **No frontend env vars.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` go away.

### Free-plan limits and what they mean here

Source: Cloudflare docs, checked 2026-11-19. Recheck before starting.

| Limit (Workers Free) | Value | Impact on this app |
|---|---|---|
| Worker requests | 100,000 / day (resets 00:00 UTC; error 1027 when exceeded) | Only `/api/*` calls count. Static files don't invoke the Worker. |
| CPU time | 10 ms per request | Plenty. Waiting on D1 is I/O, not CPU. |
| D1 rows read | 5,000,000 / day | `GET /api/bins` reads **every** row. With 2,000 bins that is about 2,500 page loads per day. Fine for now; Phase 8 adds a map-area query if it grows. |
| D1 rows written | 100,000 / day | One new bin is about 2 rows (table + `created_at` index). |
| D1 storage | 500 MB per database, 5 GB per account | Years of headroom. |
| D1 queries per request | 50 | We use 1 per request. |
| What happens at a limit | D1 returns errors until the daily reset | The app shows its normal error banner. No surprise bill, because the free plan has no overage charges. |

---

## 4. Decisions to make before starting

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Public URL | (a) free `*.workers.dev` subdomain; (b) a custom domain | Use (a) unless you already own a domain. Note that an origin change means PWA users must reinstall from the new URL (see Phase 7). |
| D2 | Delete rules | (a) same as today, anyone can delete; (b) only whoever added the bin, plus an admin key; (c) admin only | Ship (a) first so the migration changes as little as possible, then do (b) in Phase 8. |
| D3 | IDs | keep UUID text, or switch to integers | Keep UUID text. Existing IDs survive unchanged and the Worker generates them with `crypto.randomUUID()`. |
| D4 | How deploys happen | (a) Workers Builds (Cloudflare's Git integration, deploys on push); (b) `npm run deploy` from your machine | (a), with manual deploys as a fallback. |
| D5 | Old Vercel URL after cutover | (a) keep a redirect + service-worker kill switch on Vercel; (b) delete the project | (a), for at least a few months, so shared links and installed PWAs still lead somewhere. |

---

## 5. Prerequisites

- [ ] **Node 22.12 or newer.** Current `wrangler` (4.165) needs `>=22.12.0` and this machine has **v20.18.0**. Install Node 24 LTS or 22 LTS (nvm-windows, fnm or the installer). Add an `.nvmrc` containing `22` so Cloudflare's build uses the same major version.
- [ ] **Vite 6.1 or newer.** `@cloudflare/vite-plugin` 1.70 supports Vite `^6.1 || ^7 || ^8`; the project is on 5.4 (Phase 1).
- [ ] **Cloudflare account** (free), then `npx wrangler login`.
- [ ] **Supabase restored and reachable**, so the data can be exported. Paused projects can be restored from the dashboard for up to a year. Merge the ping workflow so it stays awake until the end of Phase 9.

---

## 6. Phases

Each phase ends in a working app, so you can stop between any two.

### Phase 0: Fix the service worker on the current stack (small)

**Goal:** make sure browsers pick up new deploys. Without this, cutover users stay on the old build.

**Status:** step 1 done in code on 2026-11-20. `src/main.jsx` now also registers the worker only in production builds, and removes a leftover one under `npm run dev`. Next: steps 2 and 3.

1. Update `public/sw.js`:
   - skip non-GET requests, cross-origin requests and `/api/*` (never cache the API);
   - fetch **network-first** for page loads (`request.mode === 'navigate'`) and fall back to the cached shell when offline;
   - keep cache-first for static files (Vite hashes their names, so that's safe);
   - bump `CACHE_NAME` to `bin-there-v2` so `activate` deletes the old cache.

   ```js
   const CACHE_NAME = 'bin-there-v2';
   // APP_SHELL_ASSETS, install and activate handlers stay as they are.

   self.addEventListener('fetch', (event) => {
     const { request } = event;
     const url = new URL(request.url);

     if (
       request.method !== 'GET' ||
       url.origin !== self.location.origin ||
       url.pathname.startsWith('/api/')
     ) {
       return; // let the browser handle it normally
     }

     if (request.mode === 'navigate') {
       event.respondWith(
         fetch(request)
           .then((response) => {
             if (response.ok) {
               const copy = response.clone();
               caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
             }
             return response;
           })
           .catch(() => caches.match('/'))
       );
       return;
     }

     event.respondWith(
       caches.match(request).then(
         (cached) =>
           cached ||
           fetch(request).then((response) => {
             if (response.ok) {
               const copy = response.clone();
               caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
             }
             return response;
           })
       )
     );
   });
   ```

2. Deploy to Vercel as usual.
3. **Wait a few days** before cutover. Browsers check `sw.js` for changes on each visit, so regular users switch to the fixed worker on their next visit or two.

**Done when:** in DevTools > Application > Service workers, the active worker is the new one; deploying a small visible change appears after one reload.

### Phase 1: Toolchain upgrade (small)

**Goal:** Node 22+ and Vite 6.1+, with no behavior change. Do this on its own so any break is easy to trace.

1. Install Node 22.12+ and add `.nvmrc` (`22`).
2. `npm install -D vite@7 @vitejs/plugin-react@latest`. Check the peer-dependency warnings; plugin-react must support the Vite major you pick.
3. `npm run dev` and `npm run build` must both pass; click through the app.
4. Deploy to Vercel once and make sure the Vercel build passes (set the project's Node version to 22 in Vercel settings if needed).

**Done when:** the live Vercel site runs on the upgraded toolchain and nothing changed for users.

### Phase 2: Cloudflare scaffolding (small)

1. Install the tools:
   ```bash
   npm install -D wrangler @cloudflare/vite-plugin
   npx wrangler login
   npx wrangler d1 create bin-there-db      # copy the printed database_id
   ```
2. Add `wrangler.jsonc` at the repo root:
   ```jsonc
   {
     "$schema": "./node_modules/wrangler/config-schema.json",
     "name": "bin-there",
     "main": "./worker/index.js",
     "compatibility_date": "2026-11-19", // the day you start
     "assets": {
       "not_found_handling": "single-page-application",
       "run_worker_first": ["/api/*"]
     },
     "d1_databases": [
       {
         "binding": "DB",
         "database_name": "bin-there-db",
         "database_id": "<paste from wrangler d1 create>",
         "migrations_dir": "migrations"
       }
     ],
     "observability": { "enabled": true }
   }
   ```
   - `run_worker_first: ["/api/*"]` sends API calls to the Worker even when a browser navigates to them directly (needs Vite plugin 1.7+ / Wrangler 4.20+).
   - `database_id` isn't a secret, so it can be committed.
3. Update `vite.config.js`:
   ```js
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import { cloudflare } from '@cloudflare/vite-plugin';

   export default defineConfig({
     plugins: [react(), cloudflare()],
   });
   ```
4. Add to `.gitignore`: `.wrangler`, `.dev.vars*`, `migration-data/`.
5. Add scripts to `package.json`:
   ```json
   "deploy": "npm run build && wrangler deploy",
   "db:migrate:local": "wrangler d1 migrations apply bin-there-db --local",
   "db:migrate:remote": "wrangler d1 migrations apply bin-there-db --remote"
   ```
6. Create a stub `worker/index.js` that answers `GET /api/health` with `{ "ok": true }`.

**Done when:** `npm run dev` serves the map and `http://localhost:5173/api/health` returns `{"ok":true}`. The build output now goes to `dist/client` (site) and a separate Worker folder; `npx wrangler deploy` reads the generated config automatically.

### Phase 3: Database schema (small)

1. `npx wrangler d1 migrations create bin-there-db init` creates `migrations/0001_init.sql`. Fill it with:
   ```sql
   CREATE TABLE bins (
     id          TEXT PRIMARY KEY,
     latitude    REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
     longitude   REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
     bin_type    TEXT NOT NULL DEFAULT 'public' CHECK (bin_type IN ('public', 'private')),
     title       TEXT,
     description TEXT,
     created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );
   CREATE INDEX bins_created_at_idx ON bins (created_at DESC);

   CREATE TABLE app_feedback (
     id         TEXT PRIMARY KEY,
     name       TEXT,
     feedback   TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );
   CREATE INDEX app_feedback_created_at_idx ON app_feedback (created_at DESC);
   ```
2. Postgres to SQLite (D1) translation:

   | Postgres | D1 | Note |
   |---|---|---|
   | `uuid` + `gen_random_uuid()` | `TEXT`, generated in the Worker | `crypto.randomUUID()` |
   | `double precision` | `REAL` | same 64-bit float |
   | `timestamptz` | `TEXT` ISO-8601 UTC (`2026-11-19T10:00:00.000Z`) | sorts correctly as text; same format as `toISOString()` |
   | RLS policies | Worker route logic | there is no anon role; the Worker is the only client |

   Length limits stay in the Worker, not in `CHECK`s, so an old long row can't break the import.
3. `npm run db:migrate:local`, then `npm run db:migrate:remote`.

**Done when:** `npx wrangler d1 execute bin-there-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` lists `bins` and `app_feedback` (plus D1's internal tables).

### Phase 4: Worker API (medium)

**API contract.** The JSON shapes match today's Supabase rows, so the map rendering code doesn't change.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/bins` | none | `200` array of bins, newest first | `500` |
| POST | `/api/bins` | `{ latitude, longitude, bin_type?, title?, description? }` | `201` the created bin | `400` validation, `413` too large |
| PATCH | `/api/bins/:id` | `{ latitude, longitude, bin_type, title?, description? }` | `200` the updated bin | `400`, `404` already gone, `413` |
| DELETE | `/api/bins/:id` | none | `204` | `404` already gone |
| POST | `/api/feedback` | `{ name?, feedback }` | `201 { ok: true }` | `400`, `413` |
| GET | `/api/health` | none | `200 { ok: true }` | none |

Every error has the shape `{ "error": { "message": "..." } }`, and every response sends `Cache-Control: no-store`.

**Validation rules:** latitude must be a number from -90 to 90 and longitude from -180 to 180; `bin_type` must be `public` or `private` (default `public`); text is trimmed and an empty string becomes `null`; title is at most 80 characters, description 500, name 80, and feedback 1 to 2,000; the request body is at most 10 KB.

**Delete and edit parity.** On Supabase, `delete_bin()` allows at most 30 deletes an hour and copies each deleted bin to `deleted_bins`, and `update_bin()` allows 60 edits an hour and copies the old version to `bin_edits`. The `deleteBin` below does neither, and the starting point has no `PATCH` handler yet. Add one that validates like `createBin` and runs `UPDATE bins SET ... WHERE id = ?` (`404` when `meta.changes === 0`). To keep the protections, add `deleted_bins` and `bin_edits` tables in Phase 3 and do the same count and copy here; otherwise accept losing them until Phase 8.

**`worker/index.js` starting point:**

```js
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const BIN_TYPES = new Set(['public', 'private']);
const MAX_BODY_BYTES = 10_000;
const UUID_PATH = /^\/api\/bins\/([0-9a-f-]{36})$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: HEADERS });

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function text(value, field, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return trimmed || null;
}

function coordinate(value, field, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new HttpError(400, `${field} must be a number between -${limit} and ${limit}.`);
  }
  return value;
}

async function listBins(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, latitude, longitude, bin_type, title, description, created_at
       FROM bins ORDER BY created_at DESC`
  ).all();
  return json(results);
}

async function createBin(request, env) {
  const body = await readBody(request);
  const binType = body.bin_type ?? 'public';
  if (!BIN_TYPES.has(binType)) throw new HttpError(400, "bin_type must be 'public' or 'private'.");

  const bin = {
    id: crypto.randomUUID(),
    latitude: coordinate(body.latitude, 'latitude', 90),
    longitude: coordinate(body.longitude, 'longitude', 180),
    bin_type: binType,
    title: text(body.title, 'title', 80),
    description: text(body.description, 'description', 500),
    created_at: new Date().toISOString(),
  };

  await env.DB.prepare(
    `INSERT INTO bins (id, latitude, longitude, bin_type, title, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(bin.id, bin.latitude, bin.longitude, bin.bin_type, bin.title, bin.description, bin.created_at)
    .run();

  return json(bin, 201);
}

async function deleteBin(id, env) {
  const { meta } = await env.DB.prepare('DELETE FROM bins WHERE id = ?').bind(id).run();
  if (meta.changes === 0) throw new HttpError(404, 'That bin was already removed.');
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

async function createFeedback(request, env) {
  const body = await readBody(request);
  const feedback = text(body.feedback, 'feedback', 2000);
  if (!feedback) throw new HttpError(400, 'Feedback cannot be empty.');

  await env.DB.prepare(
    'INSERT INTO app_feedback (id, name, feedback, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), text(body.name, 'name', 80), feedback, new Date().toISOString())
    .run();

  return json({ ok: true }, 201);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const { method } = request;

    try {
      if (pathname === '/api/bins' && method === 'GET') return await listBins(env);
      if (pathname === '/api/bins' && method === 'POST') return await createBin(request, env);

      const binMatch = pathname.match(UUID_PATH);
      if (binMatch && method === 'DELETE') return await deleteBin(binMatch[1], env);

      if (pathname === '/api/feedback' && method === 'POST') return await createFeedback(request, env);
      if (pathname === '/api/health') return json({ ok: true });

      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { message: error.message } }, error.status);
      }
      console.error(error);
      return json({ error: { message: 'Something went wrong on the server. Please try again.' } }, 500);
    }
  },
};
```

**Done when:** with `npm run dev` running, the API answers correctly when tested with `curl` or the browser:
- `GET /api/bins` returns `[]`;
- `POST` a bin, then `GET` shows it;
- `DELETE` it returns 204, and a second `DELETE` returns 404;
- a bad latitude returns 400 with a readable message;
- `POST /api/feedback` stores a row.

### Phase 5: Frontend switch (medium)

1. Add `src/lib/api.js`. It returns the same `{ data, error }` shape the component already handles:
   ```js
   async function request(path, { body, ...options } = {}) {
     try {
       const response = await fetch(path, {
         ...options,
         headers: body ? { 'content-type': 'application/json' } : undefined,
         body: body ? JSON.stringify(body) : undefined,
       });

       if (response.status === 204) return { data: null, error: null };

       const payload = await response.json().catch(() => null);
       if (!response.ok) {
         return {
           data: null,
           error: {
             status: response.status,
             message: payload?.error?.message || `Request failed (HTTP ${response.status}).`,
           },
         };
       }
       return { data: payload, error: null };
     } catch {
       return {
         data: null,
         error: { status: 0, message: 'Could not reach the server. Check your connection and try again.' },
       };
     }
   }

   export const listBins = () => request('/api/bins');
   export const createBin = (bin) => request('/api/bins', { method: 'POST', body: bin });
   export const deleteBin = (id) => request(`/api/bins/${encodeURIComponent(id)}`, { method: 'DELETE' });
   export const sendFeedback = (entry) => request('/api/feedback', { method: 'POST', body: entry });
   ```
2. Edit `src/components/BinMap.jsx`:
   - **Imports:** import `{ listBins, createBin, updateBin, deleteBin, sendFeedback }` from `../lib/api` instead of Supabase.
   - **Error helpers:** delete `getMissingFunctionMessage`, `getSupabaseErrorMessage`, `getMissingBinColumn`, `getDeleteErrorMessage`, `getEditErrorMessage` and `getFeedbackErrorMessage`. Use `error.message` (already user-friendly) with the existing fallback text.
   - **`buildBinPayload`:** simplify it (the `includeBinType` / `includeOptionalFields` options only existed for the legacy fallback).
   - **Remove the `isSupabaseConfigured` guards** in `loadBins`, `markNewBin`, `handleDeleteBin` and `handleFeedbackSubmit`. With a same-origin API there's no config to miss.
   - **`loadBins`:** `const { data, error } = await listBins();` and delete `fetchAllBins`; the Worker returns every row in one response.
   - **`handleSaveDraftBin`:** `const { data, error } = await createBin(buildBinPayload(draftBin));` and drop the legacy-insert block.
   - **`saveBinChanges`:** `const { data, error } = await updateBin(draft.id, { latitude, longitude, bin_type, title, description });` (add `updateBin` to `src/lib/api.js` as a `PATCH`). Treat `error.status === 404` the way an empty result is handled now.
   - **`handleDeleteBin`:** replace the `supabase.rpc('delete_bin', ...)` call with `const { error } = await deleteBin(binId);`. Treat `error.status === 404` the way `wasDeleted === false` is handled now: remove the bin from the list and show "This bin had already been removed."
   - **`handleFeedbackSubmit`:** `await sendFeedback({ name: ..., feedback: ... })`.
   - **Rendering (the `bins.map(...)` markers and popups) stays the same**, because the field names (`id`, `latitude`, `longitude`, `bin_type`, `title`, `description`) are unchanged.
3. Remove Supabase from the frontend: delete `src/lib/supabase.js`, run `npm uninstall @supabase/supabase-js`, and remove both vars from `.env.example` (delete the file if nothing is left).
4. Keep `supabase/schema.sql` until Phase 9 as a record of the old setup.

**Done when:** every item in the local test checklist (section 7) passes under `npm run dev`, then again under `npm run build && npx vite preview`, which runs the build in the real Workers runtime.

### Phase 6: Data migration (small)

1. **Export from Supabase.** In the Supabase SQL Editor run each query and save the single JSON result to a file:
   ```sql
   select json_agg(b order by created_at) from public.bins b;          -- save as migration-data/bins.json
   select json_agg(f order by created_at) from public.app_feedback f;  -- save as migration-data/feedback.json
   ```
   Also record `select count(*) from public.bins;` and the same for `app_feedback`, plus the export time. `migration-data/` is gitignored because feedback can contain names.
2. **Convert to D1 SQL** with a small script, `scripts/supabase-json-to-d1.mjs`. It writes the file itself, because PowerShell `>` can add a BOM that breaks the import:
   ```js
   // node scripts/supabase-json-to-d1.mjs migration-data/bins.json migration-data/feedback.json migration-data/import.sql
   import { readFileSync, writeFileSync } from 'node:fs';

   const [binsFile, feedbackFile, outFile] = process.argv.slice(2);
   const load = (file) => JSON.parse(readFileSync(file, 'utf8')) ?? [];
   const iso = (value) => new Date(value).toISOString();

   function sql(value) {
     if (value === null || value === undefined) return 'NULL';
     if (typeof value === 'number') {
       if (!Number.isFinite(value)) throw new Error(`Bad number: ${value}`);
       return String(value);
     }
     return `'${String(value).replaceAll("'", "''")}'`;
   }

   const lines = [];
   for (const b of load(binsFile)) {
     const values = [b.id, b.latitude, b.longitude, b.bin_type === 'private' ? 'private' : 'public',
       b.title, b.description, iso(b.created_at)];
     lines.push(`INSERT OR IGNORE INTO bins (id, latitude, longitude, bin_type, title, description, created_at) VALUES (${values.map(sql).join(', ')});`);
   }
   for (const f of load(feedbackFile)) {
     const values = [f.id, f.name, f.feedback, iso(f.created_at)];
     lines.push(`INSERT OR IGNORE INTO app_feedback (id, name, feedback, created_at) VALUES (${values.map(sql).join(', ')});`);
   }

   writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
   console.log(`Wrote ${lines.length} statements to ${outFile}`);
   ```
   - `INSERT OR IGNORE` makes re-running safe: a later re-export only adds rows that are new.
   - Don't add `BEGIN` / `COMMIT`; D1 rejects explicit transactions in imported files.
3. **Rehearse locally:** run `npx wrangler d1 execute bin-there-db --local --file=migration-data/import.sql`, open `npm run dev`, and check that the map looks the same as production.
4. **Verify counts** (local now, remote at cutover):
   ```bash
   npx wrangler d1 execute bin-there-db --local --command "SELECT (SELECT count(*) FROM bins) AS bins, (SELECT count(*) FROM app_feedback) AS feedback, (SELECT max(created_at) FROM bins) AS newest"
   ```

**Done when:** the local counts match the Supabase counts and a few spot-checked bins match field for field.

### Phase 7: Deploy and cutover (medium)

**7a. First deploy, before any users see it**

1. In the Cloudflare dashboard go to Workers & Pages > Create > Import a repository and pick this repo. Use build command `npm run build` and deploy command `npx wrangler deploy`, and add the build variable `NODE_VERSION=22`. Non-production branches get preview URLs. (Fallback: `npm run deploy` from your machine.)
2. Open `https://bin-there.<subdomain>.workers.dev`. It runs against the **remote** D1, which is still empty or holds test data.
3. Run the remote test checklist (section 7) on desktop, Android Chrome and iPhone Safari. Delete any test bins afterwards.

**7b. Cutover runbook (about 1 hour, at a quiet time)**

1. **Final export** from Supabase (Phase 6 step 1) and write down the export time.
2. **Import to remote:** `npx wrangler d1 execute bin-there-db --remote --file=migration-data/import.sql`.
3. **Verify** the remote counts match Supabase (Phase 6 step 4 with `--remote`) and that the workers.dev site shows every bin.
4. **Point users at the new site:**
   - **Custom domain** (DNS must be on Cloudflare): add it under the Worker's Settings > Domains & Routes and remove it from Vercel. The origin stays the same, so installed PWAs keep working.
   - **`*.vercel.app` URL:** switch the Vercel project to a small redirect site. Add a `legacy-vercel/` folder and set it as the Vercel project's Root Directory (framework "Other", no build command):
     - `legacy-vercel/vercel.json` redirects everything **except `/sw.js`**. Browsers reject a redirected service-worker script, so the kill switch below has to be served directly.
       ```json
       {
         "redirects": [
           {
             "source": "/:path((?!sw\\.js$).*)",
             "destination": "https://bin-there.<subdomain>.workers.dev/:path",
             "permanent": false
           }
         ]
       }
       ```
     - `legacy-vercel/sw.js`: a kill switch that clears caches, unregisters the old worker and reloads the page, which then hits the redirect.
       ```js
       self.addEventListener('install', () => self.skipWaiting());
       self.addEventListener('activate', (event) => {
         event.waitUntil((async () => {
           const keys = await caches.keys();
           await Promise.all(keys.map((key) => caches.delete(key)));
           await self.registration.unregister();
           const windows = await self.clients.matchAll({ type: 'window' });
           windows.forEach((client) => client.navigate(client.url));
         })());
       });
       ```
     - Test the redirect on a Vercel **preview** deployment before promoting it to production.
     - People who installed the PWA from the vercel.app URL will need to reinstall from the new URL. Changing the origin always requires this.
5. **Delta check after 24 to 48 hours:** in Supabase run `select count(*) from bins where created_at > '<export time>'` (same for feedback). If anything is there (written by an old cached client), re-export and re-import. `INSERT OR IGNORE` skips rows already copied.

**Done when:** the old URL lands on the new site, new bins appear in D1, and the delta check finds nothing new in Supabase.

### Phase 8: Hardening after cutover (optional, recommended)

Pick these up one at a time once the move has settled.

1. **Delete protection (decision D2 → b).**
   - Add a migration with a `delete_token_hash TEXT` column on `bins`.
   - `POST /api/bins` generates a random token, stores its SHA-256 hash and returns the token once. The app keeps it in `localStorage` keyed by bin id.
   - `DELETE` requires header `X-Delete-Token` whose hash matches the stored one, **or** `Authorization: Bearer <ADMIN_TOKEN>`.
   - Set the admin token with `npx wrangler secret put ADMIN_TOKEN`; use `.dev.vars` locally.
   - Imported bins have no token, so only the admin key can delete them.
   - The UI shows the delete button only for bins this browser created, plus a "report as missing" link for the rest. That link could later write to `app_feedback`.
2. **Bot protection:** add Cloudflare Turnstile (free) to the add-bin and feedback forms and verify the token in the Worker.
3. **Rate limiting:** cap creates per IP per minute. Check which Cloudflare rate-limiting options the free plan includes at the time.
4. **Scale the bin list only if needed:** add `GET /api/bins?bbox=minLng,minLat,maxLng,maxLat` with an index on `(latitude, longitude)`, so each page load reads only the bins in view instead of the whole table.

### Phase 9: Clean up (small, 2 to 4 weeks after a quiet cutover)

- [ ] Download a final Supabase backup (Database > Backups, or `pg_dump`), then delete the Supabase project.
- [ ] Delete `.github/workflows/keep-supabase-awake.yml` and its two repo secrets.
- [ ] Delete `supabase/schema.sql` (the schema now lives in `migrations/`).
- [ ] Keep the Vercel redirect project (D5) for a few months, then make the redirect permanent or remove it.
- [ ] Update `README.md`: stack, local setup (`npm run db:migrate:local && npm run dev`), deploy steps, how to read feedback and how to back up.
- [ ] Add a `CHANGELOG.md` entry for the migration.

---

## 7. Test checklist

Run it locally (`npm run dev`, then `npx vite preview`) and again on the deployed workers.dev URL.

**Core flows**
- [ ] Map loads and every existing bin appears with the right color for public/private.
- [ ] Clicking the map opens the draft form; saving a **public** bin with a title and description shows it immediately.
- [ ] Saving a **private** bin with empty title and description shows "Waste bin" / "No description added."
- [ ] Deleting a bin (after the confirm dialog) removes it; a reload confirms it's gone.
- [ ] Deleting a bin already removed in another tab shows a clear message, not a crash.
- [ ] Feedback with and without a name shows the thank-you message, and the row is in D1.
- [ ] "Locate me" works over HTTPS, and the place name updates (Nominatim still reachable).

**Errors and validation**
- [ ] DevTools offline: the app shell still loads from cache, and loading or saving shows the "Could not reach the server" message.
- [ ] `curl -X POST /api/bins` with `latitude: 999` returns 400 with a readable message.
- [ ] An oversized body (>10 KB) returns 413.

**PWA and caching**
- [ ] DevTools > Application > Cache Storage has **no** `/api/` entries.
- [ ] Deploy a visible change; it appears after one reload.
- [ ] Install prompt works (Android/desktop); the iPhone "Add to Home Screen" path works; the installed app opens the new URL.

**Data**
- [ ] Remote D1 counts match the Supabase counts recorded at export.

---

## 8. Rollback

Keep Supabase and the ping workflow running until Phase 9, so rolling back is always possible.

| When | How to roll back |
|---|---|
| Before 7b step 4 | Nothing to undo. Users are still on Vercel + Supabase. |
| After the switch | Set the Vercel Root Directory back to the app (or use Vercel's instant rollback to the previous production deployment), or move the custom domain back to Vercel. Then copy any bins and feedback created in D1 since cutover back to Supabase: `npx wrangler d1 execute bin-there-db --remote --json --command "SELECT * FROM bins WHERE created_at > '<cutover time>'"`, and insert them in the Supabase SQL editor. |
| Bad data or accidental deletes in D1 | D1 Time Travel restores the database to a point in time: `npx wrangler d1 time-travel restore bin-there-db --timestamp=<ISO time>`. The free plan keeps a shorter history than paid (check the current window). |

---

## 9. Running it afterwards

- **Read feedback:** use the Cloudflare dashboard (D1 > bin-there-db > Console), or run
  `npx wrangler d1 execute bin-there-db --remote --command "SELECT created_at, name, feedback FROM app_feedback ORDER BY created_at DESC LIMIT 50"`.
- **Back up:** `npx wrangler d1 export bin-there-db --remote --output=backup-YYYY-MM-DD.sql`, stored somewhere private (not this public repo).
- **Logs:** `npx wrangler tail` for live logs, or the Worker's Observability tab.
- **Schema changes:** run `npx wrangler d1 migrations create bin-there-db <name>`, edit the SQL, run `npm run db:migrate:local`, test, then run `npm run db:migrate:remote` **before** deploying code that depends on it.

---

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Returning users stay on the old cached build and keep writing to Supabase | High without Phase 0 | Phase 0 service-worker fix, the kill-switch `sw.js` on Vercel and the delta check (7b step 5). |
| Node or Vite upgrade breaks the build | Medium | Done alone in Phase 1 and verified on Vercel before any Cloudflare work. |
| Open write/delete API gets abused | Low to medium (same as today) | Phase 8 hardening; Time Travel to undo damage. |
| Daily D1 read limit as the bin count grows | Low for now | Track the bin count; Phase 8 step 4 (map-area query). |
| Installed PWAs on the vercel.app origin | Certain if the URL changes | Redirect + kill switch; reinstall prompt. A custom domain avoids this for future moves. |
| Free-plan terms change | Possible | Recheck the Cloudflare limits pages before starting; the free plan has no overage charges. |

---

## 11. File changes at a glance

| File | Change |
|---|---|
| `public/sw.js` | Rewrite the fetch handler and bump the cache name (Phase 0) |
| `.nvmrc` | New: `22` |
| `package.json` | Upgrade Vite and plugin-react; add `wrangler` and `@cloudflare/vite-plugin`; remove `@supabase/supabase-js`; new scripts |
| `vite.config.js` | Add `cloudflare()` plugin |
| `wrangler.jsonc` | New: Worker, assets and D1 binding config |
| `worker/index.js` | New: API routes |
| `migrations/0001_init.sql` | New: D1 schema |
| `scripts/supabase-json-to-d1.mjs` | New: one-off data conversion |
| `src/lib/api.js` | New: fetch wrapper |
| `src/lib/supabase.js` | Delete |
| `src/components/BinMap.jsx` | Swap the four data calls; remove the Supabase-specific error handling and config guards |
| `.env.example` | Remove the Supabase vars |
| `.gitignore` | Add `.wrangler`, `.dev.vars*`, `migration-data/` |
| `legacy-vercel/vercel.json`, `legacy-vercel/sw.js` | New (only if moving off a vercel.app URL) |
| `README.md`, `CHANGELOG.md` | Update in Phase 9 |
| `.github/workflows/keep-supabase-awake.yml`, `supabase/schema.sql` | Delete in Phase 9 |
