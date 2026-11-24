// The app's only way to its data. Components call these functions, never a
// database client, so the backend can be swapped by adding a provider with
// the same functions and selecting it with VITE_DATA_PROVIDER.
// DATA_MODEL.md describes the data, the rules each backend must apply, and
// how to add a provider.
import * as supabaseProvider from './supabaseProvider';

/**
 * A bin as the app sees it, whatever the backend calls its fields.
 * @typedef {object} Bin
 * @property {string} id
 * @property {number} latitude
 * @property {number} longitude
 * @property {'public' | 'private'} binType
 * @property {string | null} title
 * @property {string | null} description
 * @property {string} createdAt  ISO 8601 timestamp
 * @property {number} upvotes
 * @property {number} downvotes
 */

/**
 * What a user can set on a bin when adding or editing it.
 * @typedef {object} BinInput
 * @property {number} latitude
 * @property {number} longitude
 * @property {'public' | 'private'} binType
 * @property {string} title        Blank text is stored as no title.
 * @property {string} description  Blank text is stored as no description.
 */

/**
 * The result of a vote.
 * @typedef {object} VoteResult
 * @property {number} upvotes
 * @property {number} downvotes
 * @property {-1 | 0 | 1} myVote   0 when the voter has no vote on the bin.
 * @property {boolean} removed     True when this vote removed the bin.
 */

/**
 * Every function returns { data, error } and never throws. `error` is null on
 * success, or { code, message } where `message` can be shown to users as is
 * and `code` is one of:
 *   not_configured  the backend's settings are missing
 *   setup           the database is missing part of the schema
 *   invalid         the input was refused (for example text too long)
 *   limited         a rate limit was hit; the message says which
 *   network         the backend could not be reached
 *   aborted         the request was cancelled with its AbortSignal
 *   unknown         anything else
 * @template T
 * @typedef {Promise<{ data: T, error: null } | { data: null, error: { code: string, message: string } }>} Result
 */

const providers = {
  supabase: supabaseProvider,
};

const providerName = import.meta.env.VITE_DATA_PROVIDER || 'supabase';
const provider = providers[providerName];

if (!provider) {
  throw new Error(
    `Unknown VITE_DATA_PROVIDER "${providerName}". Available: ${Object.keys(providers).join(', ')}.`
  );
}

/** True when the backend's settings are present. */
export const isConfigured = provider.isConfigured;

/**
 * Every bin on the map (removed bins are left out), newest first.
 * @type {(options?: { signal?: AbortSignal }) => Result<Bin[]>}
 */
export const listBins = provider.listBins;

/**
 * The voter's own votes on bins still on the map, as { [binId]: 1 | -1 }.
 * @type {(voterId: string, options?: { signal?: AbortSignal }) => Result<Record<string, 1 | -1>>}
 */
export const listMyVotes = provider.listMyVotes;

/**
 * Adds a bin. The voter who adds it gives it its first upvote.
 * @type {(input: BinInput, voterId: string) => Result<Bin>}
 */
export const createBin = provider.createBin;

/**
 * Edits a bin. Returns null as data when the bin is gone or removed.
 * @type {(id: string, input: BinInput) => Result<Bin | null>}
 */
export const updateBin = provider.updateBin;

/**
 * Votes on a bin: 1 usable, -1 not usable or missing, 0 take the vote back.
 * Returns null as data when the bin is gone or already removed.
 * @type {(id: string, vote: -1 | 0 | 1, voterId: string) => Result<VoteResult | null>}
 */
export const voteOnBin = provider.voteOnBin;

/**
 * Sends app feedback.
 * @type {(entry: { name: string, feedback: string }) => Result<null>}
 */
export const sendFeedback = provider.sendFeedback;
