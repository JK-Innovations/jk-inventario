-- Local stand-in for Supabase Auth and API roles.
-- Not part of the production migration. The real project already has these.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

-- Two-part custom setting so the local stand-in does not depend on PostgREST GUCs.
-- Production keeps Supabase's own auth.uid(); this file is never applied there.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('jkin.user_id', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
