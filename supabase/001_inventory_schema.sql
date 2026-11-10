-- JK Innovations workshop inventory (Fase 0 + Fase 1)
--
-- Namespace: schema `inventory` (not table prefix inv_, and not public).
-- The school-order app already uses public.schools, public.products,
-- public.orders, public.order_lines, public.groups, public.periods,
-- public.admins, public.deliveries. This migration does not create, alter,
-- or drop anything in public.
--
-- Run in the Supabase SQL editor as the database owner (postgres).
-- Do not run the demo seed unless you want sample rows.
-- After this file succeeds, add `inventory` to Data API exposed schemas
-- and reload the API schema (the notify at the bottom asks PostgREST to reload).
--
-- Stock math:
--   physical  = sum of movement deltas
--   reserved  = sum of line qty on orders in confirmed | in_production | ready
--   available = physical - reserved
-- Client totals use sell price only. CA tax is 10.75% of that subtotal.
-- Entering status `fulfilled` posts one negative movement per line (reason fulfill).
-- That is the Fase 2 hook: delivery method / tracking can gate this transition later.
-- Fase 3 can store a channel reference in orders.reference. This file does not sync Woo.

begin;

do $$
begin
  if to_regrole('authenticated') is null
     or to_regrole('anon') is null
     or to_regrole('service_role') is null then
    raise exception
      'Missing Supabase API roles (anon, authenticated, service_role). Run this in the SQL editor of Norma''s Supabase project.';
  end if;
end $$;

create schema if not exists inventory;

comment on schema inventory is
  'Workshop inventory for Norma. Isolated from public school-order tables.';

grant usage on schema inventory to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

do $$
begin
  create type inventory.app_role as enum ('admin', 'inventario', 'produccion');
exception
  when duplicate_object then null;
end $$;

create table if not exists inventory.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role inventory.app_role not null,
  display_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table inventory.profiles is
  'App role for an Auth user. No row means signed-in but no inventory access. Insert the first admin from the SQL editor; the app cannot self-grant.';

-- ---------------------------------------------------------------------------
-- Directory
-- ---------------------------------------------------------------------------

create table if not exists inventory.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  colors text[] not null default '{}',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint schools_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists schools_name_lower_idx
  on inventory.schools (lower(name));

create table if not exists inventory.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  email text not null default '',
  school_id uuid references inventory.schools (id) on delete restrict,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint clients_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists clients_school_idx on inventory.clients (school_id);

-- ---------------------------------------------------------------------------
-- Catalog. Cost and client sell price never share a column.
-- ---------------------------------------------------------------------------

create table if not exists inventory.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  garment text not null,
  category text not null default 'uniform',
  item_no text not null default '',
  alt_item_nos text[] not null default '{}',
  supplier text not null default '',
  lead_time_days integer,
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint products_name_not_blank check (length(btrim(name)) > 0),
  constraint products_garment_not_blank check (length(btrim(garment)) > 0),
  constraint products_category_chk check (category in ('uniform', 'sports', 'staff', 'general')),
  constraint products_lead_time_chk check (lead_time_days is null or lead_time_days >= 0)
);

comment on column inventory.products.supplier is
  'Supplier name as a field. Full supplier CRUD is out of scope (Fase 4).';
comment on column inventory.products.lead_time_days is
  'Typical supplier lead time in days. Nullable when unknown.';

create index if not exists products_item_no_lower_idx
  on inventory.products (lower(item_no));

create table if not exists inventory.product_schools (
  product_id uuid not null references inventory.products (id) on delete cascade,
  school_id uuid not null references inventory.schools (id) on delete restrict,
  primary key (product_id, school_id)
);

create table if not exists inventory.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references inventory.products (id) on delete restrict,
  color text not null,
  size text not null,
  size_group text not null,
  sku text not null,
  cost_price numeric(12, 2) not null,
  sell_price numeric(12, 2) not null,
  min_qty integer not null default 3,
  school_id uuid references inventory.schools (id) on delete restrict,
  client_id uuid references inventory.clients (id) on delete restrict,
  design text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint variants_color_not_blank check (length(btrim(color)) > 0),
  constraint variants_size_not_blank check (length(btrim(size)) > 0),
  constraint variants_sku_not_blank check (length(btrim(sku)) > 0),
  constraint variants_size_group_chk check (size_group in ('youth', 'adult', 'toddler', 'os', 'numeric')),
  constraint variants_cost_nonneg check (cost_price >= 0),
  constraint variants_sell_nonneg check (sell_price >= 0),
  constraint variants_min_nonneg check (min_qty >= 0)
);

comment on column inventory.variants.cost_price is
  'Internal unit cost. Never use for order totals or tax.';
comment on column inventory.variants.sell_price is
  'Client unit price. Order subtotal, CA tax, and total use this only.';
comment on column inventory.variants.min_qty is
  'Alert when available qty is at or below this number. Default 3, editable per SKU.';
comment on column inventory.variants.size_group is
  'youth and adult are separate. Sports pieces use products.category = sports; their sizes still use these groups.';

create unique index if not exists variants_sku_lower_idx
  on inventory.variants (lower(sku));
create index if not exists variants_product_idx on inventory.variants (product_id);

-- ---------------------------------------------------------------------------
-- Ledger. Every quantity change is a row with a reason. No silent +/-.
-- ---------------------------------------------------------------------------

create table if not exists inventory.movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references inventory.variants (id) on delete restrict,
  delta integer not null,
  reason text not null,
  note text not null default '',
  order_id uuid,
  order_line_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint movements_delta_nonzero check (delta <> 0),
  constraint movements_reason_chk check (
    reason in ('receive', 'adjust', 'count', 'return', 'fulfill', 'correction')
  ),
  constraint movements_reason_sign_chk check (
    (reason = 'receive' and delta > 0)
    or (reason = 'return' and delta > 0)
    or (reason = 'fulfill' and delta < 0)
    or (reason in ('adjust', 'count', 'correction') and delta <> 0)
  ),
  constraint movements_note_required_chk check (
    reason not in ('adjust', 'correction')
    or length(btrim(note)) > 0
  ),
  constraint movements_fulfill_has_order_chk check (
    reason <> 'fulfill' or order_id is not null
  )
);

comment on table inventory.movements is
  'Append-only stock ledger. physical qty is the sum of delta. adjust and correction require a note.';

create index if not exists movements_variant_idx on inventory.movements (variant_id);
create index if not exists movements_created_idx on inventory.movements (created_at desc);
create index if not exists movements_order_idx on inventory.movements (order_id);

-- ---------------------------------------------------------------------------
-- Orders. Multi-line. Tax is computed on client sell price only.
-- Status hook: draft does not reserve; confirmed / in_production / ready reserve;
-- fulfilled posts ledger rows and stops reserving; cancelled releases the reserve.
-- ---------------------------------------------------------------------------

create sequence if not exists inventory.order_no_seq start with 1001;

create table if not exists inventory.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  channel text not null default 'workshop',
  status text not null default 'draft',
  client_id uuid references inventory.clients (id) on delete restrict,
  school_id uuid references inventory.schools (id) on delete restrict,
  reference text not null default '',
  notes text not null default '',
  subtotal numeric(12, 2) not null default 0,
  tax_rate numeric(6, 5) not null default 0.10750,
  tax_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  fulfilled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint orders_channel_chk check (channel in ('workshop', 'school', 'online', 'other')),
  constraint orders_status_chk check (
    status in ('draft', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled')
  ),
  constraint orders_money_nonneg check (subtotal >= 0 and tax_amount >= 0 and total >= 0)
);

comment on column inventory.orders.reference is
  'Free-text reference. Reserved for a future Woo id (Fase 3). Not synced.';
comment on column inventory.orders.tax_rate is
  'CA tax rate applied to the client subtotal. Stored on the order so a later rate change does not rewrite history. New orders use 0.10750.';
comment on column inventory.orders.status is
  'Fulfillment posts stock. Delivery method and tracking are Fase 2 and are intentionally not columns yet.';

create index if not exists orders_status_idx on inventory.orders (status);
create index if not exists orders_created_idx on inventory.orders (created_at desc);

create table if not exists inventory.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references inventory.orders (id) on delete restrict,
  variant_id uuid not null references inventory.variants (id) on delete restrict,
  qty integer not null,
  unit_sell_price numeric(12, 2) not null,
  custom_name text not null default '',
  slide boolean not null default false,
  sign boolean not null default false,
  line_total numeric(12, 2) generated always as (round(qty * unit_sell_price, 2)) stored,
  created_at timestamptz not null default pg_catalog.now(),
  constraint order_lines_qty_pos check (qty > 0),
  constraint order_lines_sell_nonneg check (unit_sell_price >= 0)
);

comment on column inventory.order_lines.unit_sell_price is
  'Snapshot of the client sell price. There is no cost column on an order line.';
comment on column inventory.order_lines.custom_name is
  'Name printed or embroidered on the garment.';
comment on column inventory.order_lines.slide is 'Slide option checked on this line.';
comment on column inventory.order_lines.sign is 'Sign option checked on this line.';

create index if not exists order_lines_order_idx on inventory.order_lines (order_id);
create index if not exists order_lines_variant_idx on inventory.order_lines (variant_id);

alter table inventory.movements
  drop constraint if exists movements_order_fk;
alter table inventory.movements
  add constraint movements_order_fk
  foreign key (order_id) references inventory.orders (id) on delete restrict;

alter table inventory.movements
  drop constraint if exists movements_order_line_fk;
alter table inventory.movements
  add constraint movements_order_line_fk
  foreign key (order_line_id) references inventory.order_lines (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function inventory.my_role()
returns text
language sql
stable
security definer
set search_path = inventory
as $$
  select p.role::text
  from inventory.profiles p
  where p.user_id = auth.uid()
    and p.active
$$;

comment on function inventory.my_role() is
  'Active inventory role for the signed-in user, or null. Security definer so policies can read profiles without recursion.';

revoke all on function inventory.my_role() from public, anon;
grant execute on function inventory.my_role() to authenticated, service_role;

create or replace function inventory.guard_profile()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
begin
  if tg_op = 'DELETE' or new.role is distinct from old.role or (old.active and not new.active) then
    if old.role = 'admin' and old.active then
      if (
        select count(*)
        from inventory.profiles p
        where p.role = 'admin'
          and p.active
          and p.user_id <> old.user_id
      ) = 0 then
        raise exception 'Keep at least one active admin';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function inventory.prepare_order()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
declare
  sub numeric(12, 2);
  tax numeric(12, 2);
  rate numeric(6, 5) := 0.10750;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'New orders start as draft';
    end if;
    new.order_no := 'JK-' || nextval('inventory.order_no_seq')::text;
    new.created_by := auth.uid();
    new.fulfilled_at := null;
    new.created_at := pg_catalog.now();
  else
    new.order_no := old.order_no;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.status is not distinct from old.status then
      new.fulfilled_at := old.fulfilled_at;
    elsif old.status in ('fulfilled', 'cancelled') then
      raise exception 'Order status % is final', old.status;
    elsif not (
      (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('draft', 'in_production', 'ready', 'fulfilled', 'cancelled'))
      or (old.status = 'in_production' and new.status in ('confirmed', 'ready', 'fulfilled', 'cancelled'))
      or (old.status = 'ready' and new.status in ('in_production', 'fulfilled', 'cancelled'))
    ) then
      raise exception 'Cannot change status from % to %', old.status, new.status;
    elsif new.status = 'fulfilled' then
      if not exists (
        select 1 from inventory.order_lines l where l.order_id = new.id
      ) then
        raise exception 'Add at least one line before fulfilling';
      end if;
      new.fulfilled_at := pg_catalog.now();
    end if;
  end if;

  select coalesce(sum(l.line_total), 0)
    into sub
  from inventory.order_lines l
  where l.order_id = new.id;

  tax := round(sub * rate, 2);
  new.subtotal := sub;
  new.tax_rate := rate;
  new.tax_amount := tax;
  new.total := sub + tax;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function inventory.prepare_order_line()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
declare
  st text;
  oid uuid;
  sell numeric(12, 2);
begin
  oid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select o.status into st from inventory.orders o where o.id = oid;
  if st is null then
    raise exception 'Order not found';
  end if;
  if st in ('fulfilled', 'cancelled') then
    raise exception 'Lines cannot be changed when the order is %', st;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.qty is null or new.qty <= 0 then
    raise exception 'Quantity must be at least 1';
  end if;
  if new.unit_sell_price is null then
    select v.sell_price into sell
    from inventory.variants v
    where v.id = new.variant_id;
    if sell is null then
      raise exception 'Choose a variant that has a client price';
    end if;
    new.unit_sell_price := sell;
  end if;
  if new.unit_sell_price < 0 then
    raise exception 'Client price cannot be negative';
  end if;
  new.custom_name := coalesce(new.custom_name, '');
  new.slide := coalesce(new.slide, false);
  new.sign := coalesce(new.sign, false);
  return new;
end;
$$;

create or replace function inventory.touch_order_from_line()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
declare
  oid uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
begin
  update inventory.orders
  set updated_at = pg_catalog.now()
  where id = oid;
  return null;
end;
$$;

create or replace function inventory.post_order_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
begin
  if new.status = 'fulfilled' and old.status is distinct from 'fulfilled' then
    insert into inventory.movements (
      variant_id, delta, reason, note, order_id, order_line_id, created_by
    )
    select
      l.variant_id,
      -l.qty,
      'fulfill',
      'Fulfilled ' || new.order_no,
      new.id,
      l.id,
      auth.uid()
    from inventory.order_lines l
    where l.order_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function inventory.block_order_delete()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
begin
  if old.status not in ('draft', 'cancelled') then
    raise exception 'Only draft or cancelled orders can be deleted';
  end if;
  if exists (select 1 from inventory.movements m where m.order_id = old.id) then
    raise exception 'This order already has stock movements';
  end if;
  return old;
end;
$$;

create or replace function inventory.normalize_variant()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
begin
  new.color := btrim(new.color);
  new.size := upper(btrim(new.size));
  new.sku := upper(btrim(new.sku));
  new.design := btrim(coalesce(new.design, ''));
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function inventory.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = inventory
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Trigger functions are not called from the browser. PostgREST cannot call
-- a function that returns trigger. Execute is granted so the invoking role
-- is allowed to fire them; the bodies only run as triggers.
revoke all on function inventory.guard_profile() from public, anon;
revoke all on function inventory.prepare_order() from public, anon;
revoke all on function inventory.prepare_order_line() from public, anon;
revoke all on function inventory.touch_order_from_line() from public, anon;
revoke all on function inventory.post_order_fulfillment() from public, anon;
revoke all on function inventory.block_order_delete() from public, anon;
revoke all on function inventory.normalize_variant() from public, anon;
revoke all on function inventory.touch_updated_at() from public, anon;
grant execute on function inventory.guard_profile() to authenticated, service_role;
grant execute on function inventory.prepare_order() to authenticated, service_role;
grant execute on function inventory.prepare_order_line() to authenticated, service_role;
grant execute on function inventory.touch_order_from_line() to authenticated, service_role;
grant execute on function inventory.post_order_fulfillment() to authenticated, service_role;
grant execute on function inventory.block_order_delete() to authenticated, service_role;
grant execute on function inventory.normalize_variant() to authenticated, service_role;
grant execute on function inventory.touch_updated_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_guard on inventory.profiles;
create trigger profiles_guard
  before update or delete on inventory.profiles
  for each row execute function inventory.guard_profile();

drop trigger if exists schools_touch on inventory.schools;
create trigger schools_touch
  before update on inventory.schools
  for each row execute function inventory.touch_updated_at();

drop trigger if exists clients_touch on inventory.clients;
create trigger clients_touch
  before update on inventory.clients
  for each row execute function inventory.touch_updated_at();

drop trigger if exists products_touch on inventory.products;
create trigger products_touch
  before update on inventory.products
  for each row execute function inventory.touch_updated_at();

drop trigger if exists variants_normalize on inventory.variants;
create trigger variants_normalize
  before insert or update on inventory.variants
  for each row execute function inventory.normalize_variant();

drop trigger if exists orders_prepare on inventory.orders;
create trigger orders_prepare
  before insert or update on inventory.orders
  for each row execute function inventory.prepare_order();

drop trigger if exists orders_fulfill on inventory.orders;
create trigger orders_fulfill
  after update on inventory.orders
  for each row execute function inventory.post_order_fulfillment();

drop trigger if exists orders_block_delete on inventory.orders;
create trigger orders_block_delete
  before delete on inventory.orders
  for each row execute function inventory.block_order_delete();

drop trigger if exists order_lines_prepare on inventory.order_lines;
create trigger order_lines_prepare
  before insert or update or delete on inventory.order_lines
  for each row execute function inventory.prepare_order_line();

drop trigger if exists order_lines_touch_order on inventory.order_lines;
create trigger order_lines_touch_order
  after insert or update or delete on inventory.order_lines
  for each row execute function inventory.touch_order_from_line();

-- ---------------------------------------------------------------------------
-- Stock view. security_invoker so RLS of the caller applies.
-- ---------------------------------------------------------------------------

create or replace view inventory.stock_levels
with (security_invoker = true) as
select
  v.id as variant_id,
  v.product_id,
  v.sku,
  coalesce(phys.physical, 0)::integer as physical,
  coalesce(res.reserved, 0)::integer as reserved,
  (coalesce(phys.physical, 0) - coalesce(res.reserved, 0))::integer as available,
  v.min_qty,
  case
    when (coalesce(phys.physical, 0) - coalesce(res.reserved, 0)) <= 0 then 'out'
    when (coalesce(phys.physical, 0) - coalesce(res.reserved, 0)) <= v.min_qty then 'low'
    else 'ok'
  end as alert
from inventory.variants v
left join (
  select m.variant_id, sum(m.delta)::integer as physical
  from inventory.movements m
  group by m.variant_id
) phys on phys.variant_id = v.id
left join (
  select l.variant_id, sum(l.qty)::integer as reserved
  from inventory.order_lines l
  join inventory.orders o on o.id = l.order_id
  where o.status in ('confirmed', 'in_production', 'ready')
  group by l.variant_id
) res on res.variant_id = v.id;

comment on view inventory.stock_levels is
  'available = physical - reserved. low means available > 0 and available <= min_qty. out means available <= 0.';

-- ---------------------------------------------------------------------------
-- Grants. RLS is the real gate. anon has schema usage and no table rights.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema inventory
  to authenticated, service_role;
grant usage, select on all sequences in schema inventory
  to authenticated, service_role;

alter default privileges in schema inventory
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema inventory
  grant usage, select on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table inventory.profiles enable row level security;
alter table inventory.schools enable row level security;
alter table inventory.clients enable row level security;
alter table inventory.products enable row level security;
alter table inventory.product_schools enable row level security;
alter table inventory.variants enable row level security;
alter table inventory.movements enable row level security;
alter table inventory.orders enable row level security;
alter table inventory.order_lines enable row level security;

alter table inventory.profiles force row level security;
alter table inventory.schools force row level security;
alter table inventory.clients force row level security;
alter table inventory.products force row level security;
alter table inventory.product_schools force row level security;
alter table inventory.variants force row level security;
alter table inventory.movements force row level security;
alter table inventory.orders force row level security;
alter table inventory.order_lines force row level security;

drop policy if exists profiles_select on inventory.profiles;
create policy profiles_select on inventory.profiles
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists profiles_insert on inventory.profiles;
create policy profiles_insert on inventory.profiles
  for insert to authenticated
  with check (inventory.my_role() = 'admin');

drop policy if exists profiles_update on inventory.profiles;
create policy profiles_update on inventory.profiles
  for update to authenticated
  using (inventory.my_role() = 'admin')
  with check (inventory.my_role() = 'admin');

drop policy if exists profiles_delete on inventory.profiles;
create policy profiles_delete on inventory.profiles
  for delete to authenticated
  using (inventory.my_role() = 'admin');

drop policy if exists schools_select on inventory.schools;
create policy schools_select on inventory.schools
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists schools_insert on inventory.schools;
create policy schools_insert on inventory.schools
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists schools_update on inventory.schools;
create policy schools_update on inventory.schools
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists schools_delete on inventory.schools;
create policy schools_delete on inventory.schools
  for delete to authenticated
  using (inventory.my_role() = 'admin');

drop policy if exists clients_select on inventory.clients;
create policy clients_select on inventory.clients
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists clients_insert on inventory.clients;
create policy clients_insert on inventory.clients
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists clients_update on inventory.clients;
create policy clients_update on inventory.clients
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists clients_delete on inventory.clients;
create policy clients_delete on inventory.clients
  for delete to authenticated
  using (inventory.my_role() = 'admin');

drop policy if exists products_select on inventory.products;
create policy products_select on inventory.products
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists products_insert on inventory.products;
create policy products_insert on inventory.products
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists products_update on inventory.products;
create policy products_update on inventory.products
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists products_delete on inventory.products;
create policy products_delete on inventory.products
  for delete to authenticated
  using (inventory.my_role() = 'admin');

drop policy if exists product_schools_select on inventory.product_schools;
create policy product_schools_select on inventory.product_schools
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists product_schools_write on inventory.product_schools;
create policy product_schools_write on inventory.product_schools
  for all to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists variants_select on inventory.variants;
create policy variants_select on inventory.variants
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists variants_insert on inventory.variants;
create policy variants_insert on inventory.variants
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists variants_update on inventory.variants;
create policy variants_update on inventory.variants
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists variants_delete on inventory.variants;
create policy variants_delete on inventory.variants
  for delete to authenticated
  using (inventory.my_role() = 'admin');

-- Fulfill rows are inserted by the security-definer trigger (table owner /
-- supabase postgres bypasses RLS). Browser roles cannot insert reason fulfill,
-- so a manual +/- cannot pretend to be an order fulfillment.
drop policy if exists movements_select on inventory.movements;
create policy movements_select on inventory.movements
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists movements_insert on inventory.movements;
create policy movements_insert on inventory.movements
  for insert to authenticated
  with check (
    reason <> 'fulfill'
    and (
      inventory.my_role() in ('admin', 'inventario')
      or (
        inventory.my_role() = 'produccion'
        and reason in ('receive', 'adjust', 'count', 'return', 'correction')
      )
    )
  );

drop policy if exists movements_delete on inventory.movements;
create policy movements_delete on inventory.movements
  for delete to authenticated
  using (inventory.my_role() = 'admin');

drop policy if exists orders_select on inventory.orders;
create policy orders_select on inventory.orders
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists orders_insert on inventory.orders;
create policy orders_insert on inventory.orders
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists orders_update on inventory.orders;
create policy orders_update on inventory.orders
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists orders_delete on inventory.orders;
create policy orders_delete on inventory.orders
  for delete to authenticated
  using (
    inventory.my_role() in ('admin', 'inventario')
    and status in ('draft', 'cancelled')
  );

drop policy if exists order_lines_select on inventory.order_lines;
create policy order_lines_select on inventory.order_lines
  for select to authenticated
  using (inventory.my_role() is not null);

drop policy if exists order_lines_insert on inventory.order_lines;
create policy order_lines_insert on inventory.order_lines
  for insert to authenticated
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists order_lines_update on inventory.order_lines;
create policy order_lines_update on inventory.order_lines
  for update to authenticated
  using (inventory.my_role() in ('admin', 'inventario'))
  with check (inventory.my_role() in ('admin', 'inventario'));

drop policy if exists order_lines_delete on inventory.order_lines;
create policy order_lines_delete on inventory.order_lines
  for delete to authenticated
  using (inventory.my_role() in ('admin', 'inventario'));

notify pgrst, 'reload schema';

commit;
