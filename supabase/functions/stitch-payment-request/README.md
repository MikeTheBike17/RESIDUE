Stitch payment request

This function creates a Stitch hosted checkout session for the Residue purchase flow.
It keeps the Stitch client credentials on the server and returns only the hosted redirect URL
plus the Stitch payment-request id back to the browser.

Store these values as Supabase Edge Function secrets:

- `STITCH_CLIENT_ID`
- `STITCH_CLIENT_SECRET`
- `STITCH_PAYMENT_REQUEST_EXPIRY_MINUTES` (optional, defaults to `60`)

Important notes:

- This implementation creates a Stitch payment request with `card.enabled = true`.
- It disables `eft` in the request body, so you do not need to provide beneficiary banking details.
- Your Stitch client must have card payments enabled for this to work.
- The browser sends the site return URL, and this function validates that it matches the incoming request origin before handing it to Stitch.

Suggested setup:

```powershell
supabase secrets set STITCH_CLIENT_ID=your_client_id
supabase secrets set STITCH_CLIENT_SECRET=your_client_secret
supabase secrets set STITCH_PAYMENT_REQUEST_EXPIRY_MINUTES=60
supabase functions deploy stitch-payment-request
```

This function works together with:

- `supabase/functions/stitch-payment-status`
- `js/private-payment.js`
