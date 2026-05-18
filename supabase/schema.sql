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

alter table public.bins add column if not exists bin_type text not null default 'public';
alter table public.bins add column if not exists title text;
alter table public.bins add column if not exists description text;

alter table public.bins enable row level security;
alter table public.app_feedback enable row level security;

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

create policy "Public can delete bins"
on public.bins
for delete
to anon
using (true);

create policy "Public can insert feedback"
on public.app_feedback
for insert
to anon
with check (true);

create index if not exists bins_created_at_idx on public.bins (created_at desc);
create index if not exists app_feedback_created_at_idx on public.app_feedback (created_at desc);
