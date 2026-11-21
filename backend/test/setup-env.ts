/**
 * The environment every test runs against (RM M3.1).
 *
 * M3 makes the application refuse to boot without a complete
 * environment, and the e2e specs boot a real Nest application — so
 * without this file they would fail on configuration rather than on the
 * behaviour under test.
 *
 * The alternative was to relax the schema so tests can boot with less.
 * That would make the fail-fast contract untrue exactly where it is
 * verified. Supplying a complete environment instead keeps the schema
 * strict and keeps the tests honest: if a new **required** variable is
 * added and this file is not updated, every e2e spec fails immediately
 * and says which variable is missing.
 *
 * `??=` throughout: a variable already set by the shell wins, so a
 * developer can point the suite at a real database later without
 * editing this file.
 */
const TEST_ENV: Readonly<Record<string, string>> = {
  APP_ENV: 'test',
  PORT: '3000',
  CORS_ORIGINS: 'http://localhost:5173',

  DATABASE_URL: 'postgresql://medora:medora@localhost:5432/medora_test?schema=public',
  REDIS_URL: 'redis://localhost:6379',

  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'medora-files-test',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',

  // 32+ characters to satisfy the schema's minimum. Not a credential:
  // it signs nothing outside this process and grants access to nothing.
  JWT_SECRET: 'test-only-signing-key-not-a-secret-000000',
  COOKIE_DOMAIN: 'localhost',
  APP_PUBLIC_URL: 'http://localhost:5173',
  // Base64 for 32 bytes, as the schema requires. Encrypts nothing outside
  // this process; the ciphertext it produces lives only in the test database.
  DATA_ENCRYPTION_KEY: 'dGVzdC1vbmx5LWVudmVsb3BlLWtleS0zMi1ieXRlcyE=',

  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Medora Test <no-reply@medora.test>',

  // The registry is still built and still sealed; only *firing* is off
  // (M30.1). A suite that let the schedules run would have eleven sweeps
  // moving rows underneath it at unpredictable moments, and Vitest runs
  // the files in parallel — so one suite's retention purge would be
  // dropping partitions while another asserted on them. The jobs specs
  // drive the registry by hand, which is also what makes their clocks
  // controllable.
  JOBS_ENABLED: 'false',
  JOBS_DRIVER: 'inline',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
