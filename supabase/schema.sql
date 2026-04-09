create extension if not exists pgcrypto;

create table if not exists public.bins (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  title text,
  description text,
  created_at timestamptz not null default now()
);

alter table public.bins add column if not exists title text;
alter table public.bins add column if not exists description text;

alter table public.bins enable row level security;

drop policy if exists "Public can read bins" on public.bins;
drop policy if exists "Public can insert bins" on public.bins;
drop policy if exists "Public can delete bins" on public.bins;

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

create policy "Public can delete bins"
on public.bins
for delete
to anon
using (true);

create index if not exists bins_created_at_idx on public.bins (created_at desc);
