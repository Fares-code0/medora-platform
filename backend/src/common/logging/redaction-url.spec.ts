import { describe, expect, it } from 'vitest';

import { loggableUrl } from './redaction';

describe('loggableUrl', () => {
  it.each([
    ['/api/v1/patients?q=Mona%20Adel', '/api/v1/patients'],
    ['/api/v1/patients/PT-1001/profile', '/api/v1/patients/PT-1001/profile'],
    ['/api/v1/search?q=a?b', '/api/v1/search'],
    ['', ''],
  ])('logs %s as %s', (url, expected) => {
    expect(loggableUrl(url)).toBe(expected);
  });

  it('passes an absent URL through as absent', () => {
    expect(loggableUrl(undefined)).toBeUndefined();
  });
});
