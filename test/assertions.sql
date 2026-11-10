-- Local checks for stock math, tax, the ledger, and RLS.
-- Refuses to run unless the database name is jkin_inv_test.

do $$
begin
  if current_database() <> 'jkin_inv_test' then
    raise exception 'Refusing to run outside jkin_inv_test';
  end if;
end $$;

do $$
declare
  avail integer;
  reserved integer;
  physical integer;
  tax numeric;
  tot numeric;
  sub numeric;
  minq integer;
  n integer;
begin
  select s.available, s.reserved, s.physical
    into avail, reserved, physical
  from inventory.stock_levels s
  where s.variant_id = '44444444-4444-4444-8444-444444444441';
  if physical <> 12 or reserved <> 2 or avail <> 10 then
    raise exception 'demo navy YM expected physical 12 reserved 2 available 10, got % % %', physical, reserved, avail;
  end if;

  if (select alert from inventory.stock_levels where variant_id = '44444444-4444-4444-8444-444444444442') <> 'low' then
    raise exception 'navy AM should be low';
  end if;
  if (select alert from inventory.stock_levels where variant_id = '44444444-4444-4444-8444-444444444443') <> 'out' then
    raise exception 'maroon YXS should be out';
  end if;
  if (select category from inventory.products where id = '33333333-3333-4333-8333-333333333332') <> 'sports' then
    raise exception 'jersey should stay in sports';
  end if;

  select o.subtotal, o.tax_amount, o.total
    into sub, tax, tot
  from inventory.orders o
  where o.id = '66666666-6666-4666-8666-666666666661';
  if sub <> 58.00 or tax <> 6.24 or tot <> 64.24 then
    raise exception 'demo order expected 58.00 / 6.24 / 64.24, got % / % / %', sub, tax, tot;
  end if;

  select count(*) into n
  from information_schema.columns
  where table_schema = 'inventory'
    and table_name = 'order_lines'
    and column_name = 'cost_price';
  if n <> 0 then
    raise exception 'order lines must not store cost';
  end if;

  select v.min_qty into minq
  from inventory.variants v
  where v.id = '44444444-4444-4444-8444-444444444445';
  if minq <> 3 then
    raise exception 'default minimum should be 3, got %', minq;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name like 'inv\_%' escape '\'
  ) then
    raise exception 'public inv_ tables were not part of this design';
  end if;
end $$;

do $$
declare
  sell numeric;
  cost numeric;
begin
  begin
    insert into inventory.movements (variant_id, delta, reason, note)
    values ('44444444-4444-4444-8444-444444444441', -1, 'adjust', '');
    raise exception 'adjust without a note was accepted';
  exception
    when check_violation then null;
  end;

  select unit_sell_price into sell
  from inventory.order_lines
  where id = '77777777-7777-4777-8777-777777777771';
  select cost_price into cost
  from inventory.variants
  where id = '44444444-4444-4444-8444-444444444441';
  if sell <> 18.00 or cost <> 8.50 or sell = cost then
    raise exception 'client price and cost were mixed: sell % cost %', sell, cost;
  end if;
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inventario@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'produccion@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'nobody@example.com');

insert into inventory.profiles (user_id, role, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inventario', 'Inventory'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'produccion', 'Production');

insert into inventory.products (id, name, garment, category, item_no, supplier, lead_time_days)
values ('88888888-8888-4888-8888-888888888881', 'RLS polo', 'polo', 'uniform', 'RLS1', 'SanMar', 4);

insert into inventory.variants (
  id, product_id, color, size, size_group, sku, cost_price, sell_price
) values (
  '88888888-8888-4888-8888-888888888882',
  '88888888-8888-4888-8888-888888888881',
  'Navy', 'YM', 'youth', 'RLS1-NAVY-YM', 5, 15
);

insert into inventory.movements (variant_id, delta, reason, note)
values ('88888888-8888-4888-8888-888888888882', 5, 'receive', 'RLS receive');

select set_config('jkin.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
set role authenticated;

insert into inventory.schools (id, name) values ('88888888-8888-4888-8888-888888888883', 'RLS School');

insert into inventory.orders (id, channel, client_id, school_id)
values (
  '88888888-8888-4888-8888-888888888884',
  'workshop',
  null,
  '88888888-8888-4888-8888-888888888883'
);

insert into inventory.order_lines (order_id, variant_id, qty, unit_sell_price, custom_name, slide, sign)
values (
  '88888888-8888-4888-8888-888888888884',
  '88888888-8888-4888-8888-888888888882',
  1, 15.00, 'Sam', true, true
);

do $$
declare
  v_available integer;
  v_reserved integer;
begin
  select s.available, s.reserved into v_available, v_reserved
  from inventory.stock_levels s
  where s.variant_id = '88888888-8888-4888-8888-888888888882';
  if v_available <> 5 or v_reserved <> 0 then
    raise exception 'draft order must not reserve, got available % reserved %', v_available, v_reserved;
  end if;
end $$;

update inventory.orders set status = 'confirmed' where id = '88888888-8888-4888-8888-888888888884';

do $$
declare
  v_available integer;
  sub numeric;
  tax numeric;
  tot numeric;
begin
  select s.available into v_available from inventory.stock_levels s
  where s.variant_id = '88888888-8888-4888-8888-888888888882';
  if v_available <> 4 then
    raise exception 'confirmed order should reserve 1, available %', v_available;
  end if;
  select subtotal, tax_amount, total into sub, tax, tot
  from inventory.orders where id = '88888888-8888-4888-8888-888888888884';
  if sub <> 15.00 or tax <> 1.61 or tot <> 16.61 then
    raise exception 'expected 15.00 / 1.61 / 16.61, got % / % / %', sub, tax, tot;
  end if;
end $$;

do $$
begin
  begin
    insert into inventory.movements (variant_id, delta, reason, note, order_id)
    values (
      '88888888-8888-4888-8888-888888888882',
      -1, 'fulfill', 'manual',
      '88888888-8888-4888-8888-888888888884'
    );
    raise exception 'manual fulfill insert was allowed';
  exception
    when insufficient_privilege then null;
  end;
end $$;

update inventory.orders set status = 'fulfilled' where id = '88888888-8888-4888-8888-888888888884';

do $$
declare
  v_physical integer;
  v_reserved integer;
  v_available integer;
  posted integer;
begin
  select s.physical, s.reserved, s.available into v_physical, v_reserved, v_available
  from inventory.stock_levels s
  where s.variant_id = '88888888-8888-4888-8888-888888888882';
  if v_physical <> 4 or v_reserved <> 0 or v_available <> 4 then
    raise exception 'fulfill should deduct and release reserve, got % % %', v_physical, v_reserved, v_available;
  end if;
  select count(*) into posted from inventory.movements
  where order_id = '88888888-8888-4888-8888-888888888884' and reason = 'fulfill' and delta = -1;
  if posted <> 1 then
    raise exception 'expected one fulfill movement, got %', posted;
  end if;
  begin
    update inventory.orders set status = 'cancelled' where id = '88888888-8888-4888-8888-888888888884';
    raise exception 'fulfilled order was cancelled';
  exception
    when others then
      if sqlerrm not like '%final%' then
        raise;
      end if;
  end;
end $$;

reset role;
select set_config('jkin.user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
set role authenticated;

do $$
begin
  begin
    insert into inventory.products (name, garment) values ('Blocked', 'polo');
    raise exception 'produccion inserted a product';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into inventory.orders (channel) values ('workshop');
    raise exception 'produccion inserted an order';
  exception
    when insufficient_privilege then null;
  end;
end $$;

insert into inventory.movements (variant_id, delta, reason, note)
values ('88888888-8888-4888-8888-888888888882', 1, 'return', 'RLS return');

reset role;
select set_config('jkin.user_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', false);
set role authenticated;

do $$
declare
  n integer;
begin
  select count(*) into n from inventory.products;
  if n <> 0 then
    raise exception 'user without a role can see products (% rows)', n;
  end if;
end $$;

reset role;
set role anon;

do $$
begin
  begin
    perform 1 from inventory.products;
    raise exception 'anon read products';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;
