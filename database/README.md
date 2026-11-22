# Medora — Database deliverables

This folder contains the database hand-off files for the Medora repository.
The database model is based on the **current backend implementation** shipped
with this project, not the older frontend schema-extraction document or an
older database dump.

## Contents

- `schema.sql` — one-file PostgreSQL export made by concatenating all 34
  checked-in Prisma migrations in timestamp order. It includes the extensions,
  tables, enums, indexes, constraints, triggers, functions, and later additive
  changes defined by those migrations.
- `manifest.json` — inventory of the source files and a SHA-256 fingerprint
  for `schema.sql`.

## Source of truth

The canonical implementation remains in the backend:

| Purpose | Project path |
|---|---|
| Prisma models and enums | `backend/prisma/schema/` |
| Ordered migration history | `backend/prisma/migrations/` |
| Prisma CLI configuration | `backend/prisma.config.ts` |
| Seed implementation | `backend/prisma/seed.ts` and `backend/prisma/seed/` |
| Database scripts | `backend/package.json` |

Do not independently edit `schema.sql` or create a second hand-maintained
schema. Make database changes in Prisma schema/migrations first, then
regenerate the export.

## Recommended: create a new application database

Use a **new, empty PostgreSQL 16+ database**. Do not point setup at an existing
or shared `medora` database.

1. Install the backend dependencies from the repository root:

   ```bash
   npm --prefix backend install
   ```

2. Create `backend/.env` from `backend/.env.example` and set `DATABASE_URL`
   to the new database. Configure `APP_ENV=development` for local development.
   Do not commit `.env` or credentials.

3. Apply the canonical migration history:

   ```bash
   npm --prefix backend run db:deploy
   ```

4. Insert reference/catalogue/settings data and permitted development seed
   data using the project's existing idempotent TypeScript seed:

   ```bash
   npm --prefix backend run db:seed
   ```

The seed is not a SQL file. It is implemented in TypeScript because it uses
Prisma models and application services (including password hashing and
encryption). It refuses to run when `APP_ENV=production`. Demo clinical data
and demo credentials have additional environment gates. Review
`backend/prisma/seed.ts` and `backend/docs/LOCAL_DEMO_ACCOUNTS.md`.

Useful checks:

```bash
npm --prefix backend run db:status
npm --prefix backend run db:check
```

## Optional: standalone SQL bootstrap

`schema.sql` is provided for database administrators who specifically need a
single SQL file for a fresh, disposable database. Run it only against a
**new, empty** PostgreSQL database:

```bash
psql -v ON_ERROR_STOP=1 -d <fresh_database> -f database/schema.sql
```

Important:

- This SQL export does **not** populate Prisma's
  `public._prisma_migrations` history table.
- Do not run `schema.sql` and then run `prisma migrate deploy` on that same
  database. Prisma would see the migrations as unapplied and try to replay
  them.
- For the application, the recommended route is `db:deploy` followed by
  `db:seed`; that records migration history correctly.

## Safety and verification status

- The export contains all 34 migration files found in this repository, in
  timestamp order.
- The Prisma source contains 112 models and 80 enums.
- `manifest.json` records the file hash and source inventory.
- This package was statically inspected. It was **not** executed against a
  live PostgreSQL server in this environment, so no claim is made that a
  fresh server restore was integration-tested here.
- Never run `db:reset` against a database containing data you need.
- Back up shared databases and review pending migrations before applying them.
