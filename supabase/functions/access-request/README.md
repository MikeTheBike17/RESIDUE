# access-request

Accepts public access-request form submissions, stores them in `public.access_requests`, and emails your team.

## Deploy

```bash
supabase functions deploy access-request
```

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `ACCESS_REQUEST_TEAM_EMAIL`

## Optional secrets

- `ACCESS_REQUEST_FROM_EMAIL` (default: `Residue <access@residue.cc>`)
- `ACCESS_REQUEST_ALLOWED_ORIGINS` (comma-separated list, or `*`)
- `TURNSTILE_SECRET_KEY`
- `ACCESS_REQUEST_EMAIL_RATE_LIMIT` (default `3`)
- `ACCESS_REQUEST_RATE_WINDOW_MINUTES` (default `15`)

## Example request body

```json
{
  "name": "Jane Founder",
  "email": "jane@company.com",
  "intent": "Need card access for our team launch",
  "team_size": 12,
  "turnstile_token": ""
}
```
