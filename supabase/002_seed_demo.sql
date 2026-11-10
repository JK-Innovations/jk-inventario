-- OPTIONAL demo data for JK workshop inventory.
-- Do not run this on a workshop you are about to count for real.
-- It inserts fictional schools, SKUs, movements, and one open order.
-- It does not create auth users and does not grant roles.
-- Safe to run again: fixed ids, insert-if-missing.
--
-- Assumes 001_inventory_schema.sql has already been applied.
-- Run as the database owner in the Supabase SQL editor (bypasses RLS).

begin;

insert into inventory.schools (id, name, colors, notes)
values (
  '11111111-1111-4111-8111-111111111111',
  'Harder Elementary (sample)',
  array['#1E1E22', '#7A1F2B'],
  'Demo school. Black / maroon. Not a live roster.'
)
on conflict (id) do nothing;

insert into inventory.clients (id, name, phone, email, school_id, notes)
values (
  '22222222-2222-4222-8222-222222222222',
  'Sample Parent',
  '555-0100',
  'sample.parent@example.com',
  '11111111-1111-4111-8111-111111111111',
  'Demo client. Not a real family.'
)
on conflict (id) do nothing;

insert into inventory.products (
  id, name, garment, category, item_no, supplier, lead_time_days, notes
) values
  (
    '33333333-3333-4333-8333-333333333331',
    'Harder polo',
    'polo',
    'uniform',
    '5719',
    'SanMar',
    4,
    'Demo uniform. Lead time is a sample inside the SanMar 2–5 day note.'
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    'Harder jersey',
    't-shirt',
    'sports',
    'Y317',
    'S&S',
    5,
    'Demo sports piece, separate from uniforms.'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'Workshop beanie',
    'beanie',
    'general',
    'CP90',
    'ELDERWARE',
    8,
    'Demo item with no school tag.'
  )
on conflict (id) do nothing;

insert into inventory.product_schools (product_id, school_id)
values
  ('33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111'),
  ('33333333-3333-4333-8333-333333333332', '11111111-1111-4111-8111-111111111111')
on conflict do nothing;

insert into inventory.variants (
  id, product_id, color, size, size_group, sku,
  cost_price, sell_price, min_qty, school_id, design
) values
  (
    '44444444-4444-4444-8444-444444444441',
    '33333333-3333-4333-8333-333333333331',
    'Navy', 'YM', 'youth', '5719-NAVY-YM',
    8.50, 18.00, 3,
    '11111111-1111-4111-8111-111111111111',
    'Harder crest'
  ),
  (
    '44444444-4444-4444-8444-444444444442',
    '33333333-3333-4333-8333-333333333331',
    'Navy', 'AM', 'adult', '5719-NAVY-AM',
    9.00, 20.00, 3,
    '11111111-1111-4111-8111-111111111111',
    'Harder crest'
  ),
  (
    '44444444-4444-4444-8444-444444444443',
    '33333333-3333-4333-8333-333333333331',
    'Maroon', 'YXS', 'youth', '5719-MAROON-YXS',
    8.50, 18.00, 3,
    '11111111-1111-4111-8111-111111111111',
    'Harder crest'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333332',
    'Black', 'YM', 'youth', 'Y317-BLACK-YM',
    11.00, 22.00, 3,
    '11111111-1111-4111-8111-111111111111',
    'Harder athletics'
  ),
  (
    '44444444-4444-4444-8444-444444444445',
    '33333333-3333-4333-8333-333333333333',
    'Black', 'OS', 'os', 'CP90-BLACK-OS',
    4.00, 12.00, 3,
    null,
    ''
  )
on conflict (id) do nothing;

insert into inventory.movements (id, variant_id, delta, reason, note)
values
  (
    '55555555-5555-4555-8555-555555555551',
    '44444444-4444-4444-8444-444444444441',
    12, 'receive', 'Demo receive'
  ),
  (
    '55555555-5555-4555-8555-555555555552',
    '44444444-4444-4444-8444-444444444442',
    2, 'receive', 'Demo receive — should show low (min 3)'
  ),
  (
    '55555555-5555-4555-8555-555555555553',
    '44444444-4444-4444-8444-444444444444',
    6, 'receive', 'Demo receive'
  ),
  (
    '55555555-5555-4555-8555-555555555554',
    '44444444-4444-4444-8444-444444444445',
    4, 'receive', 'Demo receive'
  )
on conflict (id) do nothing;

-- Maroon YXS has no movement, so physical 0 and the dashboard shows Out.
-- The order is inserted as draft (the trigger rejects anything else) and
-- then confirmed, which reserves stock and does not deduct it.

insert into inventory.orders (id, channel, status, client_id, school_id, reference, notes)
values (
  '66666666-6666-4666-8666-666666666661',
  'school',
  'draft',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'DEMO-ONLY',
  'Sample multi-line order. Totals use client price, not cost.'
)
on conflict (id) do nothing;

insert into inventory.order_lines (
  id, order_id, variant_id, qty, unit_sell_price, custom_name, slide, sign
) values
  (
    '77777777-7777-4777-8777-777777777771',
    '66666666-6666-4666-8666-666666666661',
    '44444444-4444-4444-8444-444444444441',
    2, 18.00, 'Alex', true, false
  ),
  (
    '77777777-7777-4777-8777-777777777772',
    '66666666-6666-4666-8666-666666666661',
    '44444444-4444-4444-8444-444444444444',
    1, 22.00, 'Alex', false, true
  )
on conflict (id) do nothing;

update inventory.orders
set status = 'confirmed'
where id = '66666666-6666-4666-8666-666666666661'
  and status = 'draft';

commit;
