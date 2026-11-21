-- Postgres extensions (RM M4.1).
--
-- Raw SQL and a migration of its own, deliberately. Prisma's schema
-- language cannot express `CREATE EXTENSION`, and putting these in the
-- same migration as a table would mean a table could be created before
-- the extension its column type or default depends on.
--
-- All three must exist before any M5 model: `gen_random_uuid()` is the
-- default on every primary key, `citext` is the type of every email and
-- username, and `pg_trgm` backs the fuzzy search of M26.
--
-- `IF NOT EXISTS` so the migration is idempotent against a database
-- where a DBA installed an extension ahead of us — that is a legitimate
-- production setup, not drift.

-- pgcrypto — `gen_random_uuid()` for database-side primary keys.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- citext — case-insensitive text. Emails compare correctly without a
-- `lower()` wrapper that would defeat the index (DB §10).
CREATE EXTENSION IF NOT EXISTS "citext";

-- pg_trgm — trigram similarity, the index behind cross-entity search
-- (API §16.1, RM M26).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
