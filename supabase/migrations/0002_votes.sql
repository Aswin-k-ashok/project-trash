-- 0002_votes: people vote on whether a bin is usable, and bins are removed
-- by votes instead of being deleted.
--
-- Rules (keep in step with DATA_MODEL.md):
--   * One vote per bin per voter. A voter is a random id made by each browser
--     (no accounts); voting again changes the vote, voting 0 takes it back.
--   * Whoever adds a bin gives it the first upvote.
--   * A bin is removed once it has at least 3 downvotes and 3 more downvotes
--     than upvotes. Removed bins stay in the table with status 'removed'.
--   * At most 60 votes per voter and 30 removals overall per hour.
--   * Nobody can delete a bin directly any more.
--
-- Run once, after 0001. Safe to re-run.
--
-- To see what votes removed:
--
--   select id, title, upvotes, downvotes, removed_at
--   from public.bins where status = 'removed' order by removed_at desc;
--
-- To put one back on the map, dropping the downvotes that removed it:
--
--   delete from public.bin_votes where bin_id = '<bin id>' and vote = -1;
--   update public.bins set status = 'active', removed_at = null, downvotes = 0
--   where id = '<bin id>';

-- Which migrations have run on this project: select * from public.schema_migrations;
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

-- 0002 needs 0001, so 0001 has run too.
insert into public.schema_migrations (version) values ('0001_initial')
on conflict (version) do nothing;

-- ---------- Bins: status and vote counts ----------

alter table public.bins add column if not exists status text not null default 'active';
alter table public.bins add column if not exists removed_at timestamptz;
-- Kept in step with bin_votes by vote_on_bin(), so listing bins needs no join.
alter table public.bins add column if not exists upvotes integer not null default 0;
alter table public.bins add column if not exists downvotes integer not null default 0;

alter table public.bins drop constraint if exists bins_status_check;
alter table public.bins add constraint bins_status_check
  check (status in ('active', 'removed'));

-- ---------- Votes ----------

create table if not exists public.bin_votes (
  bin_id uuid not null references public.bins (id) on delete cascade,
  voter_id uuid not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bin_id, voter_id)
);

-- Votes are private: the app reads a voter's own votes through my_votes().
alter table public.bin_votes enable row level security;
revoke all on public.bin_votes from anon, authenticated;

-- ---------- Access ----------

-- The public API lists only bins on the map.
drop policy if exists "Public can read bins" on public.bins;
drop policy if exists "Public can read active bins" on public.bins;

create policy "Public can read active bins"
on public.bins
for select
to anon
using (status = 'active');

-- Every change goes through the functions below, which apply the rules.
drop policy if exists "Public can insert bins" on public.bins;
revoke insert, update, delete on public.bins from anon, authenticated;

-- Removing a bin is now done by votes. Past deletions stay in deleted_bins.
drop function if exists public.delete_bin(uuid);

-- ---------- Functions ----------

-- Adds a bin and gives it its first upvote from the voter who added it.
-- The table's checks apply to the values.
create or replace function public.create_bin(
  new_latitude double precision,
  new_longitude double precision,
  new_bin_type text,
  new_title text,
  new_description text,
  voter uuid
)
returns setof public.bins
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.bins;
begin
  insert into public.bins (latitude, longitude, bin_type, title, description, upvotes)
  values (
    new_latitude,
    new_longitude,
    coalesce(new_bin_type, 'public'),
    nullif(btrim(new_title), ''),
    nullif(btrim(new_description), ''),
    case when voter is null then 0 else 1 end
  )
  returning * into created;

  if voter is not null then
    insert into public.bin_votes (bin_id, voter_id, vote)
    values (created.id, voter, 1);
  end if;

  return next created;
end;
$$;

revoke all on function public.create_bin(double precision, double precision, text, text, text, uuid) from public;
grant execute on function public.create_bin(double precision, double precision, text, text, text, uuid) to anon, authenticated;

-- Same as in 0001, except that only bins still on the map can be edited.
-- Returns the updated bin, or no row when it is gone or removed.
create or replace function public.update_bin(
  bin_id uuid,
  new_latitude double precision,
  new_longitude double precision,
  new_bin_type text,
  new_title text,
  new_description text
)
returns setof public.bins
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.bin_edits
    where edited_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'Too many bins were edited in the last hour. Please try again later.';
  end if;

  insert into public.bin_edits (id, latitude, longitude, bin_type, title, description, created_at)
  select id, latitude, longitude, bin_type, title, description, created_at
  from public.bins
  where id = bin_id and status = 'active';

  return query
  with changed as (
    update public.bins
    set
      latitude = new_latitude,
      longitude = new_longitude,
      bin_type = new_bin_type,
      title = nullif(btrim(new_title), ''),
      description = nullif(btrim(new_description), '')
    where id = bin_id and status = 'active'
    returning *
  )
  select * from changed;
end;
$$;

revoke all on function public.update_bin(uuid, double precision, double precision, text, text, text) from public;
grant execute on function public.update_bin(uuid, double precision, double precision, text, text, text) to anon, authenticated;

-- Records a voter's vote on a bin: 1 (usable), -1 (not usable or missing) or
-- 0 (take the vote back). Returns the bin's new totals, the voter's vote
-- (null when none) and the bin's status, which is 'removed' when this vote
-- removed it. Returns no row when the bin is gone or already removed.
create or replace function public.vote_on_bin(
  target_bin_id uuid,
  voter uuid,
  vote_value integer
)
returns table (upvotes integer, downvotes integer, my_vote integer, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bin_status text;
  up_count integer;
  down_count integer;
begin
  if vote_value is null or vote_value not in (-1, 0, 1) then
    raise exception 'A vote must be -1, 0 or 1.' using errcode = '22023';
  end if;

  if voter is null then
    raise exception 'A voter id is required.' using errcode = '22023';
  end if;

  -- Lock the bin, so two votes on it at the same moment are counted in turn.
  select b.status into bin_status
  from public.bins b
  where b.id = target_bin_id
  for update;

  if not found or bin_status <> 'active' then
    return;
  end if;

  if (
    select count(*)
    from public.bin_votes v
    where v.voter_id = voter and v.updated_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'Too many votes from this device in the last hour. Please try again later.';
  end if;

  if vote_value = 0 then
    delete from public.bin_votes v
    where v.bin_id = target_bin_id and v.voter_id = voter;
  else
    insert into public.bin_votes (bin_id, voter_id, vote)
    values (target_bin_id, voter, vote_value)
    on conflict (bin_id, voter_id)
    do update set vote = excluded.vote, updated_at = now();
  end if;

  -- Counted afresh each time, so the totals can't drift from the votes.
  select
    count(*) filter (where v.vote = 1),
    count(*) filter (where v.vote = -1)
  into up_count, down_count
  from public.bin_votes v
  where v.bin_id = target_bin_id;

  if down_count >= 3 and down_count - up_count >= 3 then
    if (
      select count(*)
      from public.bins b
      where b.removed_at > now() - interval '1 hour'
    ) >= 30 then
      raise exception 'Too many bins were removed in the last hour. Please try again later.';
    end if;

    bin_status := 'removed';
  end if;

  update public.bins b
  set
    upvotes = up_count,
    downvotes = down_count,
    status = bin_status,
    removed_at = case when bin_status = 'removed' then now() else null end
  where b.id = target_bin_id;

  return query select up_count, down_count, nullif(vote_value, 0), bin_status;
end;
$$;

revoke all on function public.vote_on_bin(uuid, uuid, integer) from public;
grant execute on function public.vote_on_bin(uuid, uuid, integer) to anon, authenticated;

-- A voter's own votes on bins still on the map, so the app can show them.
create or replace function public.my_votes(voter uuid)
returns table (bin_id uuid, vote integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.bin_id, v.vote::integer
  from public.bin_votes v
  join public.bins b on b.id = v.bin_id
  where v.voter_id = voter and b.status = 'active'
  order by v.bin_id;
$$;

revoke all on function public.my_votes(uuid) from public;
grant execute on function public.my_votes(uuid) to anon, authenticated;

-- ---------- Indexes ----------

create index if not exists bin_votes_voter_idx on public.bin_votes (voter_id, updated_at desc);
create index if not exists bins_removed_at_idx on public.bins (removed_at desc) where removed_at is not null;

insert into public.schema_migrations (version) values ('0002_votes')
on conflict (version) do nothing;

-- Make the API pick up the changes right away.
notify pgrst, 'reload schema';
