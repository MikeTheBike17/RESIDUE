Stitch payment status

This function verifies the status of a Stitch payment request after the buyer is redirected
back to `residue-private.html`. The browser uses it to confirm the final status before showing
the post-payment confirmation message.

Store these values as Supabase Edge Function secrets:

- `STITCH_CLIENT_ID`
- `STITCH_CLIENT_SECRET`

Suggested setup:

```powershell
supabase secrets set STITCH_CLIENT_ID=your_client_id
supabase secrets set STITCH_CLIENT_SECRET=your_client_secret
supabase functions deploy stitch-payment-status
```

This function works together with:

- `supabase/functions/stitch-payment-request`
- `js/private-payment.js`
