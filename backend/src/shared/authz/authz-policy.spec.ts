import { describe, expect, it } from 'vitest';

import { ADMIN_DENIED_PHI, ADMIN_ONLY, categoryOf, ceilingFor } from './authz-policy';

describe('category ceilings are distinct allow-lists (audit F-13)', () => {
  const categories = ['admin', 'doctor', 'nurse', 'reception', 'laboratory', 'pharmacy'] as const;

  it('gives no two categories the same ceiling', () => {
    const shapes = categories.map((category) => [...ceilingFor(category)].sort().join(','));
    expect(new Set(shapes).size).toBe(categories.length);
  });

  it('keeps authoring and prescribing to doctors', () => {
    for (const category of categories) {
      const ceiling = ceilingFor(category);
      expect(ceiling.has('records.edit'), category).toBe(category === 'doctor');
      expect(ceiling.has('prescriptions.create'), category).toBe(category === 'doctor');
    }
  });

  it('keeps platform administration to admins, and standing PHI away from them', () => {
    for (const category of categories) {
      for (const capability of ADMIN_ONLY) {
        expect(ceilingFor(category).has(capability), `${category} × ${capability}`).toBe(category === 'admin');
      }
    }
    for (const capability of ADMIN_DENIED_PHI) expect(ceilingFor('admin').has(capability)).toBe(false);
  });

  it('gives a capability no category lists to nobody (closed by default)', () => {
    for (const category of categories) expect(ceilingFor(category).has('communications.viewContent')).toBe(false);
  });

  it('caps a custom role by its base category, and gives a role without one nothing', () => {
    expect(ceilingFor(categoryOf('ward_clerk', 'reception'))).toEqual(ceilingFor('reception'));
    expect(ceilingFor(categoryOf('rogue', 'admin')).size).toBe(0);
  });
});
