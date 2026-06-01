# access-code-verify

Legacy access-code verifier retained for compatibility. The public Shop flow no longer calls this function.

## Required secrets

- `RESIDUE_ACCESS_CODE`
  or
- `RESIDUE_ACCESS_CODE_SHA256`

## Optional secrets

- `ACCESS_CODE_VERIFY_ALLOWED_ORIGINS`
  Comma-separated allowlist for CORS. Defaults to `*`.

## Suggested value

- `RESIDUE_ACCESS_CODE=res-1738`
- `RESIDUE_ACCESS_CODE_SHA256=01810e66ba6d21239428f3815c311d944035f6ff43228352ea372752c0a6f10d`

## Deploy

```bash
supabase functions deploy access-code-verify
```
