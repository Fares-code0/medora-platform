import { Navigate, type RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Settings feature routes — FRONTEND_ARCHITECTURE.md §5.3.
 * One lazy boundary at /doctor/settings/:section; the section is a URL
 * param so deep links (and the avatar menu → Profile shortcut) land on the
 * right pane. The bare /doctor/settings redirects to the profile section.
 */
const lazyPage = async () => {
  const { SettingsPage } = await import('./pages/SettingsPage');
  return { Component: SettingsPage };
};

export const settingsRoutes: readonly RouteObject[] = [
  {
    path: `${routes.doctor.root}/settings`,
    handle: { titleKey: 'shell.settings' } satisfies RouteHandle,
    children: [
      { index: true, element: <Navigate to={routes.doctor.settings('profile')} replace /> },
      // No crumb on the :section child — the parent already contributes
      // "Settings", and the active section is visible in the page's own nav.
      { path: ':section', lazy: lazyPage },
    ],
  },
];
