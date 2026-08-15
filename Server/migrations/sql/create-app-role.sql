-- Least-privilege role for the application.
--
-- Run once as a superuser. The app does NOT run this itself — creating
-- roles requires privileges the app is deliberately being denied.
--
--   psql -U postgres -d password_manager -f migrations/sql/create-app-role.sql

CREATE ROLE citadel_app WITH LOGIN PASSWORD 'change-me';

-- Connect and read the schema, nothing more at the database level.
GRANT CONNECT ON DATABASE password_manager TO citadel_app;
GRANT USAGE ON SCHEMA public TO citadel_app;

-- Exactly the four verbs the app uses, on exactly the four tables it
-- touches. No CREATE, no DROP, no ALTER — a SQL injection that reaches
-- the database still cannot drop a table or add a role.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, vault_items, refresh_tokens, totp_backup_codes
  TO citadel_app;

-- Deliberately NOT granted:
--   - pgmigrations: migrations run as a separate, privileged user
--   - CREATE on the schema: the app never creates objects
--   - Any sequence: every primary key is a uuid default, not a serial