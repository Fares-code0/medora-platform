import type React from 'react';

import { act, waitFor } from '@testing-library/react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { appointmentService } from '@/features/appointments/service';
import { clinicService } from '@/features/clinic/service';
import { doctorService } from '@/features/doctors/service';
import { emergencyService } from '@/features/emergency/service';
import { healthService } from '@/features/health/service';
import { activityService } from '@/features/home/service';
import { hospitalService } from '@/features/hospitals/service';
import { messagingService } from '@/features/messages/service';
import { notificationService } from '@/features/notifications/service';
import { profileService } from '@/features/profile/service';
import type { MessageKey } from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { SCREENS, hostedScreen, mockNavigation } from '@/test/screens';

/**
 * **What a release build actually shows a patient today** — audit §12,
 * checklist R-01…R-04, and the honesty rule in §29 of the brief.
 *
 * ── The state this tree is really in ─────────────────────────────────
 *
 * Most of this app's features are 🟨: built over fixtures behind the
 * service seam, with an `http` adapter that refuses by name because the
 * endpoint does not exist. Every test in the suite runs with
 * `EXPO_PUBLIC_ENABLE_MOCKS=true`, so every test renders the *development*
 * app. Nothing rendered the one a patient would get.
 *
 * This does. Every method of every feature service rejects with
 * `EndpointNotImplementedError` — exactly what `unavailableService`
 * produces — and then all 26 screens are mounted and asked three
 * questions:
 *
 * 1. **Does it survive?** A rejected query must not take the screen down.
 *    A crash here is a white screen on a phone.
 * 2. **Is there still a heading?** `A11Y_AUDIT` F-7 fixed four screens
 *    whose only heading lived in the success branch. The loading state is
 *    covered by `screen-headings.test.tsx`; this is the *failed* state,
 *    which is the one production is permanently in.
 * 3. **Does it stop?** No skeleton may survive a settled query. An
 *    endless skeleton over a refused endpoint is R-01's failure — the
 *    screen says "a list is coming" about a list that is not coming, and
 *    a patient waits rather than knowing.
 *
 * ── What it deliberately does not assert ─────────────────────────────
 *
 * Not the copy. `ErrorState` owns the wording for a missing endpoint and
 * `component-states.test.tsx` owns the assertions about it. Nor that
 * every screen shows an error: Home's two sections render **nothing** on
 * a failure on purpose (F-06, F-08), which is a decision those components
 * argue for and not a state to be flattened here.
 */

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('react') as typeof React).useEffect(effect, [effect]);
  },
}));

/**
 * Every feature service, with the capability its refusal would name.
 *
 * The capability is a catalogue KEY rather than a sentence: `ErrorState`
 * interpolates it into a translated line, and an English string here
 * produced a half-translated refusal. `api/seam.ts` carries the reasoning.
 */
const SERVICES: readonly (readonly [MessageKey, object])[] = [
  ['capability.messages', appointmentService],
  ['capability.clinic', hospitalService],
  ['capability.clinic', clinicService],
  ['capability.departments', doctorService],
  ['capability.clinic', emergencyService],
  ['capability.healthRecords', healthService],
  ['capability.recentActivity', activityService],
  ['capability.messages', messagingService],
  // Notifications no longer refuse in production (O-06 went live on
  // 2026-11-01), and `capability.notificationSettings` went with that.
  // The service is still refused here so the notification screens' failed
  // state stays covered; the label is not asserted.
  ['capability.messages', notificationService],
  ['capability.profileEdit', profileService],
];

const installed: { mockRestore: () => void }[] = [];

beforeEach(() => {
  for (const [capability, service] of SERVICES) {
    for (const method of Object.keys(service)) {
      const spy = jest
        .spyOn(service as Record<string, never>, method as never)
        .mockImplementation((() =>
          Promise.reject(new EndpointNotImplementedError('BE-00', capability))) as never);
      installed.push(spy);
    }
  }
});

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function collectTestIds(node: unknown, found: string[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectTestIds(child, found);
    return;
  }
  const element = node as { props?: Record<string, unknown>; children?: unknown };
  const id = element.props?.['testID'];
  if (typeof id === 'string') found.push(id);
  collectTestIds(element.children, found);
}

function hasHeading(node: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => hasHeading(child));
  const element = node as { props?: Record<string, unknown>; children?: unknown };
  if (element.props?.['accessibilityRole'] === 'header') return true;
  return hasHeading(element.children);
}

describe('every screen survives a backend that refuses', () => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]));

    /**
     * Waited for rather than flushed a fixed number of times. Screens
     * differ in how many commits a rejection takes — a second query that
     * depends on the first, a boundary inside a section — and counting
     * `act`s produces a test that passes on an idle machine and reports
     * a screen as stuck on a busy one. `waitFor` asks the real question:
     * does it *stop*?
     *
     * An endless skeleton over a query that has already failed is R-01's
     * failure — the screen promises a list that is not coming, so a
     * patient waits instead of knowing.
     */
    await waitFor(() => {
      const ids: string[] = [];
      collectTestIds(view.toJSON(), ids);
      expect(ids.filter((id) => id.endsWith('-loading'))).toEqual([]);
    });

    // `A11Y_AUDIT` F-7 in the state production is permanently in.
    expect({ screen: name, heading: hasHeading(view.toJSON()) }).toEqual({
      screen: name,
      heading: true,
    });

    // Settle anything still in flight so the worker is not left with a
    // pending state update.
    await act(async () => undefined);
  });
});
