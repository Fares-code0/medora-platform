import fs from 'node:fs';
import path from 'node:path';

import { FIXTURE_DOCTORS , fixtureDoctorService } from '@/features/doctors/fixtures/doctor-fixtures';
import { FORBIDDEN_DOCTOR_FIELDS } from '@/features/doctors/model/types';

/**
 * Patient-safe projections — checklist A-05, V-10, audit R-3.
 *
 * `doctors` carries `license_number`, `employee_id`, `contact_phone` and
 * `emergency_contact_phone`. Shipping the admin DTO and hiding those in
 * the UI would leak a practitioner's licence number and personal phone
 * number to every patient over the wire.
 *
 * The real control is **BE-04, a server-side projection**, and these
 * tests do not pretend otherwise — they cannot see the wire. What they
 * do is hold the client's half: the fixture cannot carry a forbidden
 * field, the type cannot declare one, and no component can render one.
 * When BE-04 exists, its own contract test asserts the response body.
 */

function keysOf(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => keysOf(item, prefix));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [
    prefix === '' ? key : `${prefix}.${key}`,
    ...keysOf(inner, key),
  ]);
}

describe('the doctor fixture carries no forbidden field', () => {
  it('has none of the internal doctor fields', () => {
    const keys = keysOf(FIXTURE_DOCTORS);
    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('carries only the A-05 allow-list', () => {
    const allowed = [
      'id',
      'fullName',
      'title',
      'specialty',
      'departmentName',
      'photoUrl',
      'yearsOfExperience',
      'languages',
      'biography',
      'education',
      'ratingAvg',
      'hospital',
      'officeLocation',
    ];

    for (const doctor of FIXTURE_DOCTORS) {
      expect(Object.keys(doctor).sort()).toEqual([...allowed].sort());
    }
  });

  it('returns the same allow-list through the service', async () => {
    const result = await fixtureDoctorService.search({});
    const keys = keysOf(result.items);
    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('returns the same allow-list from a detail lookup', async () => {
    const doctor = await fixtureDoctorService.getById('DR-1001');
    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(Object.keys(doctor)).not.toContain(forbidden);
    }
  });
});

describe('no component can render a forbidden field', () => {
  const doctorsDir = path.resolve(__dirname, '..', 'features', 'doctors');

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    });
  }

  it('names no forbidden field outside the deny-list itself', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(doctorsDir)) {
      // `model/types.ts` holds the deny-list, so it names them by design.
      if (file.endsWith(path.join('model', 'types.ts'))) continue;
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
        if (source.includes(forbidden)) offenders.push(`${path.basename(file)}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('documents the allow-list where a reviewer will find it', () => {
    const doc = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'docs', 'PUBLIC_PROJECTIONS.md'),
      'utf8',
    );
    for (const forbidden of ['licenseNumber', 'employeeId', 'contactPhone', 'emergencyContact']) {
      expect(doc).toContain(forbidden);
    }
  });
});
