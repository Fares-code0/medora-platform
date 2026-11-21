import { useState } from 'react';

import { FlaskConical } from 'lucide-react';

import { useAuth } from '@/app/providers';
import { Button } from '@/components/ui';
import { env } from '@/configs/env';
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
 * The copy is English and not routed through `useT()`. Every catalogue
 * key has to exist in all five locales (`i18n/messages`), and translating
 * scaffolding that ships to nobody would put five permanent strings into
 * the product's translation surface to serve a development button. The
 * patient app's own fixture hint is English for the same reason.
 */
export function DemoAccessPanel({
  onSignedIn,
}: {
  readonly onSignedIn: (user: SessionUser) => void;
}) {
  const { login } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = env.enableMocks ? 'the mock backend (no API)' : `the API at ${env.apiBaseUrl}`;

  async function signIn(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const user = await login(DEMO_DOCTOR_ACCOUNT.email, DEMO_DOCTOR_ACCOUNT.password);
      if (user) onSignedIn(user);
    } catch (failure) {
      setError(
        isAuthError(failure) && failure.code === 'invalid_credentials'
          ? 'The demo doctor account is not provisioned on this API. Run npm --prefix backend run db:seed with APP_ENV=development (backend/docs/LOCAL_DEMO_ACCOUNTS.md).'
          : `Demo sign-in failed against ${backend}. Is it running?`,
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
          Development
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
        Continue as Demo Doctor
      </Button>

      {/* Secondary, not tertiary. `styles/text-roles.test.ts` holds a
          ceiling on the faintest tint, and its own precedent is that a
          disclosure moves to secondary rather than being absorbed into it:
          an honesty marker a reader skips defeats the reason it exists. */}
      <p className="mt-2 text-center text-caption text-text-secondary">
        {`Signs in as the seeded demo doctor through ${backend}. Local development demo accounts only.`}
      </p>
    </div>
  );
}
