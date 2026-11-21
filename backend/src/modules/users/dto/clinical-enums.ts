/**
 * Prisma enum member → API wire value (ADR-023 §2).
 *
 * ADR-023 decided that every enum member carries an explicit `@map`, that
 * "the DB value is the API vocabulary; the member name is an
 * implementation detail of one client", and that the consequence is
 * **"owned by the API layer, not hidden"** — each module maps at its
 * serialization boundary. This is the first module to serialize one, so
 * this is the first of those boundaries.
 *
 * ## Why a table and not `.toLowerCase()`
 *
 * It would work for `Gender` and be wrong for everything else. `O_POSITIVE`
 * is `O+`, and `NO_SHOW` is `no-show` — a mechanical transform gets both
 * wrong, and gets them wrong *quietly*, putting a value on the wire that
 * no client vocabulary contains. The contract calls these enum literals
 * "law"; a lossy transform is not a way to obey a law.
 *
 * ## Why `Record<Enum, string>` and not a lookup with a fallback
 *
 * The type makes exhaustiveness the compiler's problem. Add a ninth blood
 * type to the schema and this file stops compiling, which is the moment
 * to notice — rather than a `?? value` default silently shipping
 * `AB_NEGATIVE` to a client that only understands `AB-`.
 */

import type { BloodType, Gender } from '../../../generated/prisma/enums';

const GENDER_WIRE: Record<Gender, string> = {
  FEMALE: 'female',
  MALE: 'male',
};

const BLOOD_TYPE_WIRE: Record<BloodType, string> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A-',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B-',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB-',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O-',
};

export function genderToWire(value: Gender): string {
  return GENDER_WIRE[value];
}

export function bloodTypeToWire(value: BloodType): string {
  return BLOOD_TYPE_WIRE[value];
}
