PayFast checkout config

This function returns the PayFast checkout credentials needed by the browser form
at the moment a signed-in user starts payment.

Store these values as Supabase Edge Function secrets:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`

Deploy with JWT verification enabled so only authenticated users can call it.

Suggested setup:

```powershell
supabase secrets set PAYFAST_MERCHANT_ID=your_merchant_id
supabase secrets set PAYFAST_MERCHANT_KEY=your_merchant_key
supabase functions deploy payfast-config
```

This function works together with:

- `payfast-notify` for trusted payment notifications
- `js/private-payment.js` for the client-side checkout form
