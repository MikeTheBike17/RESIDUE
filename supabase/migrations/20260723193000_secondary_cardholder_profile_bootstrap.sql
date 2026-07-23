-- Service-created secondary cardholders receive their profile through
-- ensure_profile_for_auth_email() immediately after Auth creation. Bypassing
-- the normal signup trigger for only these marked users prevents a profile
-- bootstrap error from rolling back the Auth user creation.

create or replace function public.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'residue_cardholder', 'false') = 'true' then
    return new;
  end if;

  perform public.ensure_profile_from_auth(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', null)
  );
  return new;
end;
$$;

drop trigger if exists auth_users_profile_bootstrap on auth.users;
create trigger auth_users_profile_bootstrap
after insert on auth.users
for each row
execute function public.on_auth_user_created();
