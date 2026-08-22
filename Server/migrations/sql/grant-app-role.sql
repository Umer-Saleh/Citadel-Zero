-- Table privileges for the least-privilege application role.
--
-- Applied AFTER migrations, because it grants on tables migrations
-- create. Re-running it is harmless, so it is applied on every deploy
-- rather than once — which is also what picks up a table added by a
-- later migration.
--
--   psql -U postgres -d password_manager -f migrations/sql/grant-app-role.sql
--
-- Skips silently when the role does not exist, so a setup that
-- connects as the superuser (local development) is unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citadel_app') THEN
    RAISE NOTICE 'role citadel_app does not exist — skipping grants';
    RETURN;
  END IF;

  -- Exactly the four verbs the app uses, on exactly the four tables it
  -- touches. No CREATE, no DROP, no ALTER — a SQL injection that
  -- reaches the database still cannot drop a table or add a role.
  --
  -- Deliberately NOT granted:
  --   - pgmigrations: migrations run as a separate, privileged user
  --   - CREATE on the schema: the app never creates objects
  --   - Any sequence: every primary key is a uuid default, not a serial
  --   - TRUNCATE: the nightly demo wipe uses DELETE, which cascades
  --     through the foreign keys and needs no extra privilege
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
             users, vault_items, refresh_tokens, totp_backup_codes
             TO citadel_app';

  RAISE NOTICE 'granted table privileges to citadel_app';
END
$$;
