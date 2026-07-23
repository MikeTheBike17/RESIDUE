# sync-cardholder-profiles

Creates or reuses normal `link-profile` URLs for linked cardholder emails saved from `orders.html`.

If the email already has a `profiles` row, the existing profile slug is reused. If
the email does not have a profile yet, the function creates a Supabase Auth
identity with an unrecoverable random password and then creates the linked
`profiles` row. The cardholder can later claim the account through the normal
password-reset flow. Slugs are based on the first half of the email address,
such as `test1@gmail.com` -> `test1`, and any previously reserved slug is
preserved.

Accepted sync sources:

- `manual` with `allocation_id`
- `purchase` with `invoice_no`
- `all-missing` for manager backfills
- `assignments` for manager-only explicit rows from `card-urls.html`

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
- The `cardholder_profile_urls` table has not been created from the SQL helper.

## Backfill existing assignments

After deploying this version, use the manager action on `card-urls.html` that
syncs all missing URLs. Existing `order_card_emails` and `manual_card_emails`
rows (including emails that previously had URL reservations only) will receive
real Auth identities and `profiles` rows.
