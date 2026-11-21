import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppProviders } from '@/app/providers';
import { expectSoundHeadingOutline } from '@/test/heading-outline';

import { DoctorProfilePage } from './admin/doctors/DoctorProfilePage';
import { PatientProfilePage as AdminPatientProfilePage } from './admin/patients/PatientProfilePage';
import { PhiAccessProvider } from './admin/phi';
import { AnnouncementsSection } from './admin/sections/AnnouncementsSection';
import { DepartmentsSection } from './admin/sections/DepartmentsSection';
import { TemplatesSection } from './admin/sections/TemplatesSection';
import { LabDetailPage } from './doctor/labs/pages/LabDetailPage';
import { MedicalRecordDetailPage } from './doctor/medical-records/pages/MedicalRecordDetailPage';
import { MessagesPage } from './doctor/messaging/pages/MessagesPage';
import { PatientProfilePage } from './doctor/patients/pages/PatientProfilePage';
import { PrescriptionDetailPage } from './doctor/pharmacy/pages/PrescriptionDetailPage';
import { SettingsPage } from './doctor/settings/pages/SettingsPage';

/**
 * The pages a browser sweep of every doctor and admin route caught breaking
 * F-17 (*one `h1` per page, no skipped levels*), pinned so they cannot drift
 * back.
 *
 * Each was a different way to break the same rule, which is why they are
 * tested together rather than one assertion per feature suite:
 *
 * | Page | Was |
 * | --- | --- |
 * | `/doctor/messages` | no `h1` — a full-height workspace with no `ContentHeader` |
 * | `/doctor/settings/:section` | **two** `h1` — `ContentHeader`'s, plus the section's |
 * | `/admin/departments` | `h1 → h3`; card titles sat directly under the page title |
 * | `/admin/announcements` | `h1 → h3`, same shape |
 * | `/admin/templates` | `h1 → h3`, same shape |
 *
 * The workspace page is fixed with a visually-hidden `h1` rather than a
 * header band, because the layout genuinely has no room for one — the
 * heading a screen reader needs and the space a sighted user would lose are
 * separable, and `sr-only` is how.
 *
 * A second pass over the *detail* routes found two more, both of which only
 * appear on a non-default tab — which is why those are driven through the
 * real page with `?tab=` rather than by rendering the fragment.
 *
 * | Page | Was |
 * | --- | --- |
 * | `/admin/patients/:id` | `h1 → h3` on all three tabs — seven panels carried `headingAs="h3"` with no `h2` above them, because a tab strip is buttons, not a heading |
 * | `/admin/doctors/:id?tab=documents` | `h1 → h3`, and three of the four document cards came *before* the `h2` they appeared to sit under |
 */

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe('heading outlines (F-17)', () => {
  it('/doctor/messages — the workspace has one h1 despite having no header band', async () => {
    renderAt('/doctor/messages', <MessagesPage />);
    await screen.findByRole('heading', { level: 1, name: 'Messages' });

    expectSoundHeadingOutline();
  });

  it('/doctor/settings/:section — the section title is an h2 under the page h1', async () => {
    render(
      <MemoryRouter initialEntries={['/doctor/settings/profile']}>
        <AppProviders>
          <Routes>
            <Route path="/doctor/settings/:section" element={<SettingsPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await screen.findByRole('heading', { level: 2, name: 'Profile' });

    expectSoundHeadingOutline();
  });

  it('/admin/departments — card titles are h2, directly under the page h1', async () => {
    renderAt('/admin/departments', <DepartmentsSection />);
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    });

    expectSoundHeadingOutline();
  });

  it('/admin/announcements — card titles are h2', async () => {
    renderAt('/admin/announcements', <AnnouncementsSection />);
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    });

    expectSoundHeadingOutline();
  });

  it('/admin/templates — card titles are h2', async () => {
    renderAt('/admin/templates', <TemplatesSection />);
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    });

    expectSoundHeadingOutline();
  });
});

/**
 * The detail routes, driven through the real page so the tab strip is real.
 * `HTMLDialogElement` needs stubbing for the same reason
 * `DoctorProfilePage.test.tsx` stubs it: jsdom implements the element but not
 * `showModal`, and these pages mount dialogs.
 */
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function renderAdminDetail(path: string, routePath: string, element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppProviders>
          <PhiAccessProvider>
            <Routes>
              <Route path={routePath} element={element} />
            </Routes>
          </PhiAccessProvider>
        </AppProviders>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('heading outlines on the detail routes (F-17)', () => {
  it.each(['profile', 'activity', 'permissions'])(
    '/admin/patients/:id?tab=%s — panels are h2 under the page h1',
    async (tab) => {
      renderAdminDetail(
        `/admin/patients/PT-1001?tab=${tab}`,
        '/admin/patients/:patientId',
        <AdminPatientProfilePage />,
      );
      await waitFor(() => {
        expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
      });

      expectSoundHeadingOutline();
    },
  );

  it('/admin/doctors/:id?tab=documents — the document cards are h2, like Verification', async () => {
    renderAdminDetail(
      '/admin/doctors/doc-chen?tab=documents',
      '/admin/doctors/:doctorId',
      <DoctorProfilePage />,
    );
    await screen.findByRole('heading', { level: 2, name: /Medical licence/ });

    // The ordering half of the defect, not just the level: three cards used to
    // precede the `Verification` h2 they looked like children of.
    expectSoundHeadingOutline();
  });
});

/**
 * The **not-found** state of a detail route, which the first two passes both
 * missed because they only ever visited ids that resolved.
 *
 * Seven routes rendered their "no such thing" state with no `h1` at all: the
 * page's real heading is the patient's or the record's name, and when there is
 * no record there is no name — leaving `EmptyState`'s `h2` (or, on the admin
 * side, `ErrorState`'s paragraph) as the whole outline. On these pages
 * "Patient not found" *is* the page title, which is what `headingLevel` on
 * those two components now expresses.
 *
 * Driven with an id that cannot resolve, which is exactly how it was found —
 * `/doctor/patients/NOPE-9999` and its six siblings.
 */
describe('heading outlines in the not-found state (F-17)', () => {
  it.each([
    ['/doctor/patients/:patientId', 'NOPE-9999', <PatientProfilePage />, 'Patient not found'],
    ['/doctor/labs/:labId', 'NOT-A-LAB', <LabDetailPage />, 'Lab result not found'],
    [
      '/doctor/pharmacy/:prescriptionId',
      'RX-000000',
      <PrescriptionDetailPage />,
      'Prescription not found',
    ],
    [
      '/doctor/medical-records/:recordId',
      'MR-99999',
      <MedicalRecordDetailPage />,
      'Record not found',
    ],
  ] as const)(
    '%s with an unresolvable id titles the page with the failure',
    async (routePath, id, element, heading) => {
      const path = routePath.replace(/:[^/]+$/, id);
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppProviders>
            <Routes>
              <Route path={routePath} element={element} />
            </Routes>
          </AppProviders>
        </MemoryRouter>,
      );

      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5000 });

      expectSoundHeadingOutline();
    },
  );
});
