import { describe, expect, it } from 'vitest';

import { routeTransitionKey } from './route-transition-key';

describe('routeTransitionKey', () => {
  it('is the pathname for an ordinary page', () => {
    expect(routeTransitionKey('/doctor/overview')).toBe('/doctor/overview');
    expect(routeTransitionKey('/admin/doctors/doc_1')).toBe('/admin/doctors/doc_1');
  });

  it('is one key across every category of a settings center', () => {
    expect(routeTransitionKey('/doctor/settings/profile')).toBe('/doctor/settings');
    expect(routeTransitionKey('/doctor/settings/security')).toBe('/doctor/settings');
    expect(routeTransitionKey('/admin/preferences/appearance')).toBe('/admin/preferences');
    expect(routeTransitionKey('/admin/settings')).toBe('/admin/settings');
    expect(routeTransitionKey('/admin/settings/users')).toBe('/admin/settings');
  });

  it('keeps the three settings centers apart from each other', () => {
    expect(routeTransitionKey('/admin/preferences/profile')).not.toBe(
      routeTransitionKey('/admin/settings/general'),
    );
  });

  it('does not swallow a sibling whose path merely starts the same way', () => {
    expect(routeTransitionKey('/admin/settings-archive')).toBe('/admin/settings-archive');
  });
});
