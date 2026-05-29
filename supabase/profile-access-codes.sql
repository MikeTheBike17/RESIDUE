create table if not exists public.profile_access_codes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  access_code text not null unique,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.profile_access_codes enable row level security;

drop policy if exists "Allow read access codes" on public.profile_access_codes;
create policy "Allow read access codes"
on public.profile_access_codes
for select
to anon, authenticated
using (true);

drop policy if exists "Allow insert access codes" on public.profile_access_codes;
create policy "Allow insert access codes"
on public.profile_access_codes
for insert
to authenticated
with check (true);

drop policy if exists "Allow update access codes" on public.profile_access_codes;
create policy "Allow update access codes"
on public.profile_access_codes
for update
to authenticated
using (true)
with check (true);
