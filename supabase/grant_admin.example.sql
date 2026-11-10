-- EXAMPLE ONLY. Not part of the empty production setup.
-- 1. Create the person in Supabase Authentication (or have them sign in once).
-- 2. Replace the email below.
-- 3. Run this once in the SQL editor.
-- The in-app Access form can also grant a role if you paste the user id
-- shown on the "no access yet" screen. Use that after the first admin exists.
-- This file refuses to run while the placeholder email is still in place.

do $$
declare
  target text := 'REPLACE_WITH_USER_EMAIL';
  uid uuid;
begin
  if target = 'REPLACE_WITH_USER_EMAIL' then
    raise exception 'Edit grant_admin.example.sql and set the real email before running.';
  end if;
  select id into uid
  from auth.users
  where lower(email) = lower(target);
  if uid is null then
    raise exception 'No Auth user with email %', target;
  end if;
  insert into inventory.profiles (user_id, role, display_name, active)
  values (uid, 'admin', 'Norma Muñoz', true)
  on conflict (user_id) do update
    set role = 'admin',
        active = true,
        display_name = excluded.display_name,
        updated_at = pg_catalog.now();
end $$;
