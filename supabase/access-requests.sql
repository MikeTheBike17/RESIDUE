-- Access request workflow schema
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  intent text not null,
  team_size integer,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_name_len check (char_length(trim(name)) between 2 and 120),
  constraint access_requests_email_len check (char_length(trim(email)) between 5 and 254),
  constraint access_requests_email_format check (position('@' in email) > 1),
  constraint access_requests_intent_len check (char_length(trim(intent)) between 8 and 2000),
  constraint access_requests_team_size_range check (team_size is null or (team_size >= 1 and team_size <= 10000)),
  constraint access_requests_status_check check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists access_requests_status_created_at_idx
  on public.access_requests (status, created_at desc);

create index if not exists access_requests_email_created_at_idx
  on public.access_requests (email, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists access_requests_set_updated_at on public.access_requests;
create trigger access_requests_set_updated_at
before update on public.access_requests
for each row
execute function public.set_updated_at();

create or replace function public.normalize_access_request()
returns trigger
language plpgsql
as $$
begin
  new.name := trim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  new.email := lower(trim(coalesce(new.email, '')));
  new.intent := trim(regexp_replace(coalesce(new.intent, ''), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists access_requests_normalize on public.access_requests;
create trigger access_requests_normalize
before insert or update on public.access_requests
for each row
execute function public.normalize_access_request();

alter table public.access_requests enable row level security;

-- Default deny: no anon policy for direct browser inserts.
revoke all on table public.access_requests from anon, authenticated;
grant select, update on table public.access_requests to authenticated;
grant select, insert, update on table public.access_requests to service_role;

drop policy if exists "access requests manager read" on public.access_requests;
create policy "access requests manager read"
on public.access_requests
for select
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'check.email@residue.com');

drop policy if exists "access requests manager update" on public.access_requests;
create policy "access requests manager update"
on public.access_requests
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'check.email@residue.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'check.email@residue.com');
