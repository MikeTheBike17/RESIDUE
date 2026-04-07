# wallet-card-art

Returns dynamic card art as SVG using:
- base image: `/images/card-images/card-front-1.jpeg`
- centered white profile name text

Use this endpoint in wallet object image fields.

## Deploy

```bash
supabase functions deploy wallet-card-art
```

## Required secrets

- `PUBLIC_SITE_URL`

Optional for DB name lookup:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Request

`GET /functions/v1/wallet-card-art?slug=michael-lehman`

