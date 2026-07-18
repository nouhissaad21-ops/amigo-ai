#!/bin/sh
set -eu
: "${AMIGO_SYSTEM_PASSWORD:?required}"
: "${AMIGO_APP_PASSWORD:?required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=system_password="$AMIGO_SYSTEM_PASSWORD" --set=app_password="$AMIGO_APP_PASSWORD" --set=db_name="$POSTGRES_DB" <<-'EOSQL'
SELECT 'CREATE ROLE amigo_system LOGIN BYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amigo_system') \gexec
SELECT 'CREATE ROLE amigo_app LOGIN NOBYPASSRLS' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amigo_app') \gexec
ALTER ROLE amigo_system PASSWORD :'system_password' BYPASSRLS;
ALTER ROLE amigo_app PASSWORD :'app_password' NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE :"db_name" TO amigo_system;
GRANT CONNECT ON DATABASE :"db_name" TO amigo_app;
GRANT ALL ON SCHEMA public TO amigo_system;
GRANT USAGE ON SCHEMA public TO amigo_app;
EOSQL
