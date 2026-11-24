import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ar, en } from '@/i18n/messages';
import type { AuthStackParamList } from '@/navigation/routes';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SessionProvider } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * The entry screens, in Arabic — checklist C-09, and the cheap half of
 * S-08.
 *
 * ── Why this is a suite and not one assertion ───────────────────────
 *
 * A migration onto a catalogue fails silently. A screen that kept one
 * string inline still renders, still passes every English test, and only
 * shows itself to someone reading the app in the other language — which,
 * for this tree, is nobody until an Arabic-speaking patient installs it.
 *
 * So each test below renders a screen in Arabic and asserts **both
 * directions**: the Arabic string is on screen, and the English one is
 * not. The second half is what catches a missed `useT`; without it a
 * screen that renders both would pass.
 *
 * ── The Emergency affordance ────────────────────────────────────────
 *
 * It was pinned in English, pending W-10, until the owner approved
 * translating emergency copy on 2026-11-23. The pin is now a pair: the
 * Arabic label in Arabic, and the unchanged English label in English.
 * The Arabic is an engineering draft awaiting the clinical reviewer; the
 * W-10 sign-off is not given (`docs/SIGNOFF.md`).
 */

function navigationStub() {
  return { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
}

function screenProps<R extends keyof AuthStackParamList>(
  name: R,
  params: AuthStackParamList[R],
): NativeStackScreenProps<AuthStackParamList, R> {
  return {
    navigation: navigationStub(),
    route: { key: `${name}-1`, name, params },
  } as unknown as NativeStackScreenProps<AuthStackParamList, R>;
}

/** `LoginScreen` reads the session for the end-of-session banner. */
function renderLoginInArabic() {
  return renderWithProviders(
    <SessionProvider tokenStorage={createTokenStorage(createInMemorySecureStore())}>
      <LoginScreen {...screenProps('Login', undefined)} />
    </SessionProvider>,
    { locale: 'ar' },
  );
}

describe('Welcome (E-01)', () => {
  it('reads the catalogue rather than its own English', () => {
    const { getByText, queryByText } = renderWithProviders(
      <WelcomeScreen {...screenProps('Welcome', undefined)} />,
      { locale: 'ar' },
    );

    expect(getByText(ar['auth.welcome.tagline'])).toBeTruthy();
    expect(getByText(ar['auth.welcome.disclaimer'])).toBeTruthy();
    expect(getByText(ar['auth.action.signIn'])).toBeTruthy();
    expect(queryByText(en['auth.welcome.tagline'])).toBeNull();
    expect(queryByText(en['auth.action.createAccount'])).toBeNull();
  });

  it('translates the emergency affordance in Arabic (W-10 translation approval)', () => {
    const { getByText, getByTestId, queryByText } = renderWithProviders(
      <WelcomeScreen {...screenProps('Welcome', undefined)} />,
      { locale: 'ar' },
    );

    expect(getByText('مساعدة طارئة')).toBeTruthy();
    expect(getByText('متاحة دون تسجيل الدخول، ودون اتصال بالإنترنت.')).toBeTruthy();
    expect(getByTestId('welcome-emergency-card').props.accessibilityHint).toBe(
      'يفتح إرشادات الطوارئ. ولا يُجري مكالمة.',
    );
    expect(queryByText('Emergency help')).toBeNull();
  });

  it('keeps the emergency affordance word for word in English', () => {
    const { getByText, getByTestId } = renderWithProviders(
      <WelcomeScreen {...screenProps('Welcome', undefined)} />,
      { locale: 'en' },
    );

    expect(getByText('Emergency help')).toBeTruthy();
    expect(getByText('Available without signing in, and without a connection.')).toBeTruthy();
    expect(getByTestId('welcome-emergency-card').props.accessibilityLabel).toBe('Emergency help');
    expect(getByTestId('welcome-emergency-card').props.accessibilityHint).toBe(
      'Opens emergency guidance. It does not place a call.',
    );
  });
});

describe('Sign in (D-06)', () => {
  it('labels its fields and its button from the catalogue', () => {
    const { getByText, queryByText } = renderLoginInArabic();

    expect(getByText(ar['auth.field.email'])).toBeTruthy();
    expect(getByText(ar['auth.field.password'])).toBeTruthy();
    expect(getByText(ar['auth.login.forgotPassword'])).toBeTruthy();
    expect(queryByText(en['auth.login.forgotPassword'])).toBeNull();
  });
});

describe('Register (D-08)', () => {
  it('translates the consent checkboxes, which are the point of the form', () => {
    const { getByText, queryByText } = renderWithProviders(
      <RegisterScreen {...screenProps('Register', undefined)} />,
      { locale: 'ar' },
    );

    // Consent to a document nobody can read is not consent — this is the
    // one place on the form where the language matters legally and not
    // only as courtesy.
    expect(getByText(ar['auth.register.acceptTerms'])).toBeTruthy();
    expect(getByText(ar['auth.register.acceptPrivacy'])).toBeTruthy();
    expect(getByText(ar['auth.register.recordsNotice'])).toBeTruthy();
    expect(queryByText(en['auth.register.acceptTerms'])).toBeNull();
  });
});

describe('Forgot password (D-10)', () => {
  it('keeps the anti-enumeration wording in the language it is read in', () => {
    const { getByText } = renderWithProviders(
      <ForgotPasswordScreen {...screenProps('ForgotPassword', undefined)} />,
      { locale: 'ar' },
    );

    expect(getByText(ar['auth.forgot.body'])).toBeTruthy();
    // "if there is an account", never "we have sent you an email" — the
    // 202 the backend pays for is undone by a translation that promises
    // delivery, so the Arabic is asserted here and not only reviewed.
    expect(ar['auth.forgot.sent']).toContain('إذا كان هناك حساب');
  });
});

describe('Register, the name length bound (review M-6)', () => {
  it('caps both name inputs at the schema’s 60 characters', () => {
    const { getByTestId } = renderWithProviders(
      <RegisterScreen {...screenProps('Register', undefined)} />,
      { locale: 'ar' },
    );

    expect(getByTestId('register-first-name').props.maxLength).toBe(60);
    expect(getByTestId('register-last-name').props.maxLength).toBe(60);
  });
});
