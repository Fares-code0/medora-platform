import { act } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { apiClient } from '@/api/client';
import { renderWithProviders } from '@/test/render';

import { UpgradeGate } from './UpgradeGate';
import { MINIMUM_VERSION_HEADER } from './version';

/**
 * What the forced-upgrade gate does to Emergency, pinned as it is.
 *
 * `UpgradeGate` replaces the whole tree when tripped, so the Emergency
 * SCREEN is not reachable behind it — by design, see its header note: a
 * build the operator has withdrawn is not trusted to render guidance, and
 * the blocking screen carries the "use your phone's dialler" line itself.
 * The guarantee that matters, and the one asserted here, is that a gated
 * patient is never left without emergency guidance; the unconfirmed-state
 * stack reaches the Emergency screen (session-restore.test.tsx, "keeps
 * Emergency one tap away"), and the gate is not in that path while the
 * build is supported.
 */

function raiseFloor(): void {
  const observers = (apiClient as unknown as { responseObservers: Set<(h: Headers) => void> })
    .responseObservers;
  act(() => {
    for (const observer of [...observers]) {
      observer(new Headers({ [MINIMUM_VERSION_HEADER]: '999.0.0' }));
    }
  });
}

describe('UpgradeGate and Emergency', () => {
  it('passes the app, Emergency included, through while the build is supported', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <UpgradeGate>
        <RNText testID="emergency-screen">emergency</RNText>
      </UpgradeGate>,
    );
    expect(getByTestId('emergency-screen')).toBeTruthy();
    expect(queryByTestId('upgrade-required-screen')).toBeNull();
  });

  it('when tripped, never leaves the patient without emergency guidance', () => {
    const { getByTestId, queryByTestId, getByText } = renderWithProviders(
      <UpgradeGate>
        <RNText testID="emergency-screen">emergency</RNText>
      </UpgradeGate>,
    );

    raiseFloor();

    expect(getByTestId('upgrade-required-screen')).toBeTruthy();
    expect(queryByTestId('emergency-screen')).toBeNull();
    expect(getByText(/local emergency number/)).toBeTruthy();
  });
});
