# wallet-pass

Creates wallet links for a profile slug:
- Google Wallet `Save to Wallet` URL (JWT signed)
- Apple Wallet endpoint URL (scaffold)
- Card URL and card-art URL

## Deploy

```bash
supabase functions deploy wallet-pass
```

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SITE_URL` (example: `https://www.residue.cc`)
- `WALLET_SIGNING_SECRET` (random long string used to sign Apple link tokens)

### Google Wallet (to enable real save links)

- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_CLASS_SUFFIX` (optional; default: `residue_virtual_card`)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PKCS8 private key; keep `\n` escaped)

## Request

`POST /functions/v1/wallet-pass`

```json
{
  "slug": "michael-lehman",
  "name": "Michael Lehman",
  "platform": "google"
}
```

