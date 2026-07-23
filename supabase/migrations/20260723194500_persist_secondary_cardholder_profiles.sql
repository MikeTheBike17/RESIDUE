-- Persist secondary cardholders as real public.profiles rows even when the
-- Supabase Auth service cannot create a login identity for the email.

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%references auth.users%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_constraint.conname);
  end loop;
end $$;

create or replace function public.ensure_secondary_cardholder_profile(
  p_email text,
  p_display_name text default null,
  p_preferred_slug text default null
)
returns table (profile_id uuid, auth_email text, name text, slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_reserved_slug text;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
  v_id uuid;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;

  select p.id into v_id from public.profiles p
  where lower(p.auth_email) = v_email order by p.created_at asc limit 1;
  if v_id is not null then
    return query select p.id, p.auth_email, p.name, p.slug
    from public.profiles p where p.id = v_id;
    return;
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), split_part(v_email, '@', 1), 'Residue User');
  select cpu.profile_slug into v_reserved_slug
  from public.cardholder_profile_urls cpu where cpu.card_email = v_email limit 1;
  v_base_slug := regexp_replace(
    lower(coalesce(v_reserved_slug, nullif(trim(p_preferred_slug), ''), split_part(v_email, '@', 1))),
    '[^a-z0-9]+', '-', 'g'
  );
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  if v_base_slug = '' then v_base_slug := 'cardholder'; end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.profiles p where p.slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  insert into public.profiles (id, auth_email, name, slug, theme)
  values (gen_random_uuid(), v_email, v_name, v_slug, 'light')
  returning id into v_id;

  return query select p.id, p.auth_email, p.name, p.slug
  from public.profiles p where p.id = v_id;
end;
$$;

revoke all on function public.ensure_secondary_cardholder_profile(text, text, text) from public;
revoke all on function public.ensure_secondary_cardholder_profile(text, text, text) from anon;
revoke all on function public.ensure_secondary_cardholder_profile(text, text, text) from authenticated;
grant execute on function public.ensure_secondary_cardholder_profile(text, text, text) to service_role;
