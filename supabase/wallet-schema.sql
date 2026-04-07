-- Run this in Supabase SQL Editor after link-card-schema.sql.
-- Adds wallet pass tracking for Apple/Google virtual cards.

create extension if not exists pgcrypto;

create table if not exists public.wallet_passes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  platform text not null check (platform in ('apple', 'google')),
  status text not null default 'requested',
  serial text,
  wallet_object_id text,
  pass_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_passes_slug_platform_key unique (slug, platform)
);

create index if not exists wallet_passes_profile_idx on public.wallet_passes (profile_id, platform);
create index if not exists wallet_passes_slug_idx on public.wallet_passes (slug);

do $$
begin
  if to_regproc('public.set_updated_at') is null then
    create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    as $f$
    begin
      new.updated_at = now();
      return new;
    end;
    $f$;
  end if;
end $$;

drop trigger if exists wallet_passes_set_updated_at on public.wallet_passes;
create trigger wallet_passes_set_updated_at
before update on public.wallet_passes
for each row
execute function public.set_updated_at();

alter table public.wallet_passes enable row level security;

drop policy if exists "wallet passes owner read" on public.wallet_passes;
create policy "wallet passes owner read"
on public.wallet_passes
for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists "wallet passes owner write" on public.wallet_passes;
create policy "wallet passes owner write"
on public.wallet_passes
for all
to authenticated
using (auth.uid() = profile_id)
with check (auth.uid() = profile_id);

