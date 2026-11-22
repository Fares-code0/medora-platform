import {
  changePasswordFormSchema,
  disableTwoFactorFormSchema,
  enableTwoFactorFormSchema,
  forgotPasswordFormSchema,
  loginFormSchema,
  otpFormSchema,
  passwordChecks,
  passwordPolicyErrors,
  PASSWORD_MIN_LENGTH,
  registerFormSchema,
  resetPasswordFormSchema,
  strongPassword,
} from './schemas';

/**
 * The form schemas — checklist D-06, D-08, D-10, P-05, D-16.
 *
 * `schemas.ts` was at 65.7% of statements and **0% of branches**: every
 * rule in it had been exercised by something passing, and none by
 * something failing. That is the wrong way round for this file. It is
 * what stands between a patient and a rejected registration, and three
 * of its decisions are security decisions with a written reason that a
 * tidying refactor would undo without a test failing:
 *
 *  1. **`loginFormSchema.password` is `min(1)`, not the policy.** A
 *     policy failure on the sign-in form would answer differently for a
 *     weak guess than for a wrong password, which tells an attacker
 *     something about a password they do not have.
 *  2. **`currentPassword` is `min(1)` too**, so a patient whose existing
 *     password predates a policy change is not locked out of the one
 *     endpoint that would let them fix it.
 *  3. **`acceptTerms` is `boolean().refine`, not `literal(true)`.**
 *     `literal(true)` makes "not ticked yet" unrepresentable, so a form
 *     typed on it must default to accepted — which records consent the
 *     patient never gave.
 */

const VALID_PASSWORD = 'Str0ng!pass';

function errorsOf(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
) {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  };
  expect(result.success).toBe(false);
  return result.error?.issues ?? [];
}

describe('the password policy', () => {
  it.each([
    ['too short', 'Ab1!', 'Use at least 8 characters'],
    ['no lowercase', 'ABCDEF1!', 'Add a lowercase letter'],
    ['no uppercase', 'abcdef1!', 'Add an uppercase letter'],
    ['no digit', 'Abcdefg!', 'Add a number'],
    ['no symbol', 'Abcdefg1', 'Add a symbol'],
  ])('rejects a password that is %s', (_case, password, message) => {
    const issues = errorsOf(strongPassword, password);
    expect(issues.map((issue) => issue.message)).toContain(message);
  });

  it('accepts one that meets every rule', () => {
    expect(strongPassword.safeParse(VALID_PASSWORD).success).toBe(true);
  });

  it('reports every unmet rule at once, which is what a meter renders', () => {
    // Zod stops at the first failing refinement, so the meter cannot be
    // built from `safeParse`. That is why `passwordPolicyErrors` exists,
    // and why it is a separate function rather than a formatting of the
    // parse result.
    expect(passwordPolicyErrors('a')).toEqual([
      'Use at least 8 characters',
      'Add an uppercase letter',
      'Add a number',
      'Add a symbol',
    ]);
  });

  it('reports nothing for a password that passes', () => {
    expect(passwordPolicyErrors(VALID_PASSWORD)).toEqual([]);
  });

  it('agrees with the individual checks it is built from', () => {
    expect(passwordChecks.length('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(passwordChecks.length('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(passwordChecks.symbol('Abcdefg1')).toBe(false);
    expect(passwordChecks.symbol('Abcdefg1!')).toBe(true);
  });
});

describe('sign-in does not apply the policy (anti-enumeration)', () => {
  it('accepts a password that would fail the signup policy', () => {
    // The point: a weak guess and a wrong password must produce the same
    // answer, so the form cannot reject one before it is sent.
    const result = loginFormSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('still requires something in the field', () => {
    expect(errorsOf(loginFormSchema, { email: 'a@b.com', password: '' })[0]?.message).toBe(
      'Enter your password',
    );
  });

  it('asks for an email before it asks for a valid one', () => {
    expect(errorsOf(loginFormSchema, { email: '', password: 'x' })[0]?.message).toBe(
      'Enter your email',
    );
    expect(errorsOf(loginFormSchema, { email: 'nope', password: 'x' })[0]?.message).toBe(
      'Enter a valid email address',
    );
  });

  it('defaults rememberMe to false rather than leaving it absent', () => {
    const parsed = loginFormSchema.parse({ email: 'a@b.com', password: 'x' });
    expect(parsed.rememberMe).toBe(false);
  });

  it('applies the same rule to the two-factor disable password', () => {
    expect(disableTwoFactorFormSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(errorsOf(disableTwoFactorFormSchema, { password: '' })[0]?.message).toBe(
      'Enter your password',
    );
  });
});

describe('six digits, and only six digits', () => {
  it.each([otpFormSchema, enableTwoFactorFormSchema])('rejects the wrong length', (schema) => {
    expect(errorsOf(schema, { code: '12345' })[0]?.message).toBe('Enter the 6-digit code');
    expect(errorsOf(schema, { code: '1234567' })[0]?.message).toBe('Enter the 6-digit code');
  });

  it.each([otpFormSchema, enableTwoFactorFormSchema])(
    'rejects non-digits of the right length',
    (schema) => {
      expect(errorsOf(schema, { code: '12345a' }).map((issue) => issue.message)).toContain(
        'Code must be digits only',
      );
    },
  );

  it.each([otpFormSchema, enableTwoFactorFormSchema])('accepts six digits', (schema) => {
    expect(schema.safeParse({ code: '123456' }).success).toBe(true);
  });
});

describe('registration', () => {
  const VALID = {
    firstName: 'Sara',
    lastName: 'Ahmed',
    email: 'sara@example.com',
    phone: '+966 11 555 0100',
    password: VALID_PASSWORD,
    confirmPassword: VALID_PASSWORD,
    acceptTerms: true,
    acceptPrivacy: true,
  };

  it('accepts a complete, valid form', () => {
    expect(registerFormSchema.safeParse(VALID).success).toBe(true);
  });

  it.each([
    ['+966 11 555 0100', true],
    ['0115550100', true],
    ['011-555-0100', true],
    ['+1 555 0100', true],
    ['12345', false],
    ['not a phone', false],
    ['+', false],
  ])('reads %s as a phone number: %s', (phone, valid) => {
    expect(registerFormSchema.safeParse({ ...VALID, phone }).success).toBe(valid);
  });

  it('puts a password mismatch on the field the patient can fix', () => {
    // On `confirmPassword`, not on `password`: the first one they typed
    // is probably the one they meant.
    const issues = errorsOf(registerFormSchema, {
      ...VALID,
      confirmPassword: `${VALID_PASSWORD}x`,
    });
    expect(issues[0]?.path).toEqual(['confirmPassword']);
    expect(issues[0]?.message).toBe('Passwords do not match');
  });

  it('refuses an unticked consent box, one message per box', () => {
    // `users.terms_accepted_at` is NOT NULL by design, so an account
    // with unrecorded consent is a compliance gap and accepting `false`
    // is the one way one could be created.
    expect(errorsOf(registerFormSchema, { ...VALID, acceptTerms: false })[0]?.message).toBe(
      'You must accept the Terms & Conditions',
    );
    expect(errorsOf(registerFormSchema, { ...VALID, acceptPrivacy: false })[0]?.message).toBe(
      'You must accept the Privacy Policy',
    );
  });

  it('can hold an unticked box at all, which `literal(true)` could not', () => {
    // The type-level half of the same decision: a schema built on
    // `literal(true)` cannot represent "not ticked yet", so a form typed
    // on it has to default to accepted — recording consent the patient
    // never gave. Parsing `false` must therefore FAIL rather than be
    // impossible to express.
    const result = registerFormSchema.safeParse({ ...VALID, acceptTerms: false });
    expect(result.success).toBe(false);
  });

  it('carries no clinician field', () => {
    // `licenseNumber` has no business on a patient form and stays out
    // permanently; `role` is tracked by `parity.test.ts` until the
    // signup flow carries it.
    const parsed = registerFormSchema.parse(VALID) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('licenseNumber');
    expect(parsed).not.toHaveProperty('role');
  });

  it('never sends confirmPassword anywhere it could be stored', () => {
    // It exists to catch a typo. The server holds one password and has
    // nothing to compare a second against.
    expect(registerFormSchema.parse(VALID)).toHaveProperty('confirmPassword');
    expect(errorsOf(registerFormSchema, { ...VALID, confirmPassword: '' })[0]?.message).toBe(
      'Re-enter your password',
    );
  });
});

describe('password recovery', () => {
  it('asks for the code before anything else', () => {
    expect(
      errorsOf(resetPasswordFormSchema, {
        token: '',
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      })[0]?.message,
    ).toBe('Paste the code from your email');
  });

  it('validates the token inside a pasted link, not the link (S4)', () => {
    const valid = {
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    };
    expect(
      resetPasswordFormSchema.safeParse({
        ...valid,
        token: 'https://app.medora.example/reset-password?token=T',
      }).success,
    ).toBe(true);
    for (const token of ['https://app.medora.example/reset-password', 'token=', '   ']) {
      expect(errorsOf(resetPasswordFormSchema, { ...valid, token })[0]?.message).toBe(
        'Paste the code from your email',
      );
    }
  });

  it('puts a mismatch on the confirm field here too', () => {
    const issues = errorsOf(resetPasswordFormSchema, {
      token: 'T',
      password: VALID_PASSWORD,
      confirmPassword: 'other',
    });
    expect(issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('applies the full policy to the new password', () => {
    const issues = errorsOf(resetPasswordFormSchema, {
      token: 'T',
      password: 'weak',
      confirmPassword: 'weak',
    });
    expect(issues.some((issue) => issue.path[0] === 'password')).toBe(true);
  });

  it('wants an email that looks like one, before it sends anything', () => {
    expect(forgotPasswordFormSchema.safeParse({ email: 'sara@example.com' }).success).toBe(true);
    expect(errorsOf(forgotPasswordFormSchema, { email: 'sara' })[0]?.message).toBe(
      'Enter a valid email address',
    );
  });
});

describe('changing a password from inside a session (P-05)', () => {
  const VALID = {
    currentPassword: 'whatever-it-used-to-be',
    newPassword: VALID_PASSWORD,
    confirmNewPassword: VALID_PASSWORD,
  };

  it('accepts a current password that would fail the policy', () => {
    // Applying the policy to it would lock out a patient whose existing
    // password predates a policy change — from the one endpoint that
    // would let them fix it.
    expect(changePasswordFormSchema.safeParse(VALID).success).toBe(true);
  });

  it('still applies the policy to the new one', () => {
    const issues = errorsOf(changePasswordFormSchema, {
      ...VALID,
      newPassword: 'weak',
      confirmNewPassword: 'weak',
    });
    expect(issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
  });

  it('refuses a new password identical to the current one', () => {
    const issues = errorsOf(changePasswordFormSchema, {
      currentPassword: VALID_PASSWORD,
      newPassword: VALID_PASSWORD,
      confirmNewPassword: VALID_PASSWORD,
    });
    expect(issues[0]?.path).toEqual(['newPassword']);
    expect(issues[0]?.message).toBe('Choose a password you have not used here before');
  });

  it('puts a mistyped confirmation on the confirmation field', () => {
    const issues = errorsOf(changePasswordFormSchema, {
      ...VALID,
      confirmNewPassword: 'other',
    });
    expect(issues[0]?.path).toEqual(['confirmNewPassword']);
  });

  it('requires all three fields', () => {
    expect(errorsOf(changePasswordFormSchema, { ...VALID, currentPassword: '' })[0]?.message).toBe(
      'Enter your current password',
    );
    expect(
      errorsOf(changePasswordFormSchema, { ...VALID, confirmNewPassword: '' }).map(
        (issue) => issue.message,
      ),
    ).toContain('Re-enter your new password');
  });
});
