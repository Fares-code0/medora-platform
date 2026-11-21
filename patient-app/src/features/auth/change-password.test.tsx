import { fireEvent, waitFor } from '@testing-library/react-native';

import { catalogues, interpolate } from '@/i18n';
import { renderWithProviders } from '@/test/render';

import { ChangePasswordForm } from './components/ChangePasswordForm';
import { changePasswordFormSchema } from './schemas';
import { authService } from './service';
import { changePasswordErrors, type AuthErrorMessage } from './useAuthErrorMessage';

/**
 * Change password — checklist P-05, U-02, U-06.
 *
 * `POST /me/password` is live, so unlike most of this tree these are
 * tests of a real call rather than of a screen over a fixture. The
 * assertions that matter are about where a failure lands:
 *
 * - a wrong CURRENT password is `401 invalid_credentials` and must reach
 *   the field, not the session machinery. Treating it as an expired
 *   session is the web client's live defect (audit §5, checklist D-02),
 *   and this suite is what stops it being inherited here;
 * - the policy is checked before the request, with the same five rules
 *   the server applies, so a weak password is never sent;
 * - nothing keeps the plaintext after a successful change.
 */

const CURRENT = 'Password1!';
const NEXT = 'NewPassword2@';

function fill(
  screen: ReturnType<typeof renderWithProviders>,
  values: { current?: string; next?: string; confirm?: string },
) {
  if (values.current !== undefined) {
    fireEvent.changeText(screen.getByTestId('change-password-current'), values.current);
  }
  if (values.next !== undefined) {
    fireEvent.changeText(screen.getByTestId('change-password-new'), values.next);
  }
  if (values.confirm !== undefined) {
    fireEvent.changeText(screen.getByTestId('change-password-confirm'), values.confirm);
  }
}

describe('the form schema mirrors changePasswordSchema', () => {
  it('accepts a current password that would fail the policy', () => {
    // `min(1)`, deliberately: a patient whose existing password predates
    // a policy change must still be able to reach the endpoint that lets
    // them fix it. This is the backend's own reasoning on the same field.
    const result = changePasswordFormSchema.safeParse({
      currentPassword: 'old',
      newPassword: NEXT,
      confirmNewPassword: NEXT,
    });
    expect(result.success).toBe(true);
  });

  it('applies the five policy rules to the new password', () => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: CURRENT,
      newPassword: 'password',
      confirmNewPassword: 'password',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a mistyped confirmation, which would otherwise be a lockout', () => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmNewPassword: `${NEXT}x`,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmNewPassword']);
  });

  it('rejects a new password equal to the current one', () => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: CURRENT,
      newPassword: CURRENT,
      confirmNewPassword: CURRENT,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['newPassword']);
  });

  it('never carries the confirmation onto the wire', () => {
    const parsed = changePasswordFormSchema.parse({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmNewPassword: NEXT,
    });
    // The server holds one password and has nothing to compare a second
    // against; the field exists to catch a typo and stops at the form.
    expect(Object.keys(parsed).sort()).toEqual([
      'confirmNewPassword',
      'currentPassword',
      'newPassword',
    ]);
  });
});

/**
 * The English rendering of a mapped message.
 *
 * Since C-09 a message this CLIENT chose arrives as a catalogue key,
 * while one the SERVER wrote arrives as a plain string — the `422`
 * distinction `changePasswordErrors` documents. This helper collapses
 * the two so the assertions stay about what the patient reads, and the
 * test that cares about the difference asserts on the shape directly.
 */
function render(message: AuthErrorMessage | string | null): string | null {
  if (message === null) return null;
  if (typeof message === 'string') return message;
  return interpolate(catalogues.en[message.key], message.params);
}

describe('a failed change lands where the patient can act on it', () => {
  it('puts 401 invalid_credentials on the current-password field, not in a banner', () => {
    const mapped = changePasswordErrors(
      Object.assign(new Error('API error: auth'), {
        kind: 'auth' as const,
        code: 'invalid_credentials',
      }),
    );
    // A key, because this client decided the wording.
    expect(mapped.fields.currentPassword).toEqual({ key: 'auth.error.currentPasswordWrong' });
    expect(render(mapped.fields.currentPassword ?? null)).toBe('That is not your current password.');
    expect(mapped.banner).toBeNull();
  });

  it("renders the server's own weak_password wording on the new-password field", () => {
    const mapped = changePasswordErrors(
      Object.assign(new Error('API error: validation'), {
        kind: 'validation' as const,
        code: 'weak_password',
        fieldErrors: { newPassword: ['Choose a password you have not used here before'] },
      }),
    );
    // A plain string, because the SERVER decided this wording and the
    // backend words its policy identically to this form's checklist.
    // Translating it here would break that agreement.
    expect(mapped.fields.newPassword).toBe('Choose a password you have not used here before');
    expect(mapped.banner).toBeNull();
  });

  it('falls back to a banner for a failure no field owns', () => {
    const mapped = changePasswordErrors(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited' as const,
        retryAfterSeconds: 30,
      }),
    );
    expect(mapped.fields).toEqual({});
    expect(render(mapped.banner)).toContain('30');
  });

  it('does not mistake a network failure for a wrong password', () => {
    const mapped = changePasswordErrors(
      Object.assign(new Error('API error: network'), { kind: 'network' as const }),
    );
    expect(mapped.fields.currentPassword).toBeUndefined();
    expect(render(mapped.banner)).toContain("couldn't reach");
  });
});

describe('the form', () => {
  it('sends only the two fields the route takes', async () => {
    const change = jest.spyOn(authService, 'changePassword');
    const screen = renderWithProviders(<ChangePasswordForm />);

    fill(screen, { current: CURRENT, next: NEXT, confirm: NEXT });
    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(change).toHaveBeenCalledWith({ currentPassword: CURRENT, newPassword: NEXT });
    });
  });

  it('says the other devices were signed out, because the server signed them out', async () => {
    const onChanged = jest.fn();
    const screen = renderWithProviders(<ChangePasswordForm onChanged={onChanged} />);

    fill(screen, { current: CURRENT, next: NEXT, confirm: NEXT });
    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('change-password-success')).toBeTruthy();
    });
    expect(screen.getByTestId('change-password-success').props.accessibilityLabel).toContain(
      'signed out',
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps no plaintext in the form after a successful change', async () => {
    const screen = renderWithProviders(<ChangePasswordForm />);

    fill(screen, { current: CURRENT, next: NEXT, confirm: NEXT });
    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('change-password-success')).toBeTruthy();
    });
    for (const field of ['current', 'new', 'confirm']) {
      expect(screen.getByTestId(`change-password-${field}`).props.value).toBe('');
    }
  });

  it('marks the current-password field on a wrong current password — and stays put', async () => {
    const screen = renderWithProviders(<ChangePasswordForm />);

    fill(screen, { current: 'NotMyPassword1!', next: NEXT, confirm: NEXT });
    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('That is not your current password.')).toBeTruthy();
    });
    // No form-level banner, and the form is still there: a mistyped
    // password is not a lost session (checklist D-02, T-05).
    expect(screen.queryByTestId('change-password-error')).toBeNull();
    expect(screen.getByTestId('change-password-form')).toBeTruthy();
  });

  it('does not send a password the policy would reject', async () => {
    const change = jest.spyOn(authService, 'changePassword');
    const screen = renderWithProviders(<ChangePasswordForm />);

    fill(screen, { current: CURRENT, next: 'password', confirm: 'password' });
    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('Add an uppercase letter')).toBeTruthy();
    });
    expect(change).not.toHaveBeenCalled();
  });

  it('shows every unmet rule at once rather than the first', () => {
    const screen = renderWithProviders(<ChangePasswordForm />);
    fill(screen, { next: 'ab' });

    // A patient fixing one rule at a time, five times, gives up.
    expect(screen.getByTestId('change-password-rules').props.accessibilityLabel).toContain(
      'An uppercase letter, A number, A symbol',
    );
  });
});
