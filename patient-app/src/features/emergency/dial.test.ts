import { Linking } from 'react-native';

import { dial, isDialable, isHttpsUrl, openMap, openWebsite } from './dial';

/**
 * The three OS hand-offs, at the unit level.
 *
 * Every caller of these is already covered through a screen — Emergency,
 * Our Clinic, the consent screen — and those tests are the ones that
 * matter for behaviour. This file exists for the part a screen test
 * cannot reach cleanly: the **scheme allow-lists**, which are a security
 * boundary rather than a rendering decision.
 *
 * `Linking.openURL` opens whatever it is handed. Every value these
 * functions receive — a clinic's phone number, a clinic's website, a
 * configured emergency number — arrives from operator configuration over
 * the network (BE-11) and is therefore untrusted input. A settings row
 * that came back as `javascript:` or a deep link into another app must
 * not become a tap target, and the refusal has to be asserted
 * exhaustively rather than by example.
 */

describe('isDialable', () => {
  it.each(['112', '+962 6 400 0000', '(06) 400-0000', '911', '+1.555.0100'])(
    'accepts %s',
    (value) => {
      expect(isDialable(value)).toBe(true);
    },
  );

  it.each([
    'sms:+962790000000?body=hi',
    'tel:112',
    'medora://emergency',
    'javascript:alert(1)',
    'call the clinic',
    '',
    '1',
    '+9620000000000000000000000000',
  ])('refuses %s', (value) => {
    expect(isDialable(value)).toBe(false);
  });
});

describe('isHttpsUrl', () => {
  it.each([
    'https://example.org',
    'https://example.org/clinic/about',
    '  https://example.org  ',
    'https://example.org:8443/x?y=1#z',
  ])('accepts %s', (value) => {
    expect(isHttpsUrl(value)).toBe(true);
  });

  it.each([
    // Downgraded transport. A clinic that has not configured TLS is a
    // configuration to fix, not one to render a link for.
    'http://example.org',
    // Everything below is a different application, not a web page.
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'medora://profile',
    'intent://scan#Intent;scheme=zxing;end',
    'tel:112',
    'mailto:someone@example.org',
    // Not a URL at all.
    'example.org',
    'not a url',
    '',
  ])('refuses %s', (value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });
});

describe('openWebsite', () => {
  it('opens an https URL, trimmed', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await expect(openWebsite('  https://example.org/about  ')).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://example.org/about');
  });

  it('never reaches openURL with a refused scheme', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await expect(openWebsite('javascript:alert(1)')).resolves.toBe(false);
    // The guard is before the call, not a check of what came back.
    expect(openURL).not.toHaveBeenCalled();
  });

  it('returns false rather than throwing when there is no browser', async () => {
    // A screen that cannot open a page still has to render. `dial` makes
    // the same promise for the same reason.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no activity found'));

    await expect(openWebsite('https://example.org')).resolves.toBe(false);
  });
});

describe('dial and openMap keep their failure contract', () => {
  it('dial returns false on a device with no dialler', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no dialler'));

    await expect(dial('112')).resolves.toBe(false);
  });

  it('openMap returns false on a device with no maps app', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no maps'));

    await expect(openMap('22 Rainbow Street')).resolves.toBe(false);
  });

  it('openMap builds the query from the address, never from coordinates', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await openMap('22 Rainbow Street, Amman');

    const url = String(openURL.mock.calls[0]?.[0]);
    expect(url).toContain(encodeURIComponent('22 Rainbow Street, Amman'));
    // There are no geo columns anywhere in the schema, so a lat/long here
    // could only be invented.
    expect(url).not.toMatch(/-?\d+\.\d+,-?\d+\.\d+/);
  });
});
