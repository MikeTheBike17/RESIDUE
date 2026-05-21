PayFast secret placement

This function is the server-side home for PayFast payment verification.

Store these values as Supabase Edge Function secrets:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE` (only if PayFast issues one for your account)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional test/sandbox values:

- `PAYFAST_VALIDATE_URL` defaults to `https://www.payfast.co.za/eng/query/validate`
- `PAYFAST_VALID_HOSTS` defaults to `www.payfast.co.za,w1w.payfast.co.za,w2w.payfast.co.za,sandbox.payfast.co.za`

Do not place these values in:

- `js/env.js`
- `write-env.js`
- any HTML hidden input committed to the repo
- any client-side JavaScript bundle

Public/browser-safe values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PAYFAST_PROCESS_URL`
- `SHIPPING_FEE`
- table names like `SUPABASE_ORDERS_TABLE`

Expected notify URL pattern:

- `https://<your-supabase-project-ref>.supabase.co/functions/v1/payfast-notify`

Suggested setup commands:

```powershell
supabase secrets set PAYFAST_MERCHANT_ID=your_merchant_id
supabase secrets set PAYFAST_MERCHANT_KEY=your_merchant_key
supabase secrets set PAYFAST_PASSPHRASE=your_optional_passphrase
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Deploy the function after setting secrets:

```powershell
supabase functions deploy payfast-notify --no-verify-jwt
```

PayFast cannot send a Supabase JWT to the webhook, so this function must be
publicly reachable. The function verifies PayFast itself with signature,
source, server-confirmation, and amount checks before updating an invoice.

Before testing live invoice updates, run `supabase/purchase-invoices-amounts.sql`
in the Supabase SQL editor so the webhook can compare `amount_gross` against
the invoice total before marking the order `COMPLETE`.
