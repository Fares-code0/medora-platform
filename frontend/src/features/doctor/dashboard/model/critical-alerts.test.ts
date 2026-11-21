import { describe, expect, it } from 'vitest';

import { alertDetail, alertHref } from './critical-alerts';

/**
 * The banner's links are rebuilt from this app's route table, never taken
 * from the body as given; an unknown path falls back to the kind's list so
 * the alert is kept.
 */

describe('alertHref', () => {
  it.each([
    ['unreviewed-critical-lab', '/doctor/labs/LAB-7731', '/doctor/labs/LAB-7731'],
    ['allergy-conflict', '/doctor/appointments', '/doctor/appointments'],
    ['urgent-reschedule', '/doctor/appointments/APT-2209', '/doctor/appointments/APT-2209'],
  ] as const)('follows a %s path it knows: %s', (kind, path, href) => {
    expect(alertHref(kind, path)).toBe(href);
  });

  it.each([
    ['unreviewed-critical-lab', '//evil.example/doctor/labs/1', '/doctor/labs'],
    ['unreviewed-critical-lab', 'javascript:alert(1)', '/doctor/labs'],
    ['unreviewed-critical-lab', '/doctor/labs/1?next=https://evil.example', '/doctor/labs'],
    ['allergy-conflict', '/admin/patients', '/doctor/appointments'],
    // Its action reads "Open today's appointments"; a chart link would belie it.
    ['allergy-conflict', '/doctor/patients/PT-1003', '/doctor/appointments'],
    ['urgent-reschedule', '/doctor/appointments', '/doctor/appointments'],
    ['urgent-reschedule', '/doctor/labs/LAB-1', '/doctor/appointments'],
  ] as const)('falls back for a %s path it does not: %s', (kind, path, href) => {
    expect(alertHref(kind, path)).toBe(href);
  });
});

describe('alertDetail', () => {
  const now = new Date('2026-10-04T10:00:00Z').getTime();

  it('ages a lab by when it was ordered', () => {
    expect(alertDetail('unreviewed-critical-lab', '2026-10-01T10:00:00Z', now)).toBe(
      'Ordered 3 d ago',
    );
  });

  it('gives a moved appointment its new time, not an age', () => {
    expect(alertDetail('urgent-reschedule', '2026-10-04T15:30:00Z', now)).toMatch(/^Now \S/);
  });

  it('shows nothing for a conflict, whose instant is only the answer’s', () => {
    expect(alertDetail('allergy-conflict', '2026-10-04T10:00:00Z', now)).toBeNull();
  });
});
