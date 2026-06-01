alter table public.purchase_invoices
  add column if not exists invoice_sent_to_client boolean not null default false;

alter table public.purchase_invoices
  add column if not exists order_sent_to_client boolean not null default false;

drop policy if exists "purchase invoices manager update fulfilment flags" on public.purchase_invoices;
create policy "purchase invoices manager update fulfilment flags"
on public.purchase_invoices
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'check.email@residue.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'check.email@residue.com');
