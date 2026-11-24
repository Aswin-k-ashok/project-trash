# Data model

This is the contract between the app and whatever stores its data. The app only talks to [src/lib/data](src/lib/data/index.js); each backend is a provider behind it. Today the only provider is Supabase ([supabaseProvider.js](src/lib/data/supabaseProvider.js), with the schema in [supabase/migrations](supabase/migrations)). A different backend, such as the Cloudflare Worker and D1 database in [CLOUDFLARE_MIGRATION_PLAN.md](CLOUDFLARE_MIGRATION_PLAN.md), only has to meet this contract.

## Records

### Bin

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Set by the backend. |
| `latitude` | number | -90 to 90. |
| `longitude` | number | -180 to 180. |
| `bin_type` | text | `public` or `private`. Default `public`. |
| `title` | text or null | At most 80 characters. Blank is stored as null. |
| `description` | text or null | At most 500 characters. Blank is stored as null. |
| `created_at` | timestamp | Set by the backend. |
| `status` | text | `active` (on the map) or `removed` (removed by votes). |
| `removed_at` | timestamp or null | When votes removed it. |
| `upvotes`, `downvotes` | integer | Totals of the bin's votes, kept in step with them. |

The app sees a bin in camelCase (`binType`, `createdAt`, ...); the provider converts. See the `Bin` type in [src/lib/data/index.js](src/lib/data/index.js).

### Vote

| Field | Type | Rules |
|---|---|---|
| `bin_id` | UUID | The bin. Votes go when their bin is deleted. |
| `voter_id` | UUID | The voter's browser id (below). |
| `vote` | integer | `1` usable, `-1` not usable or missing. |
| `created_at`, `updated_at` | timestamp | |

One vote per bin per voter (`bin_id` + `voter_id` is unique). Votes are private: only the voter can read their own.

### Feedback

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | |
| `name` | text or null | At most 80 characters. |
| `feedback` | text | 1 to 2,000 characters after trimming. |
| `created_at` | timestamp | |

### Archives

Kept for the project owner, never readable by the app: `bin_edits` (each bin's version before an edit) and `deleted_bins` (bins deleted before voting replaced deleting). The comments in the migrations have queries to undo edits and restore bins.

## Operations

Each provider exports these, with the signatures and JSDoc types in [src/lib/data/index.js](src/lib/data/index.js). Every function returns `{ data, error }` and never throws.

| Function | Does | Supabase |
|---|---|---|
| `listBins()` | Every active bin, newest first. | `bins` table, paged 1,000 rows at a time |
| `listMyVotes(voterId)` | The voter's votes on active bins. | `my_votes()` |
| `createBin(input, voterId)` | Adds a bin with the voter's upvote. | `create_bin()` |
| `updateBin(id, input)` | Edits an active bin; null if gone or removed. | `update_bin()` |
| `voteOnBin(id, vote, voterId)` | Sets the voter's vote (1, -1, or 0 to take it back); returns the new totals, the voter's vote, and whether the bin was removed; null if gone or removed. | `vote_on_bin()` |
| `sendFeedback(entry)` | Stores feedback. | `app_feedback` table |

Errors are `{ code, message }`, with a message that can be shown as is. The codes are `not_configured`, `setup` (schema missing), `invalid`, `limited` (rate limit), `network`, `aborted` and `unknown`.

## Rules the backend must enforce

These run on the server, never only in the browser, because anyone can call the API directly.

1. **Input:** the field rules above.
2. **Votes:** one per bin per voter. Voting again replaces the vote; voting 0 takes it back. Totals are recounted from the votes on every vote.
3. **The person who adds a bin** gives it its first upvote.
4. **Removal:** a bin is removed when it has **at least 3 downvotes and 3 more downvotes than upvotes**. It stays stored with `status = 'removed'` and `removed_at` set, but is no longer listed, edited or voted on. Nobody can delete a bin directly.
5. **Limits:** at most 60 votes per voter per hour, 30 removals per hour overall, and 60 edits per hour overall. A refused vote changes nothing.
6. **Two votes on the same bin at once** are counted one after the other (Supabase locks the bin row while voting).

## Voter ids

There are no accounts. Each browser makes a random UUID the first time it votes and keeps it in `localStorage` ([src/lib/voter.js](src/lib/voter.js)). It is not linked to a person.

Anyone can get a new id by clearing site data or using a private window, so one person can vote more than once with effort. The 3-vote threshold, the hourly limits and restorable removals keep that in check for a community app. To make votes harder to fake later, add sign-in, or per-IP limits and a bot check (such as Cloudflare Turnstile) in the backend. The `voter_id` column can then hold an account id instead.

## Adding a provider

1. Create `src/lib/data/<name>Provider.js` exporting `isConfigured` and the six functions above, with the same arguments and return values.
2. Add it to `providers` in [src/lib/data/index.js](src/lib/data/index.js).
3. Set `VITE_DATA_PROVIDER=<name>` in `.env` (default `supabase`).
4. Store the records above and enforce the rules in that backend. For SQLite or Cloudflare D1: UUIDs and timestamps become `TEXT`, and the vote should be one transaction (a D1 `batch`) that writes the vote, recounts and updates the bin.
5. Copy the data across: `bins` (with `status`, `removed_at` and the totals) and `bin_votes`.

## Changing the schema (Supabase)

- Add a new file, `supabase/migrations/NNNN_short_name.sql`, numbered after the last one. Never edit or re-run an older migration: later ones change what earlier ones set up.
- Make it safe to run twice (`if not exists`, `create or replace`, `drop ... if exists`), and end it with an insert into `schema_migrations` and `notify pgrst, 'reload schema';`.
- Update this document, and the provider if the API changed.
