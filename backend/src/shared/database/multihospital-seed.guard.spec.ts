import { afterEach, describe, expect, it } from 'vitest';

import { assertMultiHospitalSeedEnvironment } from '../../../prisma/seed/multihospital';

const previousEnvironment = {
  appEnv: process.env['APP_ENV'],
  disposable: process.env['MEDORA_DISPOSABLE_DB'],
  databaseUrl: process.env['DATABASE_URL'],
};

function setSeedEnvironment(databaseUrl: string): void {
  process.env['APP_ENV'] = 'development';
  process.env['MEDORA_DISPOSABLE_DB'] = 'true';
  process.env['DATABASE_URL'] = databaseUrl;
}

afterEach(() => {
  if (previousEnvironment.appEnv === undefined) delete process.env['APP_ENV'];
  else process.env['APP_ENV'] = previousEnvironment.appEnv;
  if (previousEnvironment.disposable === undefined) delete process.env['MEDORA_DISPOSABLE_DB'];
  else process.env['MEDORA_DISPOSABLE_DB'] = previousEnvironment.disposable;
  if (previousEnvironment.databaseUrl === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = previousEnvironment.databaseUrl;
});

describe('multi-hospital seed environment guard', () => {
  it('accepts only an explicitly marked loopback medora_test database', () => {
    const url = 'postgresql://medora:medora@localhost:5432/medora_test?schema=public';
    setSeedEnvironment(url);

    expect(assertMultiHospitalSeedEnvironment()).toBe(url);
  });

  it('rejects a development environment without the disposable marker', () => {
    setSeedEnvironment('postgresql://medora:medora@localhost:5432/medora_test');
    delete process.env['MEDORA_DISPOSABLE_DB'];

    expect(() => assertMultiHospitalSeedEnvironment()).toThrow(/MEDORA_DISPOSABLE_DB=true/);
  });

  it('rejects a non-loopback database host', () => {
    setSeedEnvironment('postgresql://medora:medora@db.example.test:5432/medora_test');

    expect(() => assertMultiHospitalSeedEnvironment()).toThrow(/loopback PostgreSQL medora_test/);
  });

  it('rejects any database other than medora_test', () => {
    setSeedEnvironment('postgresql://medora:medora@localhost:5432/medora');

    expect(() => assertMultiHospitalSeedEnvironment()).toThrow(/loopback PostgreSQL medora_test/);
  });
});
