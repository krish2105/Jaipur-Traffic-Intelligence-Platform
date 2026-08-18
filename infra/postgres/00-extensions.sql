-- PRAVAAH database bootstrap. Runs ONCE, as a superuser, before migrations.
--
-- Extensions and role provisioning are a DBA concern, not a schema migration:
-- the application role has no CREATEROLE on Tiger Cloud and should not have it
-- locally either. Migrations then only GRANT to roles that already exist.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- lexical half of NEETI hybrid retrieval
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid, digest

-- The role the API connects as. RLS policies target this role, so it must NOT
-- be a superuser and must NOT own the tables — BYPASSRLS would defeat the whole
-- ABAC design in docs/07 §5.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pravaah_app') THEN
    CREATE ROLE pravaah_app NOLOGIN;
  END IF;
  -- The role NEETI's text-to-SQL runs as. Read-only, allowlisted schema.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pravaah_ro') THEN
    CREATE ROLE pravaah_ro NOLOGIN;
  END IF;
END $$;

-- Local development logins that inherit those roles. In production these are
-- federated identities, and the passwords here never leave the laptop.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pravaah') THEN
    CREATE ROLE pravaah LOGIN PASSWORD 'pravaah';
  END IF;
END $$;
GRANT pravaah_app TO pravaah;
