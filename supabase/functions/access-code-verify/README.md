# access-code-verify

Validates the single access code used by `access.html` without exposing the code in the public browser bundle.

## Required secrets

- `RESIDUE_ACCESS_CODE`

## Optional secrets

- `ACCESS_CODE_VERIFY_ALLOWED_ORIGINS`
  Comma-separated allowlist for CORS. Defaults to `*`.

## Suggested value

- `RESIDUE_ACCESS_CODE=res-1738`

## Deploy

```bash
supabase functions deploy access-code-verify
```
