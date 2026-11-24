import { useState } from 'react';

import { FlaskConical } from 'lucide-react';

import { useAuth } from '@/app/providers';
import { Button } from '@/components/ui';
import { env } from '@/configs/env';
import { useLocale } from '@/i18n';
import { isAuthError, type SessionUser } from '@/types/auth';

import { AuthFormError } from '../components';
import { MOCK_PASSWORD } from '../mock/users';

/**
 * The demo sign-in's credentials: one **real** account, which the button
 * hands to `AuthProvider.login` — the same call the sign-in
 * form makes. So the session it produces is issued by whichever auth
 * backend is active:
 *
 * - **Live API** (`VITE_ENABLE_MOCKS` off): the backend's seeded demo
 *   doctor, provisioned by `npm --prefix backend run db:seed` under
 *   `APP_ENV=development` (`backend/docs/LOCAL_DEMO_ACCOUNTS.md`). A real
 *   session — access token, httpOnly refresh cookie, server-side RBAC.
 * - **Mock backend** (`VITE_ENABLE_MOCKS=true`): the mock roster's doctor,
 *   which is the same address with the same password by design. Still no
 *   server — that is what mock mode is, and the login page says so.
 *
 * ## What this button used to be, and why that changed
 *
 * Before the backend could sign anyone in, this module minted a session
 * on the client: a fixture user, an empty bearer token, a flag in
 * `localStorage` restored on every boot. Against the live API every
 * request that session made was a 401 — the button *looked* like a sign-in
 * and authenticated nothing. Its own header said to remove it once the
 * backend landed; the backend now provisions a real demo account, so the
 * client-only session is gone and nothing in the app can mint one.
 *
 * Not exported, and not a module of its own: a production build compiles
 * a stub for every module in this directory and proves each stub ran, and
 * a module that only this file imported would never be loaded there.
 *
 * ## The password
 *
 * `Medora123!` — the mock roster's password, and the backend seed's
 * default demo password (`DEFAULT_DEMO_PASSWORD` in
 * `backend/prisma/seed/demo-accounts.ts`). It is already in this tree, so
 * this adds no secret. **Local development only**: the backend refuses to
 * provision it outside an explicit development or test environment, and a
 * production-mode build compiles an inert stub in place of this directory
 * (`scripts/demo-access-boundary.ts`). If `DEMO_ACCOUNT_PASSWORD` changed
 * the backend's password, use the sign-in form instead.
 */
const DEMO_DOCTOR_ACCOUNT = {
  email: 'doctor@medora.health',
  password: MOCK_PASSWORD,
} as const;

/**
 * The "Continue as Demo Doctor" affordance — **development builds only**.
 *
 * Rendered by `LoginPage` behind `import.meta.env.DEV`. A production-mode
 * build does not compile this file at all — `demoAccessStubPlugin`
 * substitutes a component that returns `null` — so the button cannot be
 * rendered there whatever that flag happens to be. See
 * `scripts/demo-access-boundary.ts`.
 *
 * ## It signs in for real
 *
 * The click calls `login` with the seeded demo doctor's credentials
 * (`DEMO_DOCTOR_ACCOUNT` above) — the same call the form makes — so it
 * reaches the live API when mocks are off and the mock backend when they are on, and
 * fails the way a sign-in fails. The caption names which one, so the
 * button never presents mock authentication as the backend.
 *
 * ## Why it looks the way it does
 *
 * The login form is untouched. This is a separate block below it, behind
 * a labelled rule, in the secondary button variant — a developer tool
 * that reads as a developer tool. It deliberately does not pre-fill the
 * real form.
 *
 * The copy is translated, but not through the shared catalogue. Every key in
 * `i18n/messages/en.ts` ships in the production bundle (English is eager),
 * and three of these sentences are the markers `scripts/demo-access-boundary.ts`
 * scans a production bundle for — moving them there would make every
 * release build fail that guard, correctly. So the panel carries its own
 * English and Arabic (`COPY` below) and stays wholly inside `features/auth/dev/`,
 * which a production build replaces with a stub. French, Persian and Turkish
 * read the English, as they do any key their catalogue lacks.
 */
const COPY = {
  en: {
    development: 'Development',
    continueAs: 'Continue as Demo Doctor',
    mockBackend: 'the mock backend (no API)',
    apiBackend: (url: string) => `the API at ${url}`,
    notProvisioned:
      'The demo doctor account is not provisioned on this API. Run npm --prefix backend run db:seed with APP_ENV=development (backend/docs/LOCAL_DEMO_ACCOUNTS.md).',
    failed: (backend: string) => `Demo sign-in failed against ${backend}. Is it running?`,
    caption: (backend: string) =>
      `Signs in as the seeded demo doctor through ${backend}. Local development demo accounts only.`,
  },
  ar: {
    development: 'التطوير',
    continueAs: 'المتابعة كطبيب تجريبي',
    mockBackend: 'الخادم التجريبي (دون واجهة برمجية)',
    apiBackend: (url: string) => `الواجهة البرمجية على ${url}`,
    notProvisioned:
      'حساب الطبيب التجريبي غير مُهيّأ على هذه الواجهة البرمجية. شغّل npm --prefix backend run db:seed مع APP_ENV=development ‏(backend/docs/LOCAL_DEMO_ACCOUNTS.md).',
    failed: (backend: string) => `فشل تسجيل الدخول التجريبي عبر ${backend}. هل هو قيد التشغيل؟`,
    caption: (backend: string) =>
      `يسجّل الدخول بحساب الطبيب التجريبي عبر ${backend}. حسابات تجريبية للتطوير المحلي فقط.`,
  },
} as const;

export function DemoAccessPanel({
  onSignedIn,
}: {
  readonly onSignedIn: (user: SessionUser) => void;
}) {
  const { login } = useAuth();
  const { locale } = useLocale();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = env.enableMocks ? copy.mockBackend : copy.apiBackend(env.apiBaseUrl);

  async function signIn(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const user = await login(DEMO_DOCTOR_ACCOUNT.email, DEMO_DOCTOR_ACCOUNT.password);
      if (user) onSignedIn(user);
    } catch (failure) {
      setError(
        isAuthError(failure) && failure.code === 'invalid_credentials'
          ? copy.notProvisioned
          : copy.failed(backend),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6" data-testid="demo-access">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-caption font-medium uppercase tracking-wide text-text-secondary">
          {copy.development}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-3">
        <AuthFormError message={error} />
      </div>

      <Button
        variant="secondary"
        fullWidth
        leadingIcon={FlaskConical}
        loading={pending}
        onClick={() => void signIn()}
      >
        {copy.continueAs}
      </Button>

      {/* Secondary, not tertiary. `styles/text-roles.test.ts` holds a
          ceiling on the faintest tint, and its own precedent is that a
          disclosure moves to secondary rather than being absorbed into it:
          an honesty marker a reader skips defeats the reason it exists. */}
      <p className="mt-2 text-center text-caption text-text-secondary">
        {copy.caption(backend)}
      </p>
    </div>
  );
}
