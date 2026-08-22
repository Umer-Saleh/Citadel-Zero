#!/bin/sh
# Create the least-privilege application role.
#
# Runs at database initialisation, from /docker-entrypoint-initdb.d.
# Creating a role needs superuser, which is exactly what the
# application is being denied — so it happens here rather than in a
# migration the app could run itself.
#
# ROLE ONLY. The table grants are NOT here, because at init time the
# tables do not exist yet: migrations have not run. Granting on a
# missing relation is an error, and the Postgres entrypoint runs these
# scripts with ON_ERROR_STOP=1, so it aborted initialisation outright
# and the container exited. The grants live in grant-app-role.sql and
# are applied after `migrate up`.
#
# A shell script rather than plain .sql so the password comes from the
# environment. A password committed to a public repository is not a
# password.
set -e

if [ -z "$APP_DB_PASSWORD" ]; then
  echo "[init] APP_DB_PASSWORD unset — skipping least-privilege role."
  echo "[init] The app will connect as the superuser. Fine for local"
  echo "[init] development; see DEPLOY.md before doing it in production."
  exit 0
fi

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE citadel_app WITH LOGIN PASSWORD :'app_password';

-- Connect and read the schema, nothing more at the database level.
GRANT CONNECT ON DATABASE :"DBNAME" TO citadel_app;
GRANT USAGE ON SCHEMA public TO citadel_app;
SQL

echo "[init] created role citadel_app (table grants follow migrations)"
