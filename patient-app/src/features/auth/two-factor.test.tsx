import { fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { createTokenStorage } from '@/features/auth/storage';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { TwoFactorSetup } from './components/TwoFactorSetup';
import {
  disableTwoFactorFormSchema,
  enableTwoFactorFormSchema,
  setupTwoFactorFormSchema,
} from './schemas';
import { authService } from './service';
import { SessionProvider } from './SessionProvider';

/**
 * Two-factor enrolment — checklist D-16, U-02.
 *
 * Built against the three live `POST /me/2fa/*` routes, so these are
 * tests of a real contract rather than of a screen over a fixture. The
 * assertions that matter:
 *
 * - the recovery codes appear exactly once and never outlive the
 *   enrolment, because the server keeps them encrypted and never reads
 *   them back;
 * - turning 2FA OFF takes the password, not a code — someone holding the
 *   phone but not the password is who must not be able to remove it;
 * - the screen claims to know whether 2FA is on only when `GET /me/2fa`
 *   (owner decision R2, `backend` only) said so; where the route is
 *   absent it asserts nothing and offers both actions, as before.
 */

const ENROLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/Medora:sara@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Medora',
  recoveryCodes: ['1111-2222', '3333-4444'],
};

const installed: { mockRestore: () => void }[] = [];

function stub<
  K extends
    | 'setupTwoFactor'
    | 'enableTwoFactor'
    | 'disableTwoFactor'
    | 'twoFactorStatus'
    | 'startTwoFactorReenrollment'
    | 'confirmTwoFactorReenrollment',
>(method: K) {
  const spy = jest.spyOn(authService, method);
  installed.push(spy);
  return spy;
}

afterEach(() => {
  while (installed.length > 0) installed.pop()?.mockRestore();
});

type Screen = ReturnType<typeof renderWithProviders>;

/** Owner decision D2: "Set up" asks for the current password first. */
function startWithPassword(screen: Screen, password = 'Password1!') {
  fireEvent.press(screen.getByTestId('two-factor-start'));
  fireEvent.changeText(screen.getByTestId('two-factor-setup-password'), password);
  fireEvent.press(screen.getByTestId('two-factor-setup-continue'));
}

describe('the form schemas mirror the backend DTO', () => {
  it('takes exactly six digits, with the server’s own messages', () => {
    expect(enableTwoFactorFormSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(enableTwoFactorFormSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(enableTwoFactorFormSchema.safeParse({ code: '1234567' }).success).toBe(false);

    const letters = enableTwoFactorFormSchema.safeParse({ code: '12345a' });
    expect(letters.success).toBe(false);
    expect(letters.error?.issues[0]?.message).toBe('Code must be digits only');
  });

  it('accepts any non-empty password for disable, as `loginSchema` does', () => {
    // A policy check here would answer differently from a wrong
    // password, which tells an attacker something about a password they
    // do not have. Whether it MATCHES is the server's answer.
    expect(disableTwoFactorFormSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(disableTwoFactorFormSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('enrolling', () => {
  it('shows nothing secret until the patient asks to set up', () => {
    const { queryByTestId, getByTestId } = renderWithProviders(<TwoFactorSetup />);

    expect(getByTestId('two-factor-start')).toBeTruthy();
    expect(queryByTestId('two-factor-secret')).toBeNull();
    expect(queryByTestId('two-factor-recovery-codes')).toBeNull();
  });

  it('shows the key and the recovery codes once setup returns them', async () => {
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);

    expect(await screen.findByTestId('two-factor-secret')).toBeTruthy();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(screen.getByText('1111-2222')).toBeTruthy();
    expect(screen.getByText('3333-4444')).toBeTruthy();
  });

  it('hands the enrolment to the authenticator app rather than drawing a QR', async () => {
    // A patient cannot scan their own screen. `otpauth://` is the scheme
    // every authenticator registers, so one tap is the better path — and
    // it costs no dependency.
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);
    fireEvent.press(await screen.findByTestId('two-factor-open-app'));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(ENROLMENT.otpauthUrl));
    openURL.mockRestore();
  });

  it('sends the six digits and confirms, without saying anything about before', async () => {
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const enable = stub('enableTwoFactor').mockResolvedValue(undefined);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);
    fireEvent.changeText(await screen.findByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-confirm'));

    await waitFor(() => expect(enable).toHaveBeenCalledWith('123456'));
    expect(await screen.findByTestId('two-factor-notice')).toBeTruthy();
  });

  it('drops the recovery codes from memory once 2FA is on', async () => {
    // They have been written down or they have not. Keeping them on
    // screen afterwards is a second chance the server does not offer.
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    stub('enableTwoFactor').mockResolvedValue(undefined);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);
    fireEvent.changeText(await screen.findByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-confirm'));
    await screen.findByTestId('two-factor-notice');

    expect(screen.queryByTestId('two-factor-recovery-codes')).toBeNull();
    expect(screen.queryByText('1111-2222')).toBeNull();
  });

  it('keeps the enrolment on screen when the code is refused', async () => {
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    stub('enableTwoFactor').mockRejectedValue({
      kind: 'validation',
      code: 'otp_invalid',
      message: 'That code is not right.',
    });
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);
    fireEvent.changeText(await screen.findByTestId('two-factor-code'), '000000');
    fireEvent.press(screen.getByTestId('two-factor-confirm'));

    expect(await screen.findByTestId('two-factor-error')).toBeTruthy();
    // The codes are still needed: a rejected code is a retry, not a restart.
    expect(screen.getByTestId('two-factor-recovery-codes')).toBeTruthy();
  });
});

describe('the current password comes first (owner decision D2)', () => {
  it('requires a non-empty password, as the backend DTO does', () => {
    expect(setupTwoFactorFormSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(setupTwoFactorFormSchema.safeParse({ password: '' }).success).toBe(false);
  });

  it('asks for the password and calls nothing until it is submitted', () => {
    const setup = stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.press(screen.getByTestId('two-factor-start'));

    expect(screen.getByTestId('two-factor-setup-password')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-secret')).toBeNull();
    // The disable form is not on screen beside a second password field.
    expect(screen.queryByTestId('two-factor-password')).toBeNull();
    expect(setup).not.toHaveBeenCalled();
  });

  it('does not call the server with an empty password', async () => {
    const setup = stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.press(screen.getByTestId('two-factor-start'));
    fireEvent.press(screen.getByTestId('two-factor-setup-continue'));

    await waitFor(() => expect(screen.queryByTestId('two-factor-secret')).toBeNull());
    expect(setup).not.toHaveBeenCalled();
  });

  it('sends the password with setup', async () => {
    const setup = stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen, 'Password1!');

    await waitFor(() => expect(setup).toHaveBeenCalledWith('Password1!'));
    expect(await screen.findByTestId('two-factor-secret')).toBeTruthy();
  });

  it('reports a wrong password and shows no key or recovery code', async () => {
    stub('setupTwoFactor').mockRejectedValue({ kind: 'auth', code: 'invalid_credentials' });
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen, 'wrong');

    expect(await screen.findByTestId('two-factor-error')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-secret')).toBeNull();
    expect(screen.queryByTestId('two-factor-recovery-codes')).toBeNull();
    // Still on the password step, with the field cleared for another try.
    expect(screen.getByTestId('two-factor-setup-password').props.value).toBe('');
  });

  it('on a lockout reports it and leaves the password step', async () => {
    stub('setupTwoFactor').mockRejectedValue({
      kind: 'rate_limited',
      code: 'rate_limited',
      retryAfterSeconds: 900,
    });
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen, 'wrong');

    expect(await screen.findByTestId('two-factor-error')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-setup-password')).toBeNull();
    expect(screen.queryByTestId('two-factor-secret')).toBeNull();
  });

  it('cancelling the password step returns to the start', () => {
    const setup = stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.press(screen.getByTestId('two-factor-start'));
    fireEvent.press(screen.getByTestId('two-factor-setup-cancel'));

    expect(screen.getByTestId('two-factor-start')).toBeTruthy();
    expect(setup).not.toHaveBeenCalled();
  });
});

describe('turning it off', () => {
  it('sends the password, never a code', async () => {
    const disable = stub('disableTwoFactor').mockResolvedValue(undefined);
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.changeText(screen.getByTestId('two-factor-password'), 'Password1!');
    fireEvent.press(screen.getByTestId('two-factor-disable'));

    await waitFor(() => expect(disable).toHaveBeenCalledWith('Password1!'));
  });

  it('says that the other devices were signed out, because the server does that', async () => {
    stub('disableTwoFactor').mockResolvedValue(undefined);
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.changeText(screen.getByTestId('two-factor-password'), 'Password1!');
    fireEvent.press(screen.getByTestId('two-factor-disable'));

    const notice = await screen.findByTestId('two-factor-notice');
    expect(notice.props.accessibilityLabel).toMatch(/signed out/i);
  });

  it('reports a wrong password on the form rather than ending the session', async () => {
    stub('disableTwoFactor').mockRejectedValue({ kind: 'auth', code: 'invalid_credentials' });
    const screen = renderWithProviders(<TwoFactorSetup />);

    fireEvent.changeText(screen.getByTestId('two-factor-password'), 'wrong');
    fireEvent.press(screen.getByTestId('two-factor-disable'));

    expect(await screen.findByTestId('two-factor-error')).toBeTruthy();
  });
});

describe('the status the server reports (owner decision R2)', () => {
  function renderInSession() {
    return renderWithProviders(
      <SessionProvider
        authService={authService}
        tokenStorage={createTokenStorage(createInMemorySecureStore())}
      >
        <TwoFactorSetup />
      </SessionProvider>,
    );
  }

  it('says it is on, how many codes are left, and offers replace and turn off — not set up', async () => {
    stub('twoFactorStatus').mockResolvedValue({ enabled: true, recoveryCodesRemaining: 6 });
    const screen = renderInSession();

    expect(await screen.findByText('Two-factor authentication is on.')).toBeTruthy();
    expect(screen.getByText('6 recovery codes left.')).toBeTruthy();
    expect(screen.getByTestId('two-factor-replace')).toBeTruthy();
    expect(screen.getByTestId('two-factor-disable')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-start')).toBeNull();
  });

  it('warns when the codes run out, and says what gets a new set', async () => {
    stub('twoFactorStatus').mockResolvedValue({ enabled: true, recoveryCodesRemaining: 0 });
    const screen = renderInSession();

    expect(await screen.findByTestId('two-factor-codes-left')).toBeTruthy();
    expect(screen.getByText(/No recovery codes left\./)).toBeTruthy();
    expect(screen.getByText(/Replace the app to get a new set\./)).toBeTruthy();
  });

  it('says it is off and offers only set up', async () => {
    stub('twoFactorStatus').mockResolvedValue({ enabled: false, recoveryCodesRemaining: 0 });
    const screen = renderInSession();

    expect(await screen.findByText('Two-factor authentication is off.')).toBeTruthy();
    expect(screen.getByTestId('two-factor-start')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-disable')).toBeNull();
    expect(screen.queryByTestId('two-factor-replace')).toBeNull();
  });

  it('asserts nothing when the server does not serve the status', async () => {
    const status = stub('twoFactorStatus').mockResolvedValue(null);
    const screen = renderInSession();

    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId('two-factor-status')).toBeNull();
    expect(screen.getByTestId('two-factor-start')).toBeTruthy();
    expect(screen.getByTestId('two-factor-disable')).toBeTruthy();
  });
});

describe('replacing the authenticator app (owner decision Q7 / R4)', () => {
  function renderEnabled() {
    stub('twoFactorStatus').mockResolvedValue({ enabled: true, recoveryCodesRemaining: 3 });
    return renderWithProviders(
      <SessionProvider
        authService={authService}
        tokenStorage={createTokenStorage(createInMemorySecureStore())}
      >
        <TwoFactorSetup />
      </SessionProvider>,
    );
  }

  async function proveCurrentFactor(screen: ReturnType<typeof renderEnabled>) {
    fireEvent.press(await screen.findByTestId('two-factor-replace'));
    fireEvent.changeText(screen.getByTestId('two-factor-reenrol-password'), 'Password1!');
    fireEvent.changeText(screen.getByTestId('two-factor-reenrol-current-code'), '111111');
    fireEvent.press(screen.getByTestId('two-factor-reenrol-continue'));
  }

  it('needs the password and the current code, then the new code, then shows the new codes', async () => {
    const begin = stub('startTwoFactorReenrollment').mockResolvedValue({
      secret: 'NEWSECRETNEWSECR',
      otpauthUrl: 'otpauth://totp/Medora:x?secret=NEWSECRETNEWSECR',
      enrolmentToken: 'enrol-1',
    });
    const confirm = stub('confirmTwoFactorReenrollment').mockResolvedValue([
      '0a1b2-c3d4e',
      '5f6a7-b8c9d',
    ]);
    const screen = renderEnabled();

    await proveCurrentFactor(screen);
    await waitFor(() =>
      expect(begin).toHaveBeenCalledWith({ password: 'Password1!', code: '111111' }),
    );
    expect(await screen.findByTestId('two-factor-reenrol-secret')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('two-factor-reenrol-new-code'), '222222');
    fireEvent.press(screen.getByTestId('two-factor-reenrol-confirm'));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({ enrolmentToken: 'enrol-1', code: '222222' }),
    );
    expect(await screen.findByText('0a1b2-c3d4e')).toBeTruthy();
    expect(screen.getByText('5f6a7-b8c9d')).toBeTruthy();
  });

  it('names a current code that does not match, and replaces nothing', async () => {
    stub('startTwoFactorReenrollment').mockRejectedValue({ kind: 'auth', code: 'otp_invalid' });
    const confirm = stub('confirmTwoFactorReenrollment');
    const screen = renderEnabled();

    await proveCurrentFactor(screen);

    expect(
      await screen.findByText('That code did not match your current authenticator app.'),
    ).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('treats the lockout as the end of the session, which the server revoked', async () => {
    stub('startTwoFactorReenrollment').mockRejectedValue({
      kind: 'rate_limited',
      code: 'rate_limited',
      retryAfterSeconds: 900,
    });
    const screen = renderEnabled();

    await proveCurrentFactor(screen);

    expect(
      await screen.findByText(
        'Too many failed attempts. For your security, this session has been signed out.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('two-factor-reenrol-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-reenrol-password')).toBeNull();
  });

  it('starts again when the enrolment expired before it was confirmed', async () => {
    stub('startTwoFactorReenrollment').mockResolvedValue({
      secret: 'S',
      otpauthUrl: 'otpauth://totp/x',
      enrolmentToken: 'enrol-1',
    });
    stub('confirmTwoFactorReenrollment').mockRejectedValue({
      kind: 'auth',
      code: 'token_invalid',
    });
    const screen = renderEnabled();

    await proveCurrentFactor(screen);
    fireEvent.changeText(await screen.findByTestId('two-factor-reenrol-new-code'), '222222');
    fireEvent.press(screen.getByTestId('two-factor-reenrol-confirm'));

    expect(
      await screen.findByText('This replacement expired before it was confirmed. Start again.'),
    ).toBeTruthy();
    expect(screen.getByTestId('two-factor-reenrol-password').props.value).toBe('');
  });
});

describe('the enrolment link is opened only as otpauth:// (Linking opens any scheme)', () => {
  it('offers no "open app" button for a server link with another scheme, and keeps the key', async () => {
    stub('setupTwoFactor').mockResolvedValue({
      ...ENROLMENT,
      otpauthUrl: 'https://phish.example/enter-your-codes',
    });
    const openURL = jest.spyOn(Linking, 'openURL');
    installed.push(openURL);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);

    expect(await screen.findByTestId('two-factor-secret')).toBeTruthy();
    expect(screen.queryByTestId('two-factor-open-app')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('offers it for an otpauth link', async () => {
    stub('setupTwoFactor').mockResolvedValue(ENROLMENT);
    const screen = renderWithProviders(<TwoFactorSetup />);

    startWithPassword(screen);

    expect(await screen.findByTestId('two-factor-open-app')).toBeTruthy();
  });
});
