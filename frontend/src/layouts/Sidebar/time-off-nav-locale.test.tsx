import type { ReactNode } from 'react';

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_DOCTOR_PROFILE } from '@/app/providers/DoctorProfileProvider';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { LOCALES, loadCatalogue, type Locale } from '@/i18n';
import { LocaleContext } from '@/i18n/locale-context';

import { doctorNavigation } from '../navigation';

import { AppSidebar } from './AppSidebar';

/**
 * The Appointments group's two time-off children, in English and Arabic:
 * translated labels in the catalogue's words, in order, and exactly one child
 * lit on each time-off route — the same in a right-to-left locale.
 */

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'doctor-1', name: 'Amelia Chen', role: 'doctor' } }),
  useCan: () => () => true,
  useDoctorProfile: () => ({ profile: { ...DEFAULT_DOCTOR_PROFILE, fullName: 'Dr. Amelia Chen' } }),
}));
vi.mock('./useActiveHospital', () => ({ useActiveHospital: () => null }));

beforeAll(async () => {
  await loadCatalogue('ar');
});

afterEach(() => {
  vi.clearAllMocks();
});

function InLocale({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <LocaleContext.Provider
      value={{
        locale,
        dir: locale === 'ar' ? 'rtl' : 'ltr',
        setLocale: () => undefined,
        locales: LOCALES,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

function renderSidebar(locale: Locale, path: string) {
  render(
    <InLocale locale={locale}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppSidebar config={doctorNavigation} collapsed={false} />
        </MemoryRouter>
      </ThemeProvider>
    </InLocale>,
  );
}

const LABELS = {
  en: {
    group: 'Appointments',
    children: ['Appointments', 'Add Appointment', 'Upcoming Time Off', 'Block Time Off'],
  },
  ar: {
    group: 'المواعيد',
    children: ['المواعيد', 'إضافة موعد', 'الإجازات القادمة', 'حجز إجازة'],
  },
} as const;

describe.each(['en', 'ar'] as const)('Appointments time-off children in %s', (locale) => {
  const labels = LABELS[locale];

  function groupLinks() {
    const nav = screen.getAllByRole('navigation')[0] as HTMLElement;
    const all = within(nav).getAllByRole('link');
    const start = all.findIndex((link) => link.textContent === labels.children[0]);
    return all.slice(start, start + labels.children.length);
  }

  it.each([
    ['/doctor/appointments/time-off', 2],
    ['/doctor/appointments/time-off/new', 3],
  ])('on %s lists the four children in order and lights exactly one', (path, litIndex) => {
    renderSidebar(locale, path);

    const links = groupLinks();
    expect(links.map((link) => link.textContent)).toEqual([...labels.children]);
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(labels.children[litIndex] as string);
  });
});
