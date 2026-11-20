-- Safe to run again: every statement is idempotent, so re-run the whole file
-- after pulling changes.

create extension if not exists pgcrypto;

create table if not exists public.bins (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  bin_type text not null default 'public',
  title text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  name text,
  feedback text not null,
  created_at timestamptz not null default now()
);

-- Every bin deleted through the app is copied here first, so a mistaken or
-- malicious delete can be undone. RLS is on with no policies, so the public
-- anon key cannot read or change this table. To restore the last day's deletes:
--
--   insert into public.bins (id, latitude, longitude, bin_type, title, description, created_at)
--   select distinct on (id) id, latitude, longitude, bin_type, title, description, created_at
--   from public.deleted_bins
--   where deleted_at > now() - interval '1 day'
--   order by id, deleted_at desc
--   on conflict (id) do nothing;
create table if not exists public.deleted_bins (
  deletion_id uuid primary key default gen_random_uuid(),
  id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  bin_type text not null,
  title text,
  description text,
  created_at timestamptz not null,
  deleted_at timestamptz not null default now()
);

-- The version of a bin from before each edit made through the app. Same
-- access rules as deleted_bins. To undo the latest edit of one bin:
--
--   update public.bins b
--   set latitude = e.latitude, longitude = e.longitude, bin_type = e.bin_type,
--       title = e.title, description = e.description
--   from (
--     select * from public.bin_edits
--     where id = '<bin id>'
--     order by edited_at desc
--     limit 1
--   ) e
--   where b.id = e.id;
create table if not exists public.bin_edits (
  edit_id uuid primary key default gen_random_uuid(),
  id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  bin_type text not null,
  title text,
  description text,
  created_at timestamptz not null,
  edited_at timestamptz not null default now()
);

alter table public.bins add column if not exists bin_type text not null default 'public';
alter table public.bins add column if not exists title text;
alter table public.bins add column if not exists description text;

-- Reject bad data sent straight to the public API. The limits match the
-- Worker API in CLOUDFLARE_MIGRATION_PLAN.md. NOT VALID means existing rows
-- are not rechecked, so this cannot fail on old data; new rows are checked.
alter table public.bins drop constraint if exists bins_bin_type_check;
alter table public.bins add constraint bins_bin_type_check
  check (bin_type in ('public', 'private')) not valid;

alter table public.bins drop constraint if exists bins_latitude_check;
alter table public.bins add constraint bins_latitude_check
  check (latitude between -90 and 90) not valid;

alter table public.bins drop constraint if exists bins_longitude_check;
alter table public.bins add constraint bins_longitude_check
  check (longitude between -180 and 180) not valid;

alter table public.bins drop constraint if exists bins_title_length_check;
alter table public.bins add constraint bins_title_length_check
  check (char_length(title) <= 80) not valid;

alter table public.bins drop constraint if exists bins_description_length_check;
alter table public.bins add constraint bins_description_length_check
  check (char_length(description) <= 500) not valid;

alter table public.app_feedback drop constraint if exists app_feedback_name_length_check;
alter table public.app_feedback add constraint app_feedback_name_length_check
  check (char_length(name) <= 80) not valid;

alter table public.app_feedback drop constraint if exists app_feedback_feedback_length_check;
alter table public.app_feedback add constraint app_feedback_feedback_length_check
  check (char_length(btrim(feedback)) between 1 and 2000) not valid;

alter table public.bins enable row level security;
alter table public.app_feedback enable row level security;
alter table public.deleted_bins enable row level security;
alter table public.bin_edits enable row level security;

drop policy if exists "Public can read bins" on public.bins;
drop policy if exists "Public can insert bins" on public.bins;
drop policy if exists "Public can delete bins" on public.bins;
drop policy if exists "Public can insert feedback" on public.app_feedback;

create policy "Public can read bins"
on public.bins
for select
to anon
using (true);

create policy "Public can insert bins"
on public.bins
for insert
to anon
with check (true);

create policy "Public can insert feedback"
on public.app_feedback
for insert
to anon
with check (true);

-- No direct deletes or updates from the public API. With them, one request
-- such as DELETE /rest/v1/bins?id=not.is.null could empty or overwrite the
-- whole table. The app uses delete_bin() and update_bin() below instead.
revoke delete, update on public.bins from anon, authenticated;
revoke all on public.deleted_bins from anon, authenticated;
revoke all on public.bin_edits from anon, authenticated;

-- Anyone can still delete a bin (decision D2 in CLOUDFLARE_MIGRATION_PLAN.md),
-- but only one per call, at most 30 per hour across all visitors, and each one
-- is copied to deleted_bins first.
create or replace function public.delete_bin(bin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.deleted_bins
    where deleted_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'Too many bins were deleted in the last hour. Please try again later.';
  end if;

  with removed as (
    delete from public.bins
    where id = bin_id
    returning *
  )
  insert into public.deleted_bins (id, latitude, longitude, bin_type, title, description, created_at)
  select id, latitude, longitude, bin_type, title, description, created_at
  from removed;

  -- false when the bin was already gone.
  return found;
end;
$$;

revoke all on function public.delete_bin(uuid) from public;
grant execute on function public.delete_bin(uuid) to anon, authenticated;

-- Edits follow the same rules as deletes: anyone can edit a bin, one per
-- call, at most 60 per hour across all visitors, and the old version is
-- copied to bin_edits first. The table's checks still apply to the new values.
-- Returns the updated bin, or no row when the bin no longer exists.
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
  where id = bin_id;

  return query
  with changed as (
    update public.bins
    set
      latitude = new_latitude,
      longitude = new_longitude,
      bin_type = new_bin_type,
      title = nullif(btrim(new_title), ''),
      description = nullif(btrim(new_description), '')
    where id = bin_id
    returning *
  )
  select * from changed;
end;
$$;

revoke all on function public.update_bin(uuid, double precision, double precision, text, text, text) from public;
grant execute on function public.update_bin(uuid, double precision, double precision, text, text, text) to anon, authenticated;

create index if not exists bins_created_at_idx on public.bins (created_at desc);
create index if not exists app_feedback_created_at_idx on public.app_feedback (created_at desc);
create index if not exists deleted_bins_deleted_at_idx on public.deleted_bins (deleted_at desc);
create index if not exists bin_edits_edited_at_idx on public.bin_edits (edited_at desc);

-- Make the API pick up the new function right away.
notify pgrst, 'reload schema';
