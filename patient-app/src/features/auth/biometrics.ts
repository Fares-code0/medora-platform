import * as LocalAuthentication from 'expo-local-authentication';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { logger } from '@/utils/logger';

import type { ForegroundAction } from './lock-policy';

/**
 * Biometric app-unlock (checklist D-15).
 *
 * ── What this protects, and what it does not ─────────────────────────
 * `SecurityScreen` used to carry a note saying a biometric gate would be
 * a **fake control**, because the refresh token stays in the keychain
 * whatever the screen shows. That note was right about the mechanism and
 * wrong about the threat, and this file is the resolution.
 *
 * It does **not** protect the token. Nothing here encrypts anything, and
 * a force-quit restores the session on the next cold start exactly as it
 * did before — the gate is not persisted, deliberately (see below). An
 * attacker who can read the keychain is unaffected by it.
 *
 * What it protects is **the screen**, against the threat patients
 * actually meet: a phone handed to somebody to look at a photo, left
 * unlocked on a desk, or picked up by a family member. Medora is
 * already open and already signed in, and T-11's five-minute sweep
 * empties the cache but leaves the session standing so a waiting room
 * does not sign anyone out. That is the window this closes.
 *
 * So it is layered on the real control rather than replacing it, which
 * is what the D-15 row means by *"gates the app, never the token"*, and
 * the toggle's own copy says so in the patient's words rather than
 * implying encryption.
 *
 * ── The password path always remains ─────────────────────────────────
 * Every lock screen offers "Use your password instead", which **ends the
 * session** and returns to Login. Not a bypass — the same
 * `endSession('locked')` T-11 uses. A patient whose fingerprint stops
 * being read (a cut, a wet hand, a failed sensor) must never be locked
 * out of their own records with no way forward, and on this app "no way
 * forward" would mean an uninstall.
 *
 * ── Why nothing about the lock is stored ─────────────────────────────
 * The locked flag lives in React state and dies with the process. A
 * persisted lock would have to remember *who* is locked out of it, and
 * `features/auth/storage.ts` refuses that in as many words: a
 * convenience field on a lock screen is a patient identifier on a lost
 * phone. The lock screen therefore names nobody — no name, no email, no
 * avatar. It says "Medora is locked" and nothing else.
 *
 * The only thing persisted is the patient's *preference*, a boolean.
 * That is not PHI and it is not an identifier, which is why it sits in
 * `PreferenceStore` beside the theme and the locale.
 */

/** What the device can do, as far as this app needs to know. */
export interface BiometricAvailability {
  /** Hardware exists AND the patient has enrolled something in the OS. */
  readonly usable: boolean;
  /**
   * What to call it on screen. `null` when nothing is usable — the
   * toggle is then hidden rather than shown disabled with an
   * explanation nobody asked for.
   */
  readonly label: 'Face ID' | 'Fingerprint' | 'Biometrics' | null;
}

export type BiometricOutcome =
  /** The OS confirmed the patient. */
  | 'success'
  /** The patient dismissed the prompt, or chose the password path. */
  | 'cancelled'
  /** The OS ran and said no — a wrong finger, too many attempts. */
  | 'failed'
  /** No hardware, nothing enrolled, or the module is unavailable. */
  | 'unavailable';

/**
 * The port. One method to ask what the device can do, one to ask it.
 *
 * A port rather than direct calls, for the reason `storage/ports.ts`
 * gives: the tests must be able to drive every branch — including
 * "sensor says no" and "patient cancelled" — and a native module cannot
 * be driven from Jest.
 */
export interface BiometricGate {
  check(): Promise<BiometricAvailability>;
  authenticate(prompt: string): Promise<BiometricOutcome>;
}

function labelFor(
  types: readonly LocalAuthentication.AuthenticationType[],
): BiometricAvailability['label'] {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Fingerprint';
  return 'Biometrics';
}

/** The real adapter. The only module in this tree that imports the SDK. */
export const expoBiometricGate: BiometricGate = {
  async check() {
    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !isEnrolled) return { usable: false, label: null };
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      return { usable: true, label: labelFor(types) };
    } catch {
      // A device where the module cannot answer is a device without
      // this feature. Never a crash, and never an error state: the
      // patient did not ask for anything.
      return { usable: false, label: null };
    }
  },

  async authenticate(prompt) {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: prompt,
        // No device passcode fallback. The OS passcode unlocks the
        // phone, and the phone is already unlocked — offering it here
        // would let exactly the person this gate exists to stop walk
        // straight through it.
        disableDeviceFallback: true,
        // The prompt's own cancel button, so the patient is never stuck
        // inside a system dialog with no way back to the password path.
        cancelLabel: 'Cancel',
      });
      if (result.success) return 'success';
      // `error` is an SDK code string, not free text and not PHI.
      switch (result.error) {
        case 'user_cancel':
        case 'system_cancel':
          return 'cancelled';
        // Nothing enrolled any more, no usable sensor, or no device
        // passcode (which the OS requires before it will run biometrics):
        // another attempt can never succeed, so the lock screen must point
        // at the password path rather than offer a retry.
        case 'not_enrolled':
        case 'not_available':
        case 'passcode_not_set':
          return 'unavailable';
        default:
          return 'failed';
      }
    } catch {
      return 'unavailable';
    }
  },
};

/** Reads the opt-in. Absent means off — this is opt-in, never default-on. */
export function isBiometricUnlockEnabled(): boolean {
  return preferenceStore.get(PREFERENCE_KEYS.biometricUnlock) === 'true';
}

export function setBiometricUnlockEnabled(enabled: boolean): void {
  preferenceStore.set(PREFERENCE_KEYS.biometricUnlock, enabled ? 'true' : 'false');
  logger.info('Biometric app-unlock preference changed', { biometricUnlock: enabled });
}

/**
 * Whether returning to the foreground should raise the lock.
 *
 * Pure, and takes the T-11 decision as its input rather than re-deriving
 * it: there is one place that decides what an absence means, and this
 * only says whether that meaning also implies a lock.
 *
 * - `sweep-phi` — the session is still standing and the cache has just
 *   been emptied, so the next thing the patient sees is a refetch of
 *   their records. This is the window the lock exists for.
 * - `reauthenticate` — the session has already ended. A lock in front of
 *   the login screen would ask for a fingerprint to reach a password
 *   field, which protects nothing.
 * - `none` — the patient glanced at a notification. Locking here is the
 *   behaviour that makes people turn the feature off.
 */
export function shouldLockOnForeground(action: ForegroundAction, enabled: boolean): boolean {
  return enabled && action === 'sweep-phi';
}
