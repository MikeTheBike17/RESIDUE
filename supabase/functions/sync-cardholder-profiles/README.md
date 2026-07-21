# sync-cardholder-profiles

Creates or reuses Supabase auth/profile rows for linked cardholder emails saved from `orders.html`, then returns their `link-profile` URLs.

## Deploy

Run `supabase/cardholder-profile-sync.sql` first so the service-role helper exists.

This function validates the signed-in user inside `index.ts`, so Supabase gateway JWT verification must be disabled to allow browser `OPTIONS` preflight requests:

```bash
supabase functions deploy sync-cardholder-profiles --no-verify-jwt
```

The same setting is also tracked in `supabase/config.toml`:

```toml
[functions.sync-cardholder-profiles]
verify_jwt = false
```

## Required Secrets

```bash
supabase secrets set SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

Optional:

```bash
supabase secrets set PUBLIC_SITE_URL="https://www.residue.cc"
supabase secrets set RESIDUE_MANAGER_EMAIL="check.email@residue.com"
supabase secrets set CARDHOLDER_PROFILE_SYNC_ALLOWED_ORIGINS="https://www.residue.cc"
```

## Troubleshooting

If the browser shows `Internal Server Error`, open the Supabase Dashboard at **Edge Functions > sync-cardholder-profiles > Logs**. The function logs one line per failed cardholder email as `Cardholder profile sync failed`.

Common causes:

- `supabase/cardholder-profile-sync.sql` has not been run in SQL Editor.
- `SUPABASE_SERVICE_ROLE_KEY` is missing from Edge Function secrets.
- The function was deployed without `--no-verify-jwt`.
- Supabase Auth rejected creating the linked cardholder user.
