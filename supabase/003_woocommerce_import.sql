-- WooCommerce PDF import.
--
-- Apply this once in the Supabase SQL editor on Norma's project
-- (schema inventory). It does not change stock and does not edit public.
-- After it commits, the notify at the bottom reloads the Data API.
--
-- What it adds:
--   inventory.orders.source        workshop (existing rows) or woocommerce
--   inventory.orders.external_ref  the WooCommerce order number
--   a unique pair of those two, so the same Woo order cannot be imported twice
--   inventory.external_sku_map     remembered PDF line → variant matches

begin;

alter table inventory.orders
  add column if not exists source text not null default 'workshop';

alter table inventory.orders
  add column if not exists external_ref text not null default '';

alter table inventory.orders
  drop constraint if exists orders_source_chk;

alter table inventory.orders
  add constraint orders_source_chk
  check (source in ('workshop', 'woocommerce'));

comment on column inventory.orders.source is
  'Where the order was written. woocommerce means it was imported from a WooCommerce PDF.';
comment on column inventory.orders.external_ref is
  'WooCommerce order number for an imported order. Blank on workshop orders.';

create unique index if not exists orders_woo_ref_idx
  on inventory.orders (source, lower(external_ref))
  where length(btrim(external_ref)) > 0;

create table if not exists inventory.external_sku_map (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'woocommerce',
  external_key text not null,
  variant_id uuid not null references inventory.variants (id) on delete restrict,
  sample_label text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint external_sku_map_source_chk check (source in ('woocommerce')),
  constraint external_sku_map_key_not_blank check (length(btrim(external_key)) > 0),
  constraint external_sku_map_source_key unique (source, external_key)
);

comment on table inventory.external_sku_map is
  'Remembered match from an outside catalog (a WooCommerce PDF line) to one inventory variant.';

alter table inventory.external_sku_map enable row level security;
alter table inventory.external_sku_map force row level security;

drop policy if exists external_sku_map_select on inventory.external_sku_map;
create policy external_sku_map_select on inventory.external_sku_map
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists external_sku_map_insert on inventory.external_sku_map;
create policy external_sku_map_insert on inventory.external_sku_map
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists external_sku_map_update on inventory.external_sku_map;
create policy external_sku_map_update on inventory.external_sku_map
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists external_sku_map_delete on inventory.external_sku_map;
create policy external_sku_map_delete on inventory.external_sku_map
  for delete to authenticated
  using (inventory.my_role() in ('admin', 'inventario'));

grant select, insert, update, delete on inventory.external_sku_map
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
