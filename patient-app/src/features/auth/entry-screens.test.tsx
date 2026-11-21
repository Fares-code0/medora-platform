import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import type { AuthStackParamList } from '@/navigation/routes';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';

import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { authService } from './service';
import { SessionProvider } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * The three screens a patient meets first — checklist D-06, D-08, D-10.
 *
 * `auth-screens.test.tsx` covers the three *later* ones (OTP, verify,
 * reset). These are the entry points, and each carries a rule that is
 * invisible to a reader and expensive to get wrong:
 *
 * - **Sign in** must not treat a short password differently from a wrong
 *   one. The login schema is `min(1)`, deliberately, because rejecting a
 *   6-character password locally answers "is that a real account?" for
 *   free.
 * - **Forgot password** must show the same confirmation whether or not
 *   the address exists. The backend pays for that with an unconditional
 *   202; a client that only confirmed for real addresses would hand the
 *   distinction straight back.
 * - **Register** must collect consent as an affirmative act. Both boxes
 *   are refined to `true` for exactly that reason — and were **ticked by
 *   default** until these tests asked, which made that refinement
 *   unreachable. Fixed in the same change.
 */

const VALID_PASSWORD = 'NewPassword2@';

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub<K extends keyof typeof authService>(method: K) {
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

// ── D-10 · Ask for a reset link ──────────────────────────────────────

function renderForgot() {
  const navigation = navigationStub();
  const view = renderWithProviders(
    <ForgotPasswordScreen {...screenProps('ForgotPassword', navigation, undefined)} />,
  );
  return { ...view, navigation };
}

async function submitForgot(view: ReturnType<typeof renderForgot>, email: string) {
  fireEvent.changeText(view.getByTestId('forgot-email'), email);
  await act(async () => {
    fireEvent.press(view.getByTestId('forgot-submit'));
  });
}

describe('asking for a reset link (D-10, anti-enumeration)', () => {
  it('confirms in words that do not say whether the account exists', async () => {
    const forgot = stub('forgotPassword').mockResolvedValue(undefined);
    const view = renderForgot();

    await submitForgot(view, 'nobody@example.com');

    expect(forgot).toHaveBeenCalledWith('nobody@example.com');
    const notice = await view.findByTestId('forgot-sent');
    expect(notice).toBeTruthy();
    expect(view.getByText(/If there is an account with that address/i)).toBeTruthy();
  });

  it('never says a link was sent, or that an address is unknown', async () => {
    stub('forgotPassword').mockResolvedValue(undefined);
    const view = renderForgot();

    await submitForgot(view, 'nobody@example.com');

    await view.findByTestId('forgot-sent');
    // "We've sent you an email" is a confirmation that only makes sense
    // for a real address, which makes its presence the answer.
    expect(view.queryByText(/we have sent|we've sent|check your inbox/i)).toBeNull();
    expect(view.queryByText(/no account|not found|unknown/i)).toBeNull();
  });

  it('does not submit an address that is not an address', async () => {
    const forgot = stub('forgotPassword');
    const view = renderForgot();

    await submitForgot(view, 'not-an-email');

    expect(forgot).not.toHaveBeenCalled();
  });

  it('rejects a padded address at the schema rather than sending it', async () => {
    // Worth recording because the submit handler calls `.trim()`, which
    // reads like padding is tolerated. It is not: `z.string().email()`
    // runs first and rejects the surrounding whitespace, so the `.trim()`
    // only ever sees a value that has none. Harmless, and not what a
    // reader would assume.
    const forgot = stub('forgotPassword');
    const view = renderForgot();

    await submitForgot(view, '  amina@example.com  ');

    expect(forgot).not.toHaveBeenCalled();
  });

  it('offers the reset-code route, for a mail client that swallowed the link', async () => {
    const view = renderForgot();

    fireEvent.press(view.getByText('I have a reset code'));

    expect(view.navigation.navigate).toHaveBeenCalledWith('ResetPassword', {});
  });
});

// ── D-06 · Sign in ───────────────────────────────────────────────────

function renderLogin() {
  const navigation = navigationStub();
  const view = renderWithProviders(
    <SessionProvider
      authService={authService}
      tokenStorage={createTokenStorage(createInMemorySecureStore())}
    >
      <LoginScreen {...screenProps('Login', navigation, undefined)} />
    </SessionProvider>,
  );
  return { ...view, navigation };
}

async function submitLogin(view: ReturnType<typeof renderLogin>, email: string, password: string) {
  fireEvent.changeText(view.getByTestId('login-email'), email);
  fireEvent.changeText(view.getByTestId('login-password'), password);
  await act(async () => {
    fireEvent.press(view.getByTestId('login-submit'));
  });
}

describe('signing in (D-06)', () => {
  it('sends a short password rather than rejecting it locally', async () => {
    // `min(1)`, not the signup policy. Rejecting a 6-character password
    // here would give a different answer for a wrong guess than for a
    // wrong password, which answers "is that a real account?" for free.
    const login = stub('login').mockRejectedValue(
      apiError({ kind: 'auth', code: 'invalid_credentials' }),
    );
    const view = renderLogin();

    await submitLogin(view, 'amina@example.com', 'short');

    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0]?.[0]).toMatchObject({ password: 'short' });
  });

  it('will not send without an email or a password at all', async () => {
    const login = stub('login');
    const view = renderLogin();

    await submitLogin(view, '', '');

    expect(login).not.toHaveBeenCalled();
  });

  it('leaves the password exactly as typed, spaces included', async () => {
    // A password with a leading space is a password. Trimming it would
    // silently change what the patient typed and then blame them for it.
    const login = stub('login').mockRejectedValue(apiError({ kind: 'auth' }));
    const view = renderLogin();

    await submitLogin(view, 'amina@example.com', ' spaced ');

    expect(login.mock.calls[0]?.[0]).toMatchObject({
      email: 'amina@example.com',
      password: ' spaced ',
    });
  });

  it('routes to the step-up when the server asks for one, without an error', async () => {
    stub('login').mockResolvedValue({ kind: 'otp-required', otpToken: 'OTP-1' } as never);
    const view = renderLogin();

    await submitLogin(view, 'amina@example.com', VALID_PASSWORD);

    expect(view.navigation.navigate).toHaveBeenCalledWith('Otp');
    expect(view.queryByTestId('login-error')).toBeNull();
  });

  it('shows a wrong password as a wrong password, not as an ended session', async () => {
    stub('login').mockRejectedValue(apiError({ kind: 'auth', code: 'invalid_credentials' }));
    const view = renderLogin();

    await submitLogin(view, 'amina@example.com', 'wrong');

    await waitFor(() => expect(view.getByTestId('login-error')).toBeTruthy());
    expect(view.getByText(/do not match/i)).toBeTruthy();
  });

  it('tells an unverified account what to do rather than what went wrong', async () => {
    stub('login').mockRejectedValue(apiError({ kind: 'auth', code: 'email_unverified' }));
    const view = renderLogin();

    await submitLogin(view, 'amina@example.com', VALID_PASSWORD);

    await waitFor(() => expect(view.getByText(/Confirm your email/i)).toBeTruthy());
  });

  it('never renders the typed password back', async () => {
    const view = renderLogin();

    fireEvent.changeText(view.getByTestId('login-password'), VALID_PASSWORD);

    expect(view.queryByText(VALID_PASSWORD)).toBeNull();
    expect(view.getByTestId('login-password').props.secureTextEntry).toBe(true);
  });

  it('keeps Emergency reachable from the form, signed out', async () => {
    // Emergency is a route in the AuthStack, not only behind the gate.
    // This is the screen a patient reaches when they cannot get in.
    const view = renderLogin();

    fireEvent.press(view.getByTestId('login-emergency'));

    expect(view.navigation.navigate).toHaveBeenCalledWith('Emergency');
  });

  it('says nothing about a session ending when nobody ended one', async () => {
    // Somebody who pressed Sign out does not need to be told they pressed
    // Sign out, and a first-launch patient must not be told a session
    // expired that never existed (D-12).
    const view = renderLogin();

    await act(async () => undefined);
    expect(view.queryByTestId('login-session-notice')).toBeNull();
  });
});

// ── D-08 · Register ──────────────────────────────────────────────────

const ACCOUNT = {
  firstName: 'Amina',
  lastName: 'Yusuf',
  email: 'amina.yusuf@example.com',
  phone: '+962790000000',
};

function renderRegister() {
  const navigation = navigationStub();
  const view = renderWithProviders(
    <RegisterScreen {...screenProps('Register', navigation, undefined)} />,
  );
  return { ...view, navigation };
}

function fillRegister(
  view: ReturnType<typeof renderRegister>,
  overrides: Partial<Record<string, string>> = {},
) {
  const values: Record<string, string> = {
    'register-first-name': ACCOUNT.firstName,
    'register-last-name': ACCOUNT.lastName,
    'register-email': ACCOUNT.email,
    'register-phone': ACCOUNT.phone,
    'register-password': VALID_PASSWORD,
    'register-confirm-password': VALID_PASSWORD,
    ...overrides,
  };
  for (const [testID, value] of Object.entries(values)) {
    fireEvent.changeText(view.getByTestId(testID), value);
  }
}

function acceptBoth(view: ReturnType<typeof renderRegister>) {
  fireEvent.press(view.getByTestId('register-accept-terms'));
  fireEvent.press(view.getByTestId('register-accept-privacy'));
}

async function submitRegister(view: ReturnType<typeof renderRegister>) {
  await act(async () => {
    fireEvent.press(view.getByTestId('register-submit'));
  });
}

describe('consent is an act, not a default (D-08)', () => {
  it('starts with both boxes unticked', () => {
    // A pre-ticked consent box is not consent — the patient has done
    // nothing, and `users.terms_accepted_at` would record a moment at
    // which they did nothing. It also makes `literal(true)`'s own error
    // message unreachable, so the validation that exists to force the act
    // can never fire.
    const view = renderRegister();

    expect(view.getByTestId('register-accept-terms').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('register-accept-privacy').props.accessibilityState.checked).toBe(
      false,
    );
  });

  it('does not register an account whose consent was never given', async () => {
    const register = stub('register');
    const view = renderRegister();

    fillRegister(view);
    await submitRegister(view);

    expect(register).not.toHaveBeenCalled();
  });

  it('says which box is missing rather than failing silently', async () => {
    stub('register');
    const view = renderRegister();

    fillRegister(view);
    fireEvent.press(view.getByTestId('register-accept-terms'));
    await submitRegister(view);

    expect(await view.findByText(/must accept the Privacy Policy/i)).toBeTruthy();
  });

  it('registers once both are ticked', async () => {
    const register = stub('register').mockResolvedValue({
      nextStep: 'verify-email',
      email: ACCOUNT.email,
    });
    const view = renderRegister();

    fillRegister(view);
    acceptBoth(view);
    await submitRegister(view);

    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('what registration sends (D-08, ADR-035 §4)', () => {
  async function register(overrides: Partial<Record<string, string>> = {}) {
    const spy = stub('register').mockResolvedValue({
      nextStep: 'verify-email',
      email: ACCOUNT.email,
    });
    const view = renderRegister();
    fillRegister(view, overrides);
    acceptBoth(view);
    await submitRegister(view);
    return { view, spy };
  }

  it('sends the account fields, trimmed, and nothing else', async () => {
    const { spy } = await register({ 'register-first-name': '  Amina  ' });

    expect(Object.keys(spy.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'acceptPrivacy',
      'acceptTerms',
      'email',
      'firstName',
      'lastName',
      'password',
      'phone',
    ]);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ firstName: 'Amina' });
  });

  it('never sends the confirmation, a role, or anything professional', async () => {
    const { spy } = await register();
    const body = spy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;

    // `role` is the adapter's constant. A form field for it would let a
    // modified app ask for a clinician account, and `licenseNumber` has
    // no business on a patient form at all.
    for (const forbidden of ['confirmPassword', 'role', 'licenseNumber', 'specialty']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('routes to verification with the address the SERVER echoed back', async () => {
    const spy = stub('register').mockResolvedValue({
      nextStep: 'verify-email',
      email: 'normalised@example.com',
    });
    const view = renderRegister();
    fillRegister(view);
    acceptBoth(view);
    await submitRegister(view);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(view.navigation.navigate).toHaveBeenCalledWith('VerifyEmail', {
      email: 'normalised@example.com',
    });
  });

  it('applies the password policy before the request, not after a 422', async () => {
    const spy = stub('register');
    const view = renderRegister();

    fillRegister(view, {
      'register-password': 'password',
      'register-confirm-password': 'password',
    });
    acceptBoth(view);
    await submitRegister(view);

    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a mistyped confirmation before it becomes a lockout', async () => {
    const spy = stub('register');
    const view = renderRegister();

    fillRegister(view, { 'register-confirm-password': `${VALID_PASSWORD}x` });
    acceptBoth(view);
    await submitRegister(view);

    expect(spy).not.toHaveBeenCalled();
    expect(await view.findByText(/Passwords do not match/i)).toBeTruthy();
  });

  it('tells a patient with an existing account what happened, without confirming more', async () => {
    stub('register').mockRejectedValue(apiError({ kind: 'auth', code: 'email_taken' }));
    const view = renderRegister();

    fillRegister(view);
    acceptBoth(view);
    await submitRegister(view);

    await waitFor(() => expect(view.getByTestId('register-error')).toBeTruthy());
    expect(view.getByText(/already an account with that email/i)).toBeTruthy();
  });
});
