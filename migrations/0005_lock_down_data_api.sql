-- Lock Supabase's auto-generated Data API (PostgREST) out of the app's tables.
--
-- The app never uses supabase-js or the anon key: it talks to Postgres directly
-- over DATABASE_URL as `postgres` (the owner of every table here, and a
-- BYPASSRLS role). But Supabase auto-grants every table created in `public` to
-- its `anon` and `authenticated` roles, so anyone holding the project's
-- publishable anon key could read or rewrite any row over REST — including
-- `account` (password hashes) and `session` (live session tokens).
--
--   1. RLS on, with no policies: the Data API roles match zero rows. The app's
--      own role is the table owner and bypasses RLS, so it is unaffected.
--   2. Revoke the Data API roles' grants outright. RLS does not cover TRUNCATE,
--      and a missing grant is a second, independent lock.
--   3. Revoke the schema's default privileges, so a table added by a later
--      migration is not silently re-exposed.
--
-- `anon`/`authenticated` only exist on Supabase: the PGLite fallback (no
-- DATABASE_URL) gets step 1 and skips 2–3. Tables are looked up with
-- to_regclass so this file still applies if sign-in (0001_auth.sql) is off.
-- Every statement is idempotent.
do $$
declare
  t text;
  data_api_roles boolean :=
    exists (select 1 from pg_roles where rolname = 'anon')
    and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array[
    'user', 'session', 'account', 'verification',
    'profiles', 'daily_leaderboard', 'entitlements', '_migrations'
  ] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      if data_api_roles then
        execute format('revoke all on table public.%I from anon, authenticated', t);
      end if;
    end if;
  end loop;

  if data_api_roles then
    alter default privileges for role postgres in schema public
      revoke all on tables from anon, authenticated;
    alter default privileges for role postgres in schema public
      revoke all on sequences from anon, authenticated;
    alter default privileges for role postgres in schema public
      revoke all on functions from anon, authenticated;
  end if;
end
$$;
