alter table public.purchase_invoices
  add column if not exists unit_price numeric(12,2);

alter table public.purchase_invoices
  add column if not exists subtotal_amount numeric(12,2);

alter table public.purchase_invoices
  add column if not exists shipping_amount numeric(12,2);

alter table public.purchase_invoices
  add column if not exists total_amount numeric(12,2);
