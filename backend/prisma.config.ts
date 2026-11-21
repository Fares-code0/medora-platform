import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (RM M4.1).
 *
 * The CLI runs outside the Nest application, so it cannot use
 * `ConfigService`. `dotenv/config` here mirrors what `src/config/env.ts`
 * does for the running service — same `.env`, same precedence, so a
 * migration and the application can never disagree about which database
 * they are pointed at.
 *
 * `shadowDatabaseUrl` is where `migrate dev` replays the migration
 * history to detect drift. Prisma creates one automatically when the
 * user may `CREATEDB`; naming it explicitly means CI works with a role
 * that may not, and keeps the shadow off the development database.
 */
const url = process.env['DATABASE_URL'];
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  // Keys are omitted rather than set to `undefined`: with
  // `exactOptionalPropertyTypes` those are different things, and an
  // explicit `undefined` would also stop Prisma falling back to its own
  // resolution when a variable is genuinely unset.
  datasource: {
    ...(url === undefined ? {} : { url }),
    ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
  },
});
