import { useEffect, useRef } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { createTokenStorage } from '@/features/auth/storage';
import type { AuthStackParamList } from '@/navigation/routes';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';

import type { AuthService } from './model/types';
import { OtpScreen } from './screens/OtpScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { authService } from './service';
import { SessionProvider, useSession } from './SessionProvider';

/**
 * The three auth screens nothing rendered — checklist D-07, D-09, D-10.
 *
 * `ResetPasswordScreen` was at **0%** statements, `OtpScreen` at 2.3% and
 * `VerifyEmailScreen` at 4.2%, on rows all marked ✅. `session.test.tsx`
 * covers the provider and `navigation.test.tsx` covers the routing; what
 * neither covers is the part a patient types into, which on these three
 * screens is a password-reset token, a step-up code, and the address a
 * verification link is sent to.
 *
 * The assertions worth keeping are the ones about what does NOT leave the
 * screen: a password that fails the policy is never sent, a code that is
 * not six digits is never sent, and the resend cooldown is presented as
 * the courtesy it is rather than as a control that stops anything.
 */

const VALID_PASSWORD = 'NewPassword2@';

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub<K extends keyof AuthService>(method: K) {
  const spy = jest.spyOn(authService, method);
  installed.push(spy);
  return spy;
}

function apiError(error: ApiError): ApiError {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

function navigationStub() {
  return { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
}

/**
 * The props each screen reads, and nothing else. A full navigator would
 * test React Navigation; these three screens take what they need as
 * props, so a stub is the smaller and more honest harness.
 */
function screenProps<R extends keyof AuthStackParamList>(
  name: R,
  navigation: object,
  params: AuthStackParamList[R],
): NativeStackScreenProps<AuthStackParamList, R> {
  return {
    navigation,
    route: { key: `${name}-1`, name, params },
  } as unknown as NativeStackScreenProps<AuthStackParamList, R>;
}

// ── D-10 · Choose a new password ─────────────────────────────────────

function renderReset(params: { token?: string } = {}) {
  const navigation = navigationStub();
  const view = renderWithProviders(
    <ResetPasswordScreen {...screenProps('ResetPassword', navigation, params)} />,
  );
  return { ...view, navigation };
}

function fillReset(
  view: ReturnType<typeof renderReset>,
  values: { token?: string; password?: string; confirm?: string },
) {
  if (values.token !== undefined) {
    fireEvent.changeText(view.getByTestId('reset-token'), values.token);
  }
  if (values.password !== undefined) {
    fireEvent.changeText(view.getByTestId('reset-password'), values.password);
  }
  if (values.confirm !== undefined) {
    fireEvent.changeText(view.getByTestId('reset-confirm-password'), values.confirm);
  }
}

describe('choosing a new password (D-10)', () => {
  it('prefills the token from the deep link, so a patient who tapped the email types nothing', () => {
    const view = renderReset({ token: 'RESET-abc' });

    expect(view.getByTestId('reset-token').props.value).toBe('RESET-abc');
  });

  it('still offers the field when the link carried no token, because mail clients lose them', () => {
    const view = renderReset();

    expect(view.getByTestId('reset-token').props.value).toBe('');
  });

  it('does not send a password that fails the policy', async () => {
    const reset = stub('resetPassword');
    const view = renderReset({ token: 'RESET-abc' });

    fillReset(view, { password: 'password', confirm: 'password' });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    // Five rules, checked here with the same wording the server uses, so
    // the round trip that would have 422'd never happens.
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not send a mistyped confirmation, which would otherwise be a lockout', async () => {
    const reset = stub('resetPassword');
    const view = renderReset({ token: 'RESET-abc' });

    fillReset(view, { password: VALID_PASSWORD, confirm: `${VALID_PASSWORD}x` });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    expect(reset).not.toHaveBeenCalled();
  });

  it('sends the token trimmed, because a pasted code carries whitespace', async () => {
    const reset = stub('resetPassword').mockResolvedValue(undefined);
    const view = renderReset();

    fillReset(view, {
      token: '  RESET-abc  ',
      password: VALID_PASSWORD,
      confirm: VALID_PASSWORD,
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    expect(reset).toHaveBeenCalledWith({ token: 'RESET-abc', password: VALID_PASSWORD });
  });

  it('never sends the confirmation field', async () => {
    const reset = stub('resetPassword').mockResolvedValue(undefined);
    const view = renderReset({ token: 'RESET-abc' });

    fillReset(view, { password: VALID_PASSWORD, confirm: VALID_PASSWORD });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    expect(Object.keys(reset.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['password', 'token']);
  });

  it('confirms and routes to sign in rather than leaving the patient on a filled form', async () => {
    stub('resetPassword').mockResolvedValue(undefined);
    const view = renderReset({ token: 'RESET-abc' });

    fillReset(view, { password: VALID_PASSWORD, confirm: VALID_PASSWORD });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    await waitFor(() => expect(view.getByTestId('reset-password-done')).toBeTruthy());
    fireEvent.press(view.getByText('Sign in'));
    expect(view.navigation.navigate).toHaveBeenCalledWith('Login');
  });

  it('tells a patient with a dead link to request a new one, not to retype', async () => {
    stub('resetPassword').mockRejectedValue(apiError({ kind: 'auth', code: 'token_expired' }));
    const view = renderReset({ token: 'RESET-old' });

    fillReset(view, { password: VALID_PASSWORD, confirm: VALID_PASSWORD });
    await act(async () => {
      fireEvent.press(view.getByTestId('reset-submit'));
    });

    await waitFor(() => expect(view.getByTestId('reset-error')).toBeTruthy());
    expect(view.getByText(/no longer valid/i)).toBeTruthy();
  });

  it('never renders the typed password back as visible text', async () => {
    const view = renderReset({ token: 'RESET-abc' });

    fillReset(view, { password: VALID_PASSWORD, confirm: VALID_PASSWORD });

    // The value lives on a `secure` input; it must not also appear as a
    // rendered string anywhere on the screen.
    expect(view.queryByText(VALID_PASSWORD)).toBeNull();
    expect(view.getByTestId('reset-password').props.secureTextEntry).toBe(true);
  });
});

// ── D-07 · The OTP step-up ───────────────────────────────────────────

/** Drives `login()` once so the provider holds a pending step-up token. */
function ArmOtp({ arm }: { arm: boolean }) {
  const { login } = useSession();
  const done = useRef(false);
  useEffect(() => {
    if (!arm || done.current) return;
    done.current = true;
    void login({ email: 'amina@example.com', password: 'x', rememberMe: false });
  }, [arm, login]);
  return null;
}

/**
 * Mounts `OtpScreen` only once the step-up exists, which is the order the
 * app reaches it in: `LoginScreen` navigates here on the `otp-required`
 * result, so the token is already held by the time the screen renders.
 * Mounting it first would test a sequence the navigator cannot produce.
 */
function OtpHost({ pending, navigation }: { pending: boolean; navigation: object }) {
  const { pendingOtpToken } = useSession();
  if (pending && pendingOtpToken === null) return null;
  return <OtpScreen {...screenProps('Otp', navigation, undefined)} />;
}

async function renderOtp(options: { pending?: boolean } = {}) {
  const pending = options.pending !== false;
  stub('login').mockResolvedValue({ kind: 'otp-required', otpToken: 'OTP-TOKEN' } as never);
  const navigation = navigationStub();

  const view = renderWithProviders(
    <SessionProvider
      authService={authService}
      tokenStorage={createTokenStorage(createInMemorySecureStore())}
    >
      <ArmOtp arm={pending} />
      <OtpHost pending={pending} navigation={navigation} />
    </SessionProvider>,
  );

  await act(async () => undefined);
  return { ...view, navigation };
}

describe('the OTP step-up (D-07)', () => {
  it('returns to sign in when there is no step-up outstanding', async () => {
    // A deep link or a back-stack restore lands here with nothing to
    // verify. Rendering a code field for a verification that does not
    // exist is a dead end.
    const view = await renderOtp({ pending: false });

    expect(view.navigation.replace).toHaveBeenCalledWith('Login');
  });

  it('does not return to sign in while a step-up is outstanding', async () => {
    const view = await renderOtp();

    expect(view.navigation.replace).not.toHaveBeenCalled();
  });

  it('keeps only digits, and at most six of them', async () => {
    const view = await renderOtp();

    fireEvent.changeText(view.getByTestId('otp-code'), '1a2b3c4d5e6f7g');
    expect(view.getByTestId('otp-code').props.value).toBe('123456');
  });

  it('does not send a code that is not six digits', async () => {
    const verify = stub('verifyOtp');
    const view = await renderOtp();

    fireEvent.changeText(view.getByTestId('otp-code'), '123');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    expect(verify).not.toHaveBeenCalled();
    expect(view.getByTestId('otp-error')).toBeTruthy();
  });

  it('sends the code with the pending token, which the screen never shows', async () => {
    const verify = stub('verifyOtp').mockResolvedValue({
      tokens: { accessToken: 'a', refreshToken: 'r' },
      identity: { subjectId: 's', displayName: 'A', email: 'a@b.c', emailVerified: true },
    });
    const view = await renderOtp();

    fireEvent.changeText(view.getByTestId('otp-code'), '123456');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    expect(verify).toHaveBeenCalledWith({ otpToken: 'OTP-TOKEN', code: '123456' });
    expect(view.queryByText(/OTP-TOKEN/)).toBeNull();
  });

  it('says a wrong code is wrong, and an expired one expired', async () => {
    const verify = stub('verifyOtp').mockRejectedValue(
      apiError({ kind: 'auth', code: 'otp_invalid' }),
    );
    const view = await renderOtp();

    fireEvent.changeText(view.getByTestId('otp-code'), '123456');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    await waitFor(() => expect(view.getByText(/not right/i)).toBeTruthy());

    verify.mockRejectedValue(apiError({ kind: 'auth', code: 'otp_expired' }));
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    await waitFor(() => expect(view.getByText(/has expired/i)).toBeTruthy());
  });

  it('resends, confirms it, and starts a cooldown that is a courtesy, not a control', async () => {
    const resend = stub('resendOtp').mockResolvedValue(undefined);
    const view = await renderOtp();

    await act(async () => {
      fireEvent.press(view.getByTestId('otp-resend'));
    });

    expect(resend).toHaveBeenCalledWith('OTP-TOKEN');
    // Nothing is delivered: the endpoint extends the window, and the
    // confirmation says exactly that.
    expect(view.getByText(/You have more time/i)).toBeTruthy();
    // Disabled locally so a patient does not tap twice. The real limit is
    // the server's 429, which this timer neither enforces nor claims to
    // (T-07) — the countdown is in the label, and nothing else gates it.
    const button = view.getByTestId('otp-resend');
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(button.props.accessibilityLabel).toMatch(/I need more time \(\d+s\)/);
  });

  it('surfaces a 429 on resend with the wait the server asked for', async () => {
    stub('resendOtp').mockRejectedValue(apiError({ kind: 'rate_limited', retryAfterSeconds: 60 }));
    const view = await renderOtp();

    await act(async () => {
      fireEvent.press(view.getByTestId('otp-resend'));
    });

    await waitFor(() => expect(view.getByText(/60 seconds/)).toBeTruthy());
  });
});

// ── D-09 · Confirm your email ────────────────────────────────────────

function renderVerify(email = 'amina@example.com') {
  const navigation = navigationStub();
  const view = renderWithProviders(
    <VerifyEmailScreen {...screenProps('VerifyEmail', navigation, { email })} />,
  );
  return { ...view, navigation };
}

describe('confirming an email address (D-09)', () => {
  it('shows the address, because a typo in it is why this screen becomes a dead end', () => {
    const view = renderVerify('amina@exampel.com');

    expect(view.getByText(/amina@exampel\.com/)).toBeTruthy();
  });

  it('resends to the address rather than to a token the patient does not have', async () => {
    const resend = stub('resendVerification').mockResolvedValue(undefined);
    const view = renderVerify();

    await act(async () => {
      fireEvent.press(view.getByTestId('verify-resend'));
    });

    expect(resend).toHaveBeenCalledWith('amina@example.com');
    expect(view.getByText(/sent the link again/i)).toBeTruthy();
  });

  it('starts a cooldown after a resend', async () => {
    stub('resendVerification').mockResolvedValue(undefined);
    const view = renderVerify();

    await act(async () => {
      fireEvent.press(view.getByTestId('verify-resend'));
    });

    const button = view.getByTestId('verify-resend');
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(button.props.accessibilityLabel).toMatch(/Send the link again \(\d+s\)/);
  });

  it('shows a failure without losing the address', async () => {
    stub('resendVerification').mockRejectedValue(apiError({ kind: 'network' }));
    const view = renderVerify();

    await act(async () => {
      fireEvent.press(view.getByTestId('verify-resend'));
    });

    await waitFor(() => expect(view.getByTestId('verify-error')).toBeTruthy());
    expect(view.getByText(/couldn't reach the clinic/i)).toBeTruthy();
    expect(view.getByText(/amina@example\.com/)).toBeTruthy();
  });

  it('offers a way back to sign in, so this screen is never a trap', () => {
    const view = renderVerify();

    fireEvent.press(view.getByText('Back to sign in'));
    expect(view.navigation.navigate).toHaveBeenCalledWith('Login');
  });
});

describe('a recovery code in place of the step-up code (owner decision R1)', () => {
  const SIGNED_IN = {
    tokens: { accessToken: 'a', refreshToken: 'r' },
    identity: {
      subjectId: 's',
      displayName: 'Sara',
      email: 'sara@example.com',
      emailVerified: true,
    },
  };

  async function openRecovery() {
    const view = await renderOtp();
    fireEvent.press(view.getByTestId('otp-use-recovery'));
    return view;
  }

  it('redeems a recovery code against the pending challenge, never as an OTP', async () => {
    const redeem = stub('redeemRecoveryCode').mockResolvedValue(SIGNED_IN);
    const verify = stub('verifyOtp');
    const view = await openRecovery();

    fireEvent.changeText(view.getByTestId('otp-recovery-code'), '0a1b2-c3d4e');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-recovery-submit'));
    });

    expect(redeem).toHaveBeenCalledWith({ otpToken: 'OTP-TOKEN', recoveryCode: '0a1b2-c3d4e' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('names a wrong recovery code as a wrong recovery code, and clears it', async () => {
    stub('redeemRecoveryCode').mockRejectedValue(apiError({ kind: 'auth', code: 'otp_invalid' }));
    const view = await openRecovery();

    fireEvent.changeText(view.getByTestId('otp-recovery-code'), 'nope');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-recovery-submit'));
    });

    expect(view.getByText('That recovery code is not valid. Check it and try again.')).toBeTruthy();
    expect(view.getByTestId('otp-recovery-code').props.value).toBe('');
  });

  it('sends nothing for an empty code', async () => {
    const redeem = stub('redeemRecoveryCode');
    const view = await openRecovery();

    await act(async () => {
      fireEvent.press(view.getByTestId('otp-recovery-submit'));
    });

    expect(redeem).not.toHaveBeenCalled();
    expect(view.getByText('Enter a recovery code.')).toBeTruthy();
  });

  it('goes back to the authenticator code', async () => {
    const view = await openRecovery();

    fireEvent.press(view.getByTestId('otp-use-authenticator'));

    expect(view.queryByTestId('otp-recovery-code')).toBeNull();
    expect(view.getByTestId('otp-code')).toBeTruthy();
  });
});

describe('the step-up says what the factor is (an authenticator app)', () => {
  it('never tells a patient to wait for a message nobody sends', async () => {
    const view = await renderOtp();

    expect(view.getByText(/from your authenticator app/i)).toBeTruthy();
    expect(view.queryByText(/we sent you|check your messages|on its way/i)).toBeNull();
  });
});

describe('a challenge past its five minutes is named as expired', () => {
  const T0 = 1_800_000_000_000;
  const FIVE_MIN = 5 * 60 * 1000;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls a refused code wrong inside the window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    stub('verifyOtp').mockRejectedValue(apiError({ kind: 'auth', code: 'otp_invalid' }));
    const view = await renderOtp();

    now.mockReturnValue(T0 + FIVE_MIN - 1000);
    fireEvent.changeText(view.getByTestId('otp-code'), '123456');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    expect(view.getByTestId('otp-error')).toBeTruthy();
    expect(view.queryByTestId('otp-expired')).toBeNull();
  });

  it('says the sign-in expired, and offers the way back, after the window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    stub('verifyOtp').mockRejectedValue(apiError({ kind: 'auth', code: 'otp_invalid' }));
    const view = await renderOtp();

    now.mockReturnValue(T0 + FIVE_MIN + 1000);
    fireEvent.changeText(view.getByTestId('otp-code'), '123456');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    expect(view.getByText('This sign-in has expired. Go back and sign in again.')).toBeTruthy();
    fireEvent.press(view.getByTestId('otp-back-to-sign-in'));
    expect(view.navigation.replace).toHaveBeenCalledWith('Login');
  });

  it('restarts the window when the server grants more time', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0);
    stub('resendOtp').mockResolvedValue(undefined);
    stub('verifyOtp').mockRejectedValue(apiError({ kind: 'auth', code: 'otp_invalid' }));
    const view = await renderOtp();

    now.mockReturnValue(T0 + 4 * 60 * 1000);
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-resend'));
    });
    now.mockReturnValue(T0 + 4 * 60 * 1000 + FIVE_MIN - 1000);
    fireEvent.changeText(view.getByTestId('otp-code'), '123456');
    await act(async () => {
      fireEvent.press(view.getByTestId('otp-submit'));
    });

    expect(view.queryByTestId('otp-expired')).toBeNull();
    expect(view.getByTestId('otp-error')).toBeTruthy();
  });
});
