import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every clinical worklist names the row it is reading.
 *
 * `DataTable`'s `rowHeader` renders a column's cells as `<th scope="row">`, so
 * a screen reader announces that value when reading any other cell in the row.
 * It was built in wave 2c-a, tested, and then used by **nothing** — which left
 * the five widest tables in the app reading "Completed", "High risk" or
 * "Critical low" with no way to hear whose row that was. A 14-column table is
 * exactly where the omission costs the most.
 *
 * Asserted over the source rather than by rendering each table, because the
 * property worth keeping is *every worklist has one*, and a rendering test
 * proves it only for the tables somebody remembered to write one for. The
 * rendering behaviour itself is `DataTable.test.tsx`'s job.
 *
 * ## Why the admin tables are not on this list
 *
 * Not an oversight, and not "do it next". They are 6–9 columns and do not
 * overflow at 1440 px, so the cost of an unnamed row is far lower there — and
 * their identity cells are compound in a way the doctor side's are not.
 * Measured in the browser, the accessible name of the first cell is:
 *
 * - `/admin/doctors` → "Dr. Nadia Farouk" **plus the specialty line**
 * - `/admin/patients` → "Mo••• A••• — Patient name, masked PT-1002 ••••6-58 —
 *   Medical record number, masked", **plus two reveal buttons**
 *
 * A row header is announced before every other cell in its row. The doctor
 * worklists' cells resolve to a bare "Khaled Nassar" (the avatar is
 * `decorative`, so its initials are `aria-hidden` and excluded), which is why
 * they are worth it. Prefixing fifteen words and two control labels to every
 * cell of an admin row would be louder than the silence it replaced. Making
 * those cells worth marking means restructuring them first — an ADM-10
 * surface change, not a one-line prop.
 */

const WORKLISTS = [
  'labs/components/lab-table-columns.tsx',
  'patients/components/patient-table-columns.tsx',
  'appointments/components/appointment-table-columns.tsx',
  'pharmacy/components/prescription-table-columns.tsx',
  'medical-records/components/medical-record-table-columns.tsx',
] as const;

describe.each(WORKLISTS)('%s', (file) => {
  const source = readFileSync(join(__dirname, file), 'utf8');

  it('marks a column as the row header', () => {
    expect(source).toMatch(/rowHeader:\s*true/);
  });

  it('marks exactly one, because a row has one identity', () => {
    // `<th scope="row">` twice in a row is not "more identifying" — it makes
    // the announcement ambiguous, and the prop's own contract says at most
    // one column should claim it.
    expect(source.match(/rowHeader:\s*true/g)).toHaveLength(1);
  });
});
