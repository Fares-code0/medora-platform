import { Linking, Platform } from 'react-native';

import { logger } from '@/utils/logger';

/**
 * Placing a call, opening a map, and opening a web page.
 *
 * ── Why `tel:` and not `telprompt:` on iOS ───────────────────────────
 * `telprompt:` shows the OS's own confirmation. That sounds safer and is
 * not, for this screen: the app has ALREADY confirmed (`ConfirmSheet`,
 * naming the number), and a second dialog trains people to dismiss
 * dialogs. `tel:` on iOS also shows a system prompt before connecting, so
 * a patient still gets a final chance; what they do not get is two of our
 * own.
 *
 * ── Android ──────────────────────────────────────────────────────────
 * `tel:` opens the dialler with the number entered and does NOT place the
 * call. The patient presses the dialler's own call button. That is the
 * safer of the two Android options and the reason `CALL_PHONE` is
 * declared but never used to auto-dial.
 *
 * ── Failure ──────────────────────────────────────────────────────────
 * `openURL` rejects on a device with no dialler — a tablet, an emulator.
 * The caller shows the number as selectable text so it can still be read
 * aloud to someone else. It never throws at the patient.
 */

/** Everything a dial string may legally contain. */
const DIALABLE = /^[0-9+*#()\-.\s]{2,24}$/;

/**
 * Rejects anything that is not a phone number before it becomes a URL.
 *
 * The number comes from operator configuration over the network (BE-11),
 * so it is untrusted input, and `Linking.openURL` will happily open
 * whatever scheme it is handed. A configuration value that arrived as
 * `sms:...` or a deep link must not become a tap target on the Emergency
 * screen.
 */
export function isDialable(value: string): boolean {
  return DIALABLE.test(value.trim());
}

export async function dial(number: string): Promise<boolean> {
  if (!isDialable(number)) {
    // Never log the number itself — it is operator configuration, and the
    // logger's deny-list would redact it anyway.
    logger.error('Refused to dial a value that is not a phone number');
    return false;
  }
  const url = `tel:${number.replace(/\s/g, '')}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    logger.warn('No dialler is available on this device');
    return false;
  }
}

/**
 * True for an `https:` URL and nothing else.
 *
 * The same argument `isDialable` makes, about a different field. A
 * clinic's website arrives from operator configuration over the network
 * (BE-11) and `Linking.openURL` opens whatever scheme it is handed, so a
 * settings row containing `javascript:`, `medora://` or an `intent:` must
 * not become a tap target. `http:` is refused too: a page a patient is
 * sent to from a healthcare app should not be downgraded, and the only
 * reason to allow it is to accommodate a clinic that has not configured
 * TLS — which is a configuration to fix, not to render.
 *
 * `env.ts` applies the same rule at boot to `termsUrl`, `privacyUrl` and
 * `appStoreUrl`. This is the runtime half, for values that never pass
 * through `env`.
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Opens a web page in the patient's browser.
 *
 * Returns false rather than throwing, like `dial`: a screen that cannot
 * open a page still has to render. The URL is never logged — it is
 * operator configuration and a misconfigured value can carry anything.
 */
export async function openWebsite(url: string): Promise<boolean> {
  if (!isHttpsUrl(url)) {
    logger.error('Refused to open a configured link that is not an https URL');
    return false;
  }
  try {
    await Linking.openURL(url.trim());
    return true;
  } catch {
    logger.warn('No browser is available on this device');
    return false;
  }
}

/**
 * Hands an address to the OS maps app (checklist H-02, Q-03).
 *
 * Built from the address STRING, not from coordinates — there are no geo
 * columns anywhere in the Medora schema (audit §8) and there is no
 * location permission involved. This works with location denied, which is
 * exactly what Q-02 requires.
 */
export async function openMap(addressLine: string): Promise<boolean> {
  const query = encodeURIComponent(addressLine);
  const url = Platform.select({
    ios: `maps://?q=${query}`,
    android: `geo:0,0?q=${query}`,
    default: `https://maps.google.com/?q=${query}`,
  });
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    logger.warn('No maps application is available on this device');
    return false;
  }
}
