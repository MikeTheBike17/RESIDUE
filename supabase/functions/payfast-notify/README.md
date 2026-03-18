PayFast secret placement

This function is the server-side home for PayFast payment verification.

Store these values as Supabase Edge Function secrets:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE` (only if PayFast issues one for your account)

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
```

Deploy the function after setting secrets:

```powershell
supabase functions deploy payfast-notify
```
