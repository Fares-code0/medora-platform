import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking, Text as RNText } from 'react-native';

import { apiClient } from '@/api/client';
import { parseEnv } from '@/configs/env';
import { renderWithProviders } from '@/test/render';

import { UpgradeGate, UpgradeRequiredScreen, useUpgradeState } from './UpgradeGate';
import {
  compareVersions,
  CURRENT_APP_VERSION,
  decideUpgrade,
  formatVersion,
  MINIMUM_VERSION_HEADER,
  parseVersion,
} from './version';

/**
 * The forced-upgrade gate — checklist W-06.
 *
 * The assertions that matter are the ones about **failing open**. This is
 * the one mechanism in the app that can deliberately make itself
 * unusable, so every test below that expects `unknown` is testing that a
 * bad signal cannot brick an installed build. The gate may only ever
 * close on a value it actually understood.
 */

describe('version parsing', () => {
  it.each([
    ['1.2.3', { major: 1, minor: 2, patch: 3 }],
    ['0.0.0', { major: 0, minor: 0, patch: 0 }],
    ['10.20.30', { major: 10, minor: 20, patch: 30 }],
    // A store build carrying a pre-release or build suffix is still that
    // version for the purpose of "is this old enough to stop".
    ['1.2.3-beta.1', { major: 1, minor: 2, patch: 3 }],
    ['1.2.3+42', { major: 1, minor: 2, patch: 3 }],
    ['  1.2.3  ', { major: 1, minor: 2, patch: 3 }],
  ])('parses %s', (raw, expected) => {
    expect(parseVersion(raw)).toEqual(expected);
  });

  it.each([['1.2'], ['1'], [''], ['x.y.z'], ['1.2.z'], ['v1.2.3'], ['1.2.3.4'], ['-1.2.3']])(
    'refuses %s rather than guessing',
    (raw) => {
      expect(parseVersion(raw)).toBeNull();
    },
  );

  it('refuses a non-string', () => {
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('orders by major, then minor, then patch', () => {
    const v = (raw: string) => parseVersion(raw)!;
    expect(compareVersions(v('1.0.0'), v('2.0.0'))).toBeLessThan(0);
    expect(compareVersions(v('2.0.0'), v('1.9.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.2.0'), v('1.10.0'))).toBeLessThan(0);
    expect(compareVersions(v('1.2.3'), v('1.2.3'))).toBe(0);
  });

  it('formats back to the wire spelling', () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('reads a parseable version out of app.json', () => {
    // If this fails, the app cannot compare itself to anything and the
    // gate is permanently inert — a silent failure worth catching here.
    expect(parseVersion(CURRENT_APP_VERSION)).not.toBeNull();
  });
});

describe('the decision fails open on anything it cannot read', () => {
  it('is unknown when the server sends no header — which is today', () => {
    expect(decideUpgrade('1.0.0', null)).toBe('unknown');
    expect(decideUpgrade('1.0.0', undefined)).toBe('unknown');
    expect(decideUpgrade('1.0.0', '')).toBe('unknown');
  });

  it('is unknown on a malformed minimum, never a lockout', () => {
    // One bad deploy must not brick every installed copy at once.
    expect(decideUpgrade('1.0.0', 'soon')).toBe('unknown');
    expect(decideUpgrade('1.0.0', '2')).toBe('unknown');
    expect(decideUpgrade('1.0.0', '99999999999999999999.0.0')).toBe('unknown');
  });

  it('is unknown when the app cannot read its own version', () => {
    expect(decideUpgrade('not-a-version', '2.0.0')).toBe('unknown');
  });

  it('requires an upgrade only when this build is genuinely older', () => {
    expect(decideUpgrade('1.0.0', '2.0.0')).toBe('upgrade-required');
    expect(decideUpgrade('1.9.9', '2.0.0')).toBe('upgrade-required');
    expect(decideUpgrade('1.2.3', '1.2.4')).toBe('upgrade-required');
  });

  it('is supported at the floor and above it', () => {
    expect(decideUpgrade('2.0.0', '2.0.0')).toBe('supported');
    expect(decideUpgrade('2.0.1', '2.0.0')).toBe('supported');
    expect(decideUpgrade('3.0.0', '2.0.0')).toBe('supported');
  });
});

/** Drives the observers the way `ApiClient` does, without a network. */
function emit(headers: Record<string, string>): void {
  const observers = (apiClient as unknown as { responseObservers: Set<(h: Headers) => void> })
    .responseObservers;
  act(() => {
    for (const observer of [...observers]) observer(new Headers(headers));
  });
}

function Probe({ version }: { version: string }) {
  const state = useUpgradeState(version);
  return <RNText testID="state">{state}</RNText>;
}

describe('the gate observes ordinary responses', () => {
  it('starts unknown and stays unknown with no header', async () => {
    const { getByTestId } = render(<Probe version="1.0.0" />);
    expect(getByTestId('state').props.children).toBe('unknown');

    emit({ 'Content-Type': 'application/json' });
    await waitFor(() => expect(getByTestId('state').props.children).toBe('unknown'));
  });

  it('closes when a response raises the floor above this build', async () => {
    const { getByTestId } = render(<Probe version="1.0.0" />);
    emit({ [MINIMUM_VERSION_HEADER]: '2.0.0' });
    await waitFor(() => expect(getByTestId('state').props.children).toBe('upgrade-required'));
  });

  it('stays closed once tripped, whatever a later response says', async () => {
    const { getByTestId } = render(<Probe version="1.0.0" />);
    emit({ [MINIMUM_VERSION_HEADER]: '2.0.0' });
    await waitFor(() => expect(getByTestId('state').props.children).toBe('upgrade-required'));

    // A cached response, or a stale instance behind a rollout, must not
    // reopen a build the operator has closed.
    emit({});
    emit({ [MINIMUM_VERSION_HEADER]: '0.0.1' });
    await waitFor(() => expect(getByTestId('state').props.children).toBe('upgrade-required'));
  });

  it('detaches its observer on unmount', () => {
    const observers = (apiClient as unknown as { responseObservers: Set<unknown> })
      .responseObservers;
    const before = observers.size;

    const { unmount } = render(<Probe version="1.0.0" />);
    expect(observers.size).toBe(before + 1);

    unmount();
    expect(observers.size).toBe(before);
  });

  it('renders its children while the build is supported', () => {
    const { queryByTestId, getByTestId } = renderWithProviders(
      <UpgradeGate>
        <RNText testID="app-content">the app</RNText>
      </UpgradeGate>,
    );
    expect(getByTestId('app-content')).toBeTruthy();
    expect(queryByTestId('upgrade-required-screen')).toBeNull();
  });
});

describe('the blocking screen', () => {
  it('offers no way past it — no skip, no dismiss, no later', () => {
    const { getByTestId, queryByText } = renderWithProviders(<UpgradeRequiredScreen />);
    expect(getByTestId('upgrade-required-screen')).toBeTruthy();
    for (const escape of ['Later', 'Skip', 'Not now', 'Continue', 'Dismiss']) {
      expect(queryByText(escape)).toBeNull();
    }
  });

  it('says what to do in words when no store link is configured', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <UpgradeRequiredScreen storeUrl={null} />,
    );
    // Never a button that goes nowhere — the N-04 rule.
    expect(getByTestId('upgrade-no-store-link')).toBeTruthy();
    expect(queryByTestId('upgrade-open-store')).toBeNull();
  });

  it('opens the configured listing when there is one', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByTestId } = renderWithProviders(
      <UpgradeRequiredScreen storeUrl="https://example.test/medora" />,
    );
    fireEvent.press(getByTestId('upgrade-open-store'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://example.test/medora'));
  });

  it('points at the phone dialler for emergencies, not at this app', () => {
    // A build we have just declared unfit should not be routing an
    // emergency through its own screens.
    const { getByText } = renderWithProviders(<UpgradeRequiredScreen />);
    expect(getByText(/local emergency number/)).toBeTruthy();
  });
});

describe('the store URL is validated configuration, not a free string', () => {
  it('is null when unset', () => {
    expect(parseEnv({}).appStoreUrl).toBeNull();
  });

  it('is kept when it is a real URL', () => {
    expect(parseEnv({ EXPO_PUBLIC_APP_STORE_URL: 'https://example.test/app' }).appStoreUrl).toBe(
      'https://example.test/app',
    );
  });

  it('fails the build rather than shipping a broken button', () => {
    expect(() => parseEnv({ EXPO_PUBLIC_APP_STORE_URL: 'play-store' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it.each([['market://details?id=com.medora.patient'], ['itms-apps://apple.com/app/id1']])(
    'accepts the native store scheme %s',
    (url) => {
      expect(parseEnv({ EXPO_PUBLIC_APP_STORE_URL: url }).appStoreUrl).toBe(url);
    },
  );

  it.each([['javascript:alert(1)'], ['medora://appointments/1'], ['file:///etc/passwd']])(
    'refuses %s — openURL opens whatever it is handed',
    (url) => {
      // This is the only button on a screen the patient cannot navigate
      // away from, so a misconfiguration here is not recoverable in-app.
      expect(() => parseEnv({ EXPO_PUBLIC_APP_STORE_URL: url })).toThrow(
        /Invalid environment configuration/,
      );
    },
  );
});
