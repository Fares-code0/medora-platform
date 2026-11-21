import { lazy, Suspense } from 'react';

import type { RouteObject } from 'react-router-dom';

import { RequireGuest } from '@/app/router/guards';
import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

import { AuthFallback } from './components/AuthFallback';
import { AuthLayout } from './layout/AuthLayout';

/**
 * Auth route subtree — lazy per-page chunks mounted by the app router.
 * The guest branch (login/signup/recovery/verification) renders inside
 * AuthLayout behind RequireGuest; the lock screen is standalone because a
 * `locked` session is authenticated-but-gated, not a guest.
 *
 * ## `handle.titleKey`
 *
 * Every page here already renders its name as an `h1` from a translated key.
 * The same key names the browser tab and is what the route announcer reads —
 * so the three cannot disagree, and none of them needed a new string in five
 * catalogues. Before this, all ten public pages shared the bare title
 * "Medora", which fails WCAG 2.4.2 and makes two open tabs indistinguishable.
 */

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const VerifyOtpPage = lazy(() => import('./pages/VerifyOtpPage'));
const AcceptInvitationPage = lazy(() => import('./pages/AcceptInvitationPage'));
const LockScreenPage = lazy(() => import('./pages/LockScreenPage'));

export const authRoutes: RouteObject[] = [
  {
    element: <RequireGuest />,
    children: [
      {
        element: (
          <Suspense fallback={<AuthFallback />}>
            <AuthLayout />
          </Suspense>
        ),
        children: [
          {
            path: routes.login,
            element: <LoginPage />,
            handle: { titleKey: 'login.title' } satisfies RouteHandle,
          },
          {
            path: routes.signup,
            element: <SignupPage />,
            handle: { titleKey: 'signup.title' } satisfies RouteHandle,
          },
          {
            path: routes.forgotPassword,
            element: <ForgotPasswordPage />,
            handle: { titleKey: 'forgot.title' } satisfies RouteHandle,
          },
          {
            path: routes.resetPassword,
            element: <ResetPasswordPage />,
            handle: { titleKey: 'reset.title' } satisfies RouteHandle,
          },
          {
            path: routes.verifyEmail,
            element: <VerifyEmailPage />,
            handle: { titleKey: 'verifyEmail.title' } satisfies RouteHandle,
          },
          {
            path: routes.verifyOtp,
            element: <VerifyOtpPage />,
            handle: { titleKey: 'otp.title' } satisfies RouteHandle,
          },
          {
            // Behind `RequireGuest` with the rest: an invitee has no
            // session, and one who somehow does has no business
            // re-accepting an invitation.
            path: routes.acceptInvitation,
            element: <AcceptInvitationPage />,
            handle: { titleKey: 'invitation.title' } satisfies RouteHandle,
          },
        ],
      },
    ],
  },
  {
    path: routes.lockScreen,
    element: (
      <Suspense fallback={<AuthFallback />}>
        <LockScreenPage />
      </Suspense>
    ),
    handle: { titleKey: 'lock.title' } satisfies RouteHandle,
  },
];
