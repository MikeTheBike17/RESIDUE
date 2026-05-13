alter table public.purchase_invoices
  add column if not exists payment_reference text;

alter table public.purchase_invoices
  add column if not exists payment_updated_at timestamptz;

alter table public.purchase_invoices
  add column if not exists stitch_payment_request_id text;
