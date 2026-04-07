# wallet-apple-pass

Apple Wallet pass endpoint scaffold for a slug.

Current behavior:
- Validates slug and token
- Returns `501` with setup guidance when Apple signer secrets are missing
- Returns a deterministic pass payload scaffold when Apple cert variables are present

This is intentionally scaffolded so you can plug in your signer implementation safely.

## Deploy

```bash
supabase functions deploy wallet-apple-pass
```

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SITE_URL`
- `WALLET_SIGNING_SECRET`

## Apple setup secrets (for ready-for-signing mode)

- `APPLE_WALLET_CERT_PEM`
- `APPLE_WALLET_KEY_PEM`
- `APPLE_WALLET_WWDR_PEM`
- `APPLE_WALLET_PASS_TYPE_IDENTIFIER`
- `APPLE_WALLET_TEAM_IDENTIFIER`
- `APPLE_WALLET_ORGANIZATION_NAME` (optional; default `Residue`)

