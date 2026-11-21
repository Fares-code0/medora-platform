import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { SEED_SETTINGS } from '../model/mock-data';
import { settingsService } from '../service';

import {
  TwoFactorDisableDialog,
  TwoFactorEnrolDialog,
  TwoFactorReenrollDialog,
} from './TwoFactorDialogs';

/**
 * Two-factor against the server's flow (FE-10.9): nothing is switched on
 * until a code checks out, and a refused code or password is said in words
 * the doctor can act on.
 */

const LOAD = { timeout: 5000 };

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rejectWith = (code: string) =>
  Object.assign(new Error('API error: auth'), { kind: 'auth', code });

/** Owner decision D2: the enrolment dialog opens on the password step. */
async function passPasswordStep(password = 'my password') {
  await userEvent.type(await screen.findByLabelText('Your password', undefined, LOAD), password);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('TwoFactorEnrolDialog', () => {
  it('shows the key, and turns two-factor on only with a code from the app', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['aaaa-bbbb'],
    });
    const enable = vi.spyOn(settingsService, 'enableTwoFactor').mockResolvedValue(SEED_SETTINGS);
    const onEnabled = vi.fn();
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={onEnabled} />
      </AppProviders>,
    );

    await passPasswordStep();

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('aaaa-bbbb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Code from the app/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(enable).toHaveBeenCalledWith(expect.any(String), '123456');
    expect(onEnabled).toHaveBeenCalled();
  });

  it('says so when the code does not match, and turns nothing on', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: [],
    });
    vi.spyOn(settingsService, 'enableTwoFactor').mockRejectedValue(rejectWith('otp_invalid'));
    const onEnabled = vi.fn();
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={onEnabled} />
      </AppProviders>,
    );

    await passPasswordStep();
    await userEvent.type(
      await screen.findByLabelText(/Code from the app/, undefined, LOAD),
      '000000',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText(/That code did not match/, undefined, LOAD)).toBeInTheDocument();
    expect(onEnabled).not.toHaveBeenCalled();
  });
});

describe('TwoFactorEnrolDialog — the current password first (owner decision D2)', () => {
  const ENROLMENT = {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUrl: 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP',
    recoveryCodes: ['aaaa-bbbb'],
  };

  it('asks for the password and starts nothing until it is given', async () => {
    const begin = vi.spyOn(settingsService, 'beginTwoFactorSetup').mockResolvedValue(ENROLMENT);
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={vi.fn()} />
      </AppProviders>,
    );

    expect(await screen.findByLabelText('Your password', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(begin).not.toHaveBeenCalled();
    expect(screen.queryByText('JBSW Y3DP EHPK 3PXP')).not.toBeInTheDocument();

    await passPasswordStep('my password');

    expect(begin).toHaveBeenCalledWith(expect.any(String), 'my password');
    expect(await screen.findByText('aaaa-bbbb', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
  });

  it('reports a wrong password and shows no key or recovery code', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockRejectedValue(
      rejectWith('invalid_credentials'),
    );
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={vi.fn()} />
      </AppProviders>,
    );

    await passPasswordStep('wrong');

    expect(
      await screen.findByText('That password is not correct.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText(/JBSW/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Code from the app/)).not.toBeInTheDocument();
    // The password field is cleared for another try.
    expect(screen.getByLabelText('Your password')).toHaveValue('');
  });

  it('on lockout says this session is over and ends it on close', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        code: 'rate_limited',
      }),
    );
    const onSignedOut = vi.fn();
    const onClose = vi.fn();
    render(
      <AppProviders>
        <TwoFactorEnrolDialog
          open
          onClose={onClose}
          onEnabled={vi.fn()}
          onSignedOut={onSignedOut}
        />
      </AppProviders>,
    );

    await passPasswordStep('wrong');

    expect(
      await screen.findByText(/this session has been signed out/, undefined, LOAD),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onSignedOut).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('TwoFactorDisableDialog', () => {
  it('needs the password, and reports a wrong one', async () => {
    vi.spyOn(settingsService, 'disableTwoFactor').mockRejectedValue(
      rejectWith('invalid_credentials'),
    );
    const onDisabled = vi.fn();
    render(
      <AppProviders>
        <TwoFactorDisableDialog open onClose={vi.fn()} onDisabled={onDisabled} />
      </AppProviders>,
    );

    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(
      await screen.findByText('That password is not correct.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(onDisabled).not.toHaveBeenCalled();
  });
});

describe('TwoFactorDisableDialog — the lockout response (owner decision D1)', () => {
  it('says the account is locked and the session ended, and signs out on close', async () => {
    vi.spyOn(settingsService, 'disableTwoFactor').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        code: 'rate_limited',
        retryAfterSeconds: 900,
      }),
    );
    const onSignedOut = vi.fn();
    const onClose = vi.fn();
    const onDisabled = vi.fn();
    render(
      <AppProviders>
        <TwoFactorDisableDialog
          open
          onClose={onClose}
          onDisabled={onDisabled}
          onSignedOut={onSignedOut}
        />
      </AppProviders>,
    );

    await userEvent.type(screen.getByLabelText('Your password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(
      await screen.findByText(
        /temporarily locked and this session has been signed out/,
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    // Not "still on": that implied the session was usable for another try.
    expect(screen.queryByText('Two-factor authentication is still on.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    // A second click (or Esc) before the dialog goes away ends nothing twice.
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onDisabled).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a 429 without the server’s code (a proxy’s)',
      { kind: 'rate_limited', retryAfterSeconds: 30 },
    ],
    ['a server failure', { kind: 'server', ref: 'ref-1' }],
  ])('%s is not the lockout: the dialog stays usable, no sign-out', async (_name, failure) => {
    vi.spyOn(settingsService, 'disableTwoFactor').mockRejectedValue(
      Object.assign(new Error('API error'), failure),
    );
    const onSignedOut = vi.fn();
    const onClose = vi.fn();
    render(
      <AppProviders>
        <TwoFactorDisableDialog
          open
          onClose={onClose}
          onDisabled={vi.fn()}
          onSignedOut={onSignedOut}
        />
      </AppProviders>,
    );

    await userEvent.type(screen.getByLabelText('Your password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(
      await screen.findByText('Two-factor authentication is still on.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText(/temporarily locked/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your password')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it on' }));
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a wrong password below the limit does not sign out', async () => {
    vi.spyOn(settingsService, 'disableTwoFactor').mockRejectedValue(
      rejectWith('invalid_credentials'),
    );
    const onSignedOut = vi.fn();
    const onClose = vi.fn();
    render(
      <AppProviders>
        <TwoFactorDisableDialog
          open
          onClose={onClose}
          onDisabled={vi.fn()}
          onSignedOut={onSignedOut}
        />
      </AppProviders>,
    );

    await userEvent.type(screen.getByLabelText('Your password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await screen.findByText('That password is not correct.', undefined, LOAD);
    await userEvent.click(screen.getByRole('button', { name: 'Keep it on' }));

    expect(onSignedOut).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('the enrolment link is followed only as otpauth://', () => {
  it('renders no link for a server URL with another scheme, and still shows the key', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'javascript:alert(document.domain)',
      recoveryCodes: [],
    });
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={vi.fn()} />
      </AppProviders>,
    );
    await passPasswordStep();

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP', undefined, LOAD)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open in an authenticator app on this device' }),
    ).not.toBeInTheDocument();
  });

  it('renders the link for an otpauth URL', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorSetup').mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: [],
    });
    render(
      <AppProviders>
        <TwoFactorEnrolDialog open onClose={vi.fn()} onEnabled={vi.fn()} />
      </AppProviders>,
    );
    await passPasswordStep();

    expect(
      await screen.findByRole(
        'link',
        { name: 'Open in an authenticator app on this device' },
        LOAD,
      ),
    ).toHaveAttribute('href', 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP');
  });
});

describe('TwoFactorReenrollDialog (owner decision Q7 / R4)', () => {
  const STARTED = {
    secret: 'NEWSECRETNEWSECR',
    otpauthUrl: 'otpauth://totp/Medora:doctor?secret=NEWSECRETNEWSECR',
    enrolmentToken: 'enrol.jwt.token',
  };

  function renderDialog(handlers: { onReplaced?: () => void; onSignedOut?: () => void } = {}) {
    render(
      <AppProviders>
        <TwoFactorReenrollDialog
          open
          onClose={vi.fn()}
          onReplaced={handlers.onReplaced ?? vi.fn()}
          onSignedOut={handlers.onSignedOut ?? vi.fn()}
        />
      </AppProviders>,
    );
  }

  async function proveCurrentFactor() {
    await userEvent.type(
      await screen.findByLabelText('Your password', undefined, LOAD),
      'Medora123!',
    );
    await userEvent.type(screen.getByLabelText(/Code from your current app/), '111111');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('needs the password and the current code, then a code from the new app, then shows the new codes once', async () => {
    const begin = vi
      .spyOn(settingsService, 'beginTwoFactorReenrollment')
      .mockResolvedValue(STARTED);
    const confirm = vi
      .spyOn(settingsService, 'confirmTwoFactorReenrollment')
      .mockResolvedValue(['0a1b2-c3d4e', '5f6a7-b8c9d']);
    const onReplaced = vi.fn();
    renderDialog({ onReplaced });

    expect(await screen.findByRole('button', { name: 'Continue' }, LOAD)).toBeDisabled();
    await proveCurrentFactor();
    expect(begin).toHaveBeenCalledWith(expect.any(String), {
      password: 'Medora123!',
      code: '111111',
    });

    expect(await screen.findByText('NEWS ECRE TNEW SECR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace authenticator' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Code from the new app/), '222222');
    await userEvent.click(screen.getByRole('button', { name: 'Replace authenticator' }));

    expect(confirm).toHaveBeenCalledWith(expect.any(String), {
      enrolmentToken: 'enrol.jwt.token',
      code: '222222',
    });
    expect(await screen.findByText('0a1b2-c3d4e')).toBeInTheDocument();
    expect(screen.getByText('5f6a7-b8c9d')).toBeInTheDocument();
    expect(onReplaced).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('names a code that does not match the current app, and replaces nothing', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorReenrollment').mockRejectedValue(
      rejectWith('otp_invalid'),
    );
    const confirm = vi.spyOn(settingsService, 'confirmTwoFactorReenrollment');
    renderDialog();

    await proveCurrentFactor();

    expect(
      await screen.findByText('That code did not match your current authenticator app.'),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('names a wrong password', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorReenrollment').mockRejectedValue(
      rejectWith('invalid_credentials'),
    );
    renderDialog();

    await proveCurrentFactor();

    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument();
  });

  it('treats the lockout as the end of the session, which the server revoked', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorReenrollment').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        code: 'rate_limited',
        retryAfterSeconds: 900,
      }),
    );
    const onSignedOut = vi.fn();
    renderDialog({ onSignedOut });

    await proveCurrentFactor();

    expect(
      await screen.findByText(
        'Too many failed attempts. For your security this session has been signed out.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('starts again when the enrolment expired before it was confirmed', async () => {
    vi.spyOn(settingsService, 'beginTwoFactorReenrollment').mockResolvedValue(STARTED);
    vi.spyOn(settingsService, 'confirmTwoFactorReenrollment').mockRejectedValue(
      rejectWith('token_invalid'),
    );
    renderDialog();

    await proveCurrentFactor();
    await userEvent.type(await screen.findByLabelText(/Code from the new app/), '222222');
    await userEvent.click(screen.getByRole('button', { name: 'Replace authenticator' }));

    expect(
      await screen.findByText('This replacement expired before it was confirmed. Start again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your password')).toHaveValue('');
  });
});
