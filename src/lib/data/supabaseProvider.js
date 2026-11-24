// Supabase backend for src/lib/data. Tables and functions are defined in
// supabase/migrations; this file only maps them to the app's data contract.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const client = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

// Supabase returns at most 1000 rows per request unless the project says otherwise.
const PAGE_SIZE = 1000;

const NOT_CONFIGURED = {
  data: null,
  error: {
    code: 'not_configured',
    message:
      'The database is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.',
  },
};

// Codes meaning the database lacks a table, column, function or permission
// the app expects: the migrations haven't all been run.
const SETUP_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883', '42501']);
// Input the database refused: a check constraint, a bad value or a bad id.
const INVALID_CODES = new Set(['23514', '23502', '22023', '22P02']);

function toError(error, fallbackMessage) {
  if (/^AbortError/.test(error.message ?? '')) {
    return { code: 'aborted', message: '' };
  }

  if (SETUP_CODES.has(error.code)) {
    return {
      code: 'setup',
      message:
        "The database is missing part of the app's setup. Run the files in supabase/migrations that haven't been run yet (see the README), then refresh.",
    };
  }

  if (INVALID_CODES.has(error.code)) {
    return {
      code: 'invalid',
      message: 'Some of the details were not accepted, for example text that is too long. Please check them and try again.',
    };
  }

  // Rate limits are raised by the database functions with a readable message.
  if (error.code === 'P0001') {
    return { code: 'limited', message: error.message };
  }

  if (!error.code && /fetch|network/i.test(error.message ?? '')) {
    return {
      code: 'network',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }

  console.error('Unexpected database error', error);
  return { code: 'unknown', message: fallbackMessage };
}

function toBin(row) {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    binType: row.bin_type === 'private' ? 'private' : 'public',
    title: row.title ?? null,
    description: row.description ?? null,
    createdAt: row.created_at,
    upvotes: row.upvotes ?? 0,
    downvotes: row.downvotes ?? 0,
  };
}

// Reads every page of a query. `makeQuery` builds a fresh query that asks for
// an exact count, so paging stops at the real total even if the project
// returns fewer rows per page than PAGE_SIZE.
async function readAllPages(makeQuery, signal) {
  const rows = [];

  for (;;) {
    let query = makeQuery().range(rows.length, rows.length + PAGE_SIZE - 1);

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { data, error, count } = await query;

    if (error) {
      return { data: null, error };
    }

    rows.push(...data);

    if (data.length === 0 || (count !== null && rows.length >= count)) {
      return { data: rows, error: null };
    }
  }
}

export async function listBins({ signal } = {}) {
  if (!client) return NOT_CONFIGURED;

  const { data, error } = await readAllPages(
    () =>
      client
        .from('bins')
        .select('*', { count: 'exact' })
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .order('id'),
    signal
  );

  if (error) {
    return { data: null, error: toError(error, 'Could not load bins. Please try again.') };
  }

  return { data: data.map(toBin), error: null };
}

export async function listMyVotes(voterId, { signal } = {}) {
  if (!client) return NOT_CONFIGURED;

  const { data, error } = await readAllPages(
    () => client.rpc('my_votes', { voter: voterId }, { count: 'exact' }),
    signal
  );

  if (error) {
    return { data: null, error: toError(error, 'Could not load your votes.') };
  }

  return {
    data: Object.fromEntries(data.map((row) => [row.bin_id, row.vote])),
    error: null,
  };
}

export async function createBin(input, voterId) {
  if (!client) return NOT_CONFIGURED;

  const { data, error } = await client.rpc('create_bin', {
    new_latitude: input.latitude,
    new_longitude: input.longitude,
    new_bin_type: input.binType,
    new_title: input.title,
    new_description: input.description,
    voter: voterId,
  });

  if (error) {
    return { data: null, error: toError(error, 'Could not save the new bin. Please try again.') };
  }

  return { data: toBin(data[0]), error: null };
}

export async function updateBin(id, input) {
  if (!client) return NOT_CONFIGURED;

  const { data, error } = await client.rpc('update_bin', {
    bin_id: id,
    new_latitude: input.latitude,
    new_longitude: input.longitude,
    new_bin_type: input.binType,
    new_title: input.title,
    new_description: input.description,
  });

  if (error) {
    return { data: null, error: toError(error, 'Could not save your changes. Please try again.') };
  }

  return { data: data[0] ? toBin(data[0]) : null, error: null };
}

export async function voteOnBin(id, vote, voterId) {
  if (!client) return NOT_CONFIGURED;

  const { data, error } = await client.rpc('vote_on_bin', {
    target_bin_id: id,
    voter: voterId,
    vote_value: vote,
  });

  if (error) {
    return { data: null, error: toError(error, 'Could not save your vote. Please try again.') };
  }

  const row = data[0];

  if (!row) {
    return { data: null, error: null };
  }

  return {
    data: {
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      myVote: row.my_vote ?? 0,
      removed: row.status === 'removed',
    },
    error: null,
  };
}

export async function sendFeedback({ name, feedback }) {
  if (!client) return NOT_CONFIGURED;

  const { error } = await client.from('app_feedback').insert({
    name: name.trim() || null,
    feedback: feedback.trim(),
  });

  if (error) {
    return { data: null, error: toError(error, 'Could not send your feedback right now.') };
  }

  return { data: null, error: null };
}
