import { describe, expect, it } from 'vitest';

import { bypassReasons } from './runtime-role.check';

describe('bypassReasons', () => {
  it('accepts a non-owner, non-superuser role without BYPASSRLS', () => {
    expect(bypassReasons({ role: 'app', superuser: false, bypassRls: false, ownedTables: 0 })).toEqual([]);
  });

  it('names every way a role would bypass RLS', () => {
    expect(bypassReasons({ role: 'medora', superuser: true, bypassRls: true, ownedTables: 3 })).toEqual([
      'is a superuser',
      'has BYPASSRLS',
      'owns 3 table(s)',
    ]);
  });
});
