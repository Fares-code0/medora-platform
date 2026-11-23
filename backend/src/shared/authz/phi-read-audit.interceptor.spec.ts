import { describe, expect, it } from 'vitest';

import { phiCapabilitiesOf } from './phi-read-audit.interceptor';

describe('phiCapabilitiesOf', () => {
  it('selects only PHI capabilities from a route rule', () => {
    expect(phiCapabilitiesOf(['patients.view', 'records.view', 'labs.review'])).toEqual([
      'records.view',
      'labs.review',
    ]);
  });

  it('is empty for non-PHI or unrestricted routes', () => {
    expect(phiCapabilitiesOf(['appointments.manageOwn'])).toEqual([]);
    expect(phiCapabilitiesOf(undefined)).toEqual([]);
  });
});
