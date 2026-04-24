alter table public.purchase_invoices
  add column if not exists shipping_province text;
