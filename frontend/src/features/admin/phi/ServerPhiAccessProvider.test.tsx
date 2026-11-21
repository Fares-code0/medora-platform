import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MaskedIdentifier } from './MaskedIdentifier';
import { usePhiAccess } from './phi-context';
import { ServerPhiAccessProvider } from './ServerPhiAccessProvider';

/**
 * The PHI gate a production build mounts (RM M40.5).
 *
 * The claim is that the browser is never the authority for a reveal: there is
 * no grant to hold, no log to write, and nothing stored that a reload or a
 * cleared localStorage could change. The demo gate (`PhiAccessProvider`) is
 * tested on its own; this one must not be able to reveal at all.
 */

afterEach(() => {
  window.localStorage.clear();
});

function Identifier() {
  return (
    <MaskedIdentifier
      subjectId="pt-1"
      subjectLabel="Queue ticket A-104"
      kind="mrn"
      value="4411-27"
    />
  );
}

describe('ServerPhiAccessProvider', () => {
  it('keeps the identifier masked and offers no reveal', () => {
    render(
      <ServerPhiAccessProvider>
        <Identifier />
      </ServerPhiAccessProvider>,
    );

    expect(screen.queryByText(/4411-27/)).toBeNull();
    expect(screen.getByText(/masked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });

  it('cannot be talked into a reveal: requestReveal records and grants nothing', () => {
    let gate: ReturnType<typeof usePhiAccess> | null = null;
    function Probe() {
      gate = usePhiAccess();
      return null;
    }
    render(
      <ServerPhiAccessProvider>
        <Probe />
      </ServerPhiAccessProvider>,
    );

    expect(gate).not.toBeNull();
    const value = gate as unknown as ReturnType<typeof usePhiAccess>;
    value.requestReveal('pt-1', 'Queue ticket A-104');
    expect(value.canReveal).toBe(false);
    expect(value.isRevealed('pt-1')).toBe(false);
    expect(value.grantOf('pt-1')).toBeUndefined();
    // Nothing in this browser stands for the access: no key was written.
    expect(window.localStorage.length).toBe(0);
  });

  it('answers the same after a reload and after localStorage is cleared', () => {
    window.localStorage.setItem('medora.admin.clinic.v1', '{"phiAccess":[{"subjectId":"pt-1"}]}');
    const first = render(
      <ServerPhiAccessProvider>
        <Identifier />
      </ServerPhiAccessProvider>,
    );
    expect(screen.queryByText(/4411-27/)).toBeNull();
    first.unmount();

    window.localStorage.clear();
    render(
      <ServerPhiAccessProvider>
        <Identifier />
      </ServerPhiAccessProvider>,
    );
    expect(screen.queryByText(/4411-27/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });
});
