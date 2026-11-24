import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_DOCTOR_PROFILE } from '@/app/providers/DoctorProfileProvider';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

import { MobileNavDrawer } from '../MobileNavDrawer';
import {
  adminNavigation,
  doctorNavigation,
  pharmacyNavigation,
  receptionNavigation,
  type NavigationConfig,
} from '../navigation';

import { AppSidebar } from './AppSidebar';

/**
 * The sidebar's account card shows a professional profile only for a doctor.
 *
 * The demo seeds the practitioner profile — "MD, FACP", a photo slot, a
 * licence — for every account, and the card read it regardless, so a
 * receptionist was captioned with a physician's credentials under their own
 * name. Only a practitioner has a profile behind `/me/profile`; the avatar
 * menu already applied that rule and the card now applies the same one.
 */

const auth = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  denied: [] as string[],
}));

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: auth.user }),
  useCan: () => (permission: string) => !auth.denied.includes(permission),
  useDoctorProfile: () => ({
    profile: { ...DEFAULT_DOCTOR_PROFILE, fullName: 'Dr. Amelia Chen' },
  }),
}));

// The active-hospital line queries the API; its own behaviour is covered by
// `ActiveHospital.test.tsx`. Here only its placement in the card is checked.
const activeHospital = vi.hoisted(() => ({
  value: null as { id: string; name: string } | null,
}));
vi.mock('./useActiveHospital', () => ({ useActiveHospital: () => activeHospital.value }));

afterEach(() => {
  auth.user = null;
  auth.denied = [];
  activeHospital.value = null;
});

function PathProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

/** In-app navigation, as a link or a page button would do it. */
function Navigator() {
  const navigate = useNavigate();
  return (
    <>
      {[
        '/doctor/overview',
        '/doctor/patients',
        '/doctor/pharmacy',
        '/doctor/pharmacy/new',
        '/doctor/medical-records',
        '/doctor/medical-records/new',
        '/doctor/appointments',
        '/doctor/appointments/new',
      ].map((to) => (
        <button key={to} type="button" onClick={() => navigate(to)}>
          {`go ${to}`}
        </button>
      ))}
      <button type="button" onClick={() => navigate(-1)}>
        go back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        go forward
      </button>
    </>
  );
}

function renderAs(
  role: string,
  name: string,
  config: NavigationConfig,
  collapsed = false,
  path = '/',
) {
  auth.user = { id: `${role}-1`, name, role };
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppSidebar config={config} collapsed={collapsed} />
        <PathProbe />
        <Navigator />
        <button type="button">outside</button>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AppSidebar account card', () => {
  it('shows a doctor’s profile name and credentials', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation);
    expect(screen.getByText('Dr. Amelia Chen')).toBeInTheDocument();
    expect(screen.getByText('MD, FACP')).toBeInTheDocument();
  });

  it.each([
    ['reception', 'Sara Haddad', receptionNavigation],
    ['pharmacy', 'Lina Farouk', pharmacyNavigation],
    ['admin', 'Platform Admin', adminNavigation],
  ] as const)('captions a %s account with its role, never a physician’s', (role, name, config) => {
    renderAs(role, name, config);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText(role)).toBeInTheDocument();
    expect(screen.queryByText('MD, FACP')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Amelia Chen')).not.toBeInTheDocument();
  });
});

describe('AppSidebar active hospital (WEB-1)', () => {
  it('shows the doctor’s active hospital under the name and credentials', () => {
    activeHospital.value = { id: 'h-1', name: 'Al Noor Hospital' };
    renderAs('doctor', 'Amelia Chen', doctorNavigation);
    const hospital = screen.getByText('Al Noor Hospital');
    expect(hospital.parentElement).toHaveTextContent('Active hospital: Al Noor Hospital');
    const caption = screen.getByText('MD, FACP');
    expect(
      caption.compareDocumentPosition(hospital) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('adds nothing to the card when there is no active hospital', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation);
    expect(screen.queryByText(/Active hospital/)).not.toBeInTheDocument();
  });

  it('is hidden with the rest of the card text on the collapsed rail', () => {
    activeHospital.value = { id: 'h-1', name: 'Al Noor Hospital' };
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true);
    expect(screen.queryByText('Al Noor Hospital')).not.toBeInTheDocument();
  });
});

describe('AppSidebar theme switch', () => {
  it('sits at the foot of the sidebar, just above the account card, with no visible label', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group.textContent).toBe('');
    // Above the account card: the switch comes first in document order.
    const name = screen.getByText('Dr. Amelia Chen');
    expect(group.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and below Settings / Help.
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(settings.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();
  });

  it('stacks vertically on the collapsed rail', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
  });
});

/**
 * Pharmacy is a group: its parent opens a list (Prescriptions · New
 * Prescription) instead of navigating, stays lit on any pharmacy route, and
 * on the collapsed rail opens the same list as a flyout.
 */
describe('AppSidebar Pharmacy group', () => {
  const parent = () => screen.getByRole('button', { name: 'Pharmacy' });
  const link = (name: string) => screen.getByRole('link', { name });

  it('opens by itself on the prescription list, with Prescriptions current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('Prescriptions')).toHaveAttribute('href', '/doctor/pharmacy');
    expect(link('Prescriptions')).toHaveAttribute('aria-current', 'page');
    expect(link('New Prescription')).toHaveAttribute('href', '/doctor/pharmacy/new');
    expect(link('New Prescription')).not.toHaveAttribute('aria-current');
  });

  it('opens on a direct visit to the new-prescription route, with that child current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('New Prescription')).toHaveAttribute('aria-current', 'page');
    expect(link('Prescriptions')).not.toHaveAttribute('aria-current');
  });

  it('keeps Prescriptions current on a prescription’s own page', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy/rx-1001');
    expect(link('Prescriptions')).toHaveAttribute('aria-current', 'page');
  });

  it('is shut elsewhere, and its parent toggles the list without navigating', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(parent().className).not.toContain('bg-primary-subtle');
    expect(parent().tagName).toBe('BUTTON');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');
  });

  it('labels its list child Prescriptions, never the old “All Prescriptions”', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
    expect(screen.getByRole('link', { name: 'Prescriptions' })).toHaveAttribute(
      'href',
      '/doctor/pharmacy',
    );
    expect(screen.queryByText('All Prescriptions')).not.toBeInTheDocument();
  });

  it('hides New Prescription from a user without prescriptions.create', () => {
    auth.denied = ['prescriptions.create'];
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
    expect(link('Prescriptions')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Prescription' })).not.toBeInTheDocument();
  });

  describe('following the route', () => {
    const go = (to: string) => fireEvent.click(screen.getByRole('button', { name: `go ${to}` }));

    it('closes when the user navigates away from every pharmacy page', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
      expect(parent()).toHaveAttribute('aria-expanded', 'true');

      go('/doctor/overview');
      expect(parent()).toHaveAttribute('aria-expanded', 'false');
      expect(parent().className).not.toContain('bg-primary-subtle');
    });

    it('stays open moving between its pages, highlighting the right child', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
      go('/doctor/pharmacy/new');
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
      expect(link('New Prescription')).toHaveAttribute('aria-current', 'page');
      expect(link('Prescriptions')).not.toHaveAttribute('aria-current');

      go('/doctor/pharmacy');
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
      expect(link('Prescriptions')).toHaveAttribute('aria-current', 'page');
    });

    it('follows back and forward: shut outside, open with the right child inside', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy/new');
      go('/doctor/overview');
      expect(parent()).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(screen.getByRole('button', { name: 'go back' }));
      expect(screen.getByTestId('path')).toHaveTextContent('/doctor/pharmacy/new');
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
      expect(link('New Prescription')).toHaveAttribute('aria-current', 'page');

      fireEvent.click(screen.getByRole('button', { name: 'go forward' }));
      expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');
      expect(parent()).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps a manual close while the user stays on the page, and reopens on the next pharmacy navigation', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/pharmacy');
      fireEvent.click(parent());
      expect(parent()).toHaveAttribute('aria-expanded', 'false');
      expect(parent().className).toContain('bg-primary-subtle');

      go('/doctor/pharmacy/new');
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes a group opened by hand elsewhere on the next navigation', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
      fireEvent.click(parent());
      expect(parent()).toHaveAttribute('aria-expanded', 'true');

      go('/doctor/patients');
      expect(parent()).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('on the collapsed rail', () => {
    const flyout = () => screen.queryByRole('group', { name: 'Pharmacy' });

    it('marks each group with a chevron — Patients, Appointments, Medical Records, Labs and Pharmacy, and no plain item', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      const chevrons = screen.getAllByTestId('sidebar-group-chevron');
      expect(chevrons).toHaveLength(5);
      const patients = screen.getByRole('button', { name: 'Patients' });
      const appointments = screen.getByRole('button', { name: 'Appointments' });
      const records = screen.getByRole('button', { name: 'Medical Records' });
      const labs = screen.getByRole('button', { name: 'Labs' });
      expect(chevrons.filter((chevron) => parent().contains(chevron))).toHaveLength(1);
      expect(chevrons.filter((chevron) => patients.contains(chevron))).toHaveLength(1);
      expect(chevrons.filter((chevron) => appointments.contains(chevron))).toHaveLength(1);
      expect(chevrons.filter((chevron) => records.contains(chevron))).toHaveLength(1);
      expect(chevrons.filter((chevron) => labs.contains(chevron))).toHaveLength(1);
      for (const chevron of chevrons) expect(chevron).toHaveAttribute('aria-hidden', 'true');
      // The chevron is decoration: the accessible name is unchanged.
      expect(parent()).toHaveAccessibleName('Pharmacy');
      expect(patients).toHaveAccessibleName('Patients');
      expect(appointments).toHaveAccessibleName('Appointments');
      expect(records).toHaveAccessibleName('Medical Records');
      expect(labs).toHaveAccessibleName('Labs');
    });

    it('lists Prescriptions in the flyout, never the old “All Prescriptions”', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      expect(within(flyout()!).getByRole('link', { name: 'Prescriptions' })).toHaveAttribute(
        'href',
        '/doctor/pharmacy',
      );
      expect(screen.queryByText('All Prescriptions')).not.toBeInTheDocument();
    });

    it('shows no rail chevron in the expanded sidebar, where the inline chevron is used', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
      expect(screen.queryByTestId('sidebar-group-chevron')).not.toBeInTheDocument();
    });

    it('opens a flyout with both destinations, focused on the first', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/pharmacy');
      expect(flyout()).not.toBeInTheDocument();
      expect(parent()).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(parent());
      const group = flyout();
      expect(group).toBeInTheDocument();
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
      expect(within(group!).getByRole('link', { name: 'Prescriptions' })).toHaveFocus();
      expect(within(group!).getByRole('link', { name: 'New Prescription' })).toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/doctor/pharmacy');
    });

    it('closes on Escape and returns focus to Pharmacy', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(flyout()).not.toBeInTheDocument();
      expect(parent()).toHaveFocus();
    });

    it('closes on an outside click', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
      expect(flyout()).not.toBeInTheDocument();
    });

    it('closes when a destination is chosen', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      fireEvent.click(within(flyout()!).getByRole('link', { name: 'New Prescription' }));
      expect(flyout()).not.toBeInTheDocument();
    });
  });
});

/**
 * Appointments is a group built exactly like Medical Records: its parent opens
 * a list (Appointments · Add Appointment) instead of navigating, stays lit on
 * any appointments route, and on the collapsed rail opens the same list as a
 * flyout. Both children are existing pages — the book and the three-step
 * booking page — at their existing routes; nothing opens the retired dialog.
 */
describe('AppSidebar Appointments group', () => {
  const parent = () => screen.getByRole('button', { name: 'Appointments' });
  const link = (name: string) => screen.getByRole('link', { name });
  const go = (to: string) => fireEvent.click(screen.getByRole('button', { name: `go ${to}` }));

  it('keeps its place and calendar icon, as a disclosure button rather than a link', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    const items = doctorNavigation.sections[0]?.items.map((item) => item.id);
    expect(items?.indexOf('appointments')).toBe(2);
    expect(doctorNavigation.sections[0]?.items[2]?.icon.displayName).toBe('Calendar');
    expect(parent().tagName).toBe('BUTTON');
    expect(parent()).not.toHaveAttribute('href');
  });

  it('opens by itself on the appointments list, with Appointments current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/appointments');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('Appointments')).toHaveAttribute('href', '/doctor/appointments');
    expect(link('Appointments')).toHaveAttribute('aria-current', 'page');
    expect(link('Add Appointment')).toHaveAttribute('href', '/doctor/appointments/new');
    expect(link('Add Appointment')).not.toHaveAttribute('aria-current');
  });

  it('opens on a direct visit to the booking page, with Add Appointment current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/appointments/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('Add Appointment')).toHaveAttribute('aria-current', 'page');
    expect(link('Appointments')).not.toHaveAttribute('aria-current');
  });

  it('keeps Appointments current on an appointment’s own page', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/appointments/APT-2401');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(link('Appointments')).toHaveAttribute('aria-current', 'page');
    expect(link('Add Appointment')).not.toHaveAttribute('aria-current');
  });

  it('is shut elsewhere, and its parent toggles the list without navigating', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(parent().className).not.toContain('bg-primary-subtle');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');
  });

  it('offers exactly the list and the booking page — never the retired dialog', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    fireEvent.click(parent());
    const list = parent().parentElement?.querySelector('ul');
    expect(list).not.toBeNull();
    // Sub-items are anchors (a full navigation), as every group's are, so the
    // destination is the href; jsdom does not load pages.
    expect(
      within(list!)
        .getAllByRole('link')
        .map((anchor) => [anchor.textContent, anchor.getAttribute('href')]),
    ).toEqual([
      ['Appointments', '/doctor/appointments'],
      ['Add Appointment', '/doctor/appointments/new'],
    ]);
    expect(screen.queryByRole('link', { name: /book=/ })).not.toBeInTheDocument();
  });

  it('follows back and forward', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/appointments/new');
    go('/doctor/patients');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'go back' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/appointments/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(link('Add Appointment')).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'go forward' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/patients');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
  });

  it('hands over to Medical Records: moving between the two groups opens one and shuts the other', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/appointments');
    const records = () => screen.getByRole('button', { name: 'Medical Records' });
    expect(records()).toHaveAttribute('aria-expanded', 'false');

    go('/doctor/medical-records');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(records()).toHaveAttribute('aria-expanded', 'true');

    go('/doctor/appointments/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(records()).toHaveAttribute('aria-expanded', 'false');
  });

  describe('on the collapsed rail', () => {
    const flyout = () => screen.queryByRole('group', { name: 'Appointments' });

    it('opens a flyout with both destinations, focused on the first, without navigating', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/appointments/new');
      expect(flyout()).not.toBeInTheDocument();
      expect(parent().className).toContain('bg-primary-subtle');

      fireEvent.click(parent());
      const group = flyout();
      expect(group).toBeInTheDocument();
      expect(within(group!).getByRole('link', { name: 'Appointments' })).toHaveFocus();
      expect(within(group!).getByRole('link', { name: 'Add Appointment' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByTestId('path')).toHaveTextContent('/doctor/appointments/new');
    });

    it('closes when a destination is chosen, which points at the booking page', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      const add = within(flyout()!).getByRole('link', { name: 'Add Appointment' });
      expect(add).toHaveAttribute('href', '/doctor/appointments/new');
      fireEvent.click(add);
      expect(flyout()).not.toBeInTheDocument();
    });
  });
});

/**
 * Medical Records is a group built exactly like Pharmacy: its parent opens a
 * list (Medical Records · New Medical Record) instead of navigating, stays lit
 * on any records route, and on the collapsed rail opens the same list as a
 * flyout. Both children are the existing pages — the list and the authoring
 * flow — at their existing routes.
 */
describe('AppSidebar Medical Records group', () => {
  const parent = () => screen.getByRole('button', { name: 'Medical Records' });
  const link = (name: string) => screen.getByRole('link', { name });
  const go = (to: string) => fireEvent.click(screen.getByRole('button', { name: `go ${to}` }));

  it('is a disclosure button, not a link', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    expect(parent().tagName).toBe('BUTTON');
    expect(parent()).not.toHaveAttribute('href');
    expect(parent().closest('a')).toBeNull();
  });

  it('opens by itself on the records list, with Medical Records current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('Medical Records')).toHaveAttribute('href', '/doctor/medical-records');
    expect(link('Medical Records')).toHaveAttribute('aria-current', 'page');
    expect(link('New Medical Record')).toHaveAttribute('href', '/doctor/medical-records/new');
    expect(link('New Medical Record')).not.toHaveAttribute('aria-current');
  });

  it('opens on a direct visit to the new-record route, with that child current', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('New Medical Record')).toHaveAttribute('aria-current', 'page');
    expect(link('Medical Records')).not.toHaveAttribute('aria-current');
  });

  it('keeps Medical Records current on a record’s own page', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records/MR-2041');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(link('Medical Records')).toHaveAttribute('aria-current', 'page');
    expect(link('New Medical Record')).not.toHaveAttribute('aria-current');
  });

  it('is shut elsewhere, and its parent toggles the list without navigating', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(parent().className).not.toContain('bg-primary-subtle');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');
  });

  it('lets the user shut and reopen it by hand while staying on a records page', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records');
    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(parent().className).toContain('bg-primary-subtle');
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/medical-records');

    fireEvent.click(parent());
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides New Medical Record from a user without records.edit', () => {
    auth.denied = ['records.edit'];
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records');
    expect(link('Medical Records')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Medical Record' })).not.toBeInTheDocument();
  });

  it('follows the route: open with the right child inside, shut once the user leaves', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records');
    go('/doctor/medical-records/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(link('New Medical Record')).toHaveAttribute('aria-current', 'page');

    go('/doctor/overview');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(parent().className).not.toContain('bg-primary-subtle');
  });

  it('follows back and forward', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records/new');
    go('/doctor/patients');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'go back' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/medical-records/new');
    expect(parent()).toHaveAttribute('aria-expanded', 'true');
    expect(link('New Medical Record')).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'go forward' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/patients');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
  });

  it('hands over to Pharmacy: moving between the two groups opens one and shuts the other', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records');
    const pharmacy = () => screen.getByRole('button', { name: 'Pharmacy' });
    expect(pharmacy()).toHaveAttribute('aria-expanded', 'false');

    go('/doctor/pharmacy');
    expect(parent()).toHaveAttribute('aria-expanded', 'false');
    expect(pharmacy()).toHaveAttribute('aria-expanded', 'true');
    expect(link('Prescriptions')).toHaveAttribute('aria-current', 'page');
  });

  describe('on the collapsed rail', () => {
    const flyout = () => screen.queryByRole('group', { name: 'Medical Records' });

    it('opens a flyout with both destinations, focused on the first, without navigating', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/medical-records');
      expect(flyout()).not.toBeInTheDocument();
      expect(parent().className).toContain('bg-primary-subtle');

      fireEvent.click(parent());
      const group = flyout();
      expect(group).toBeInTheDocument();
      expect(parent()).toHaveAttribute('aria-expanded', 'true');
      expect(within(group!).getByRole('link', { name: 'Medical Records' })).toHaveFocus();
      expect(within(group!).getByRole('link', { name: 'New Medical Record' })).toHaveAttribute(
        'href',
        '/doctor/medical-records/new',
      );
      expect(screen.getByTestId('path')).toHaveTextContent('/doctor/medical-records');
    });

    it('closes on Escape and returns focus to Medical Records', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(flyout()).not.toBeInTheDocument();
      expect(parent()).toHaveFocus();
    });

    it('closes on an outside click', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
      expect(flyout()).not.toBeInTheDocument();
    });

    it('closes when a destination is chosen', () => {
      renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
      fireEvent.click(parent());
      const destination = within(flyout()!).getByRole('link', { name: 'New Medical Record' });
      expect(destination).toHaveAttribute('href', '/doctor/medical-records/new');
      fireEvent.click(destination);
      expect(flyout()).not.toBeInTheDocument();
    });
  });
});

/**
 * The phone drawer is the expanded sidebar in a dialog, so it carries both
 * groups with the same children.
 */
describe('MobileNavDrawer groups', () => {
  it('shows the Medical Records and Pharmacy children, open on their own route', () => {
    auth.user = { id: 'doctor-1', name: 'Amelia Chen', role: 'doctor' };
    // jsdom has no modal dialogs — the same stand-in the other drawer suites use.
    const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto['close'] = function close(this: HTMLDialogElement) {
      this.open = false;
    };
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/doctor/medical-records']}>
          <MobileNavDrawer open onClose={() => undefined} config={doctorNavigation} />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const drawer = screen.getByRole('dialog', { hidden: true });
    const records = within(drawer).getByRole('button', { name: 'Medical Records', hidden: true });
    expect(records).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(drawer).getByRole('link', { name: 'Medical Records', hidden: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(drawer).getByRole('link', { name: 'New Medical Record', hidden: true }),
    ).toHaveAttribute('href', '/doctor/medical-records/new');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Pharmacy', hidden: true }));
    expect(
      within(drawer).getByRole('link', { name: 'Prescriptions', hidden: true }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole('link', { name: 'New Prescription', hidden: true }),
    ).toBeInTheDocument();
  });
});

/**
 * The footer (Settings · Help · theme · account) is tighter in the mobile
 * drawer only: less padding and spacing, 40px touch rows, a safe-area inset
 * at the bottom. The desktop sidebar keeps its original footer, and neither
 * changes a font size.
 */
describe('AppSidebar footer density', () => {
  function footerOf(nav: HTMLElement) {
    const settings = within(nav).getByRole('link', { name: 'Settings', hidden: true });
    const stack = settings.parentElement as HTMLElement;
    return { settings, stack, region: stack.parentElement as HTMLElement };
  }

  it('keeps the desktop footer unchanged', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation);
    const { settings, stack, region } = footerOf(screen.getByRole('navigation'));
    expect(region).toHaveClass('p-3');
    expect(region.className).not.toMatch(/safe-area/);
    expect(stack).toHaveClass('gap-1');
    expect(stack).not.toHaveAttribute('data-footer-density');
    expect(settings).toHaveClass('touch:h-11', 'text-body-sm');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveClass('touch:h-11');
    expect(screen.getByRole('radiogroup', { name: 'Theme' }).parentElement).toHaveClass('mt-2');
    expect(screen.getByText('Dr. Amelia Chen').closest('.gap-3')).toHaveClass('py-2');
  });

  it('is compact in the mobile drawer', () => {
    auth.user = { id: 'doctor-1', name: 'Amelia Chen', role: 'doctor' };
    const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto['close'] = function close(this: HTMLDialogElement) {
      this.open = false;
    };
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/doctor/overview']}>
          <MobileNavDrawer open onClose={() => undefined} config={doctorNavigation} />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const drawer = screen.getByRole('dialog', { hidden: true });
    const { settings, stack, region } = footerOf(drawer);
    expect(region).toHaveClass('px-3', 'py-2', 'pb-[max(0.5rem,env(safe-area-inset-bottom))]');
    expect(stack).toHaveAttribute('data-footer-density', 'compact');
    expect(stack).toHaveClass('gap-0.5');
    expect(stack).not.toHaveClass('gap-1');
    expect(settings).toHaveClass('touch:h-10', 'text-body-sm');
    expect(settings).not.toHaveClass('touch:h-11');
    expect(within(drawer).getByRole('link', { name: 'Help', hidden: true })).toHaveClass(
      'touch:h-10',
    );
    const theme = within(drawer).getByRole('radiogroup', { name: 'Theme', hidden: true });
    expect(theme.parentElement).toHaveClass('mt-1');
    expect(theme.parentElement).not.toHaveClass('mt-2');
    const card = within(drawer).getByText('Dr. Amelia Chen').closest('.gap-3');
    expect(card).toHaveClass('py-1');
    expect(card).not.toHaveClass('py-2');
  });
});

/**
 * The collapsed rail shows icons only: no tooltip and no native `title`
 * appears beside any of them on hover or focus — the navigation items, the
 * footer's Settings and Help, the theme switch, the Pharmacy group. Every
 * icon keeps its name as its accessible label.
 */
describe('AppSidebar collapsed rail — no hover labels', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows no tooltip on hover or focus of any rail control, after any delay', () => {
    vi.useFakeTimers();
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
    const rail = screen.getByRole('navigation', { name: 'Main' });
    const controls = within(rail).getAllByRole('link').concat(within(rail).getAllByRole('button'));
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      fireEvent.mouseEnter(control);
      fireEvent.mouseOver(control);
      fireEvent.focus(control);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      fireEvent.mouseLeave(control);
      fireEvent.blur(control);
    }
  });

  it('carries no native title tooltip anywhere on the rail', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(rail.querySelectorAll('[title]')).toHaveLength(0);
    expect(rail.querySelectorAll('svg title')).toHaveLength(0);
  });

  it('keeps every icon’s accessible name', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
    for (const name of ['Overview', 'Messages', 'Settings', 'Help']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Patients' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Labs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appointments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pharmacy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Medical Records' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light theme' })).toBeInTheDocument();
  });

  it('leaves the expanded sidebar’s visible labels as they were', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    for (const label of ['Overview', 'Pharmacy', 'Messages', 'Settings']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    // Patients is a group now, and its first child repeats the label (as
    // Appointments' does): the group's own visible label is the one to check.
    expect(screen.getByRole('button', { name: 'Patients' })).toBeVisible();
  });
});

/**
 * Queue and Waiting Room are reception destinations now: lit on their own
 * reception paths in the expanded sidebar and on the collapsed rail (icons
 * only, names kept for assistive technology), and absent from the admin
 * sidebar. The phone drawer is `staff-workspaces.test.tsx`'s.
 */
describe('AppSidebar reception — Queue and Waiting Room', () => {
  it.each([
    ['/reception/queue', 'Queue', 'Waiting Room'],
    ['/reception/waiting-room', 'Waiting Room', 'Queue'],
  ])('lights the right item on %s in the expanded sidebar', (path, current, other) => {
    renderAs('reception', 'Sara Haddad', receptionNavigation, false, path);
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('href', path);
    expect(screen.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Appointments' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText(current)).toBeVisible();
  });

  it('keeps both on the collapsed rail as named icons, lit, with no hover label', () => {
    vi.useFakeTimers();
    try {
      renderAs('reception', 'Sara Haddad', receptionNavigation, true, '/reception/queue');
      const rail = screen.getByRole('navigation', { name: 'Main' });
      const queue = within(rail).getByRole('link', { name: 'Queue' });
      const waiting = within(rail).getByRole('link', { name: 'Waiting Room' });
      expect(queue).toHaveAttribute('aria-current', 'page');
      expect(waiting).not.toHaveAttribute('aria-current');
      for (const control of [queue, waiting]) {
        fireEvent.mouseEnter(control);
        fireEvent.focus(control);
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        fireEvent.mouseLeave(control);
        fireEvent.blur(control);
      }
      expect(rail.querySelectorAll('[title]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not in the admin sidebar, expanded or collapsed', () => {
    for (const collapsed of [false, true]) {
      const { unmount } = render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/admin']}>
            <AppSidebar config={adminNavigation} collapsed={collapsed} />
          </MemoryRouter>
        </ThemeProvider>,
      );
      expect(screen.queryByRole('link', { name: 'Queue' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Waiting Room' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Rooms' })).toBeInTheDocument();
      unmount();
    }
  });
});

/**
 * An administrator has two settings destinations. The sidebar's Settings is
 * Platform Settings; personal preferences live in the avatar menu
 * (AvatarMenu.test.tsx). Pin the sidebar half so the two cannot swap or
 * collapse into one.
 */
describe('AppSidebar — administrator Settings destination', () => {
  it('points the footer Settings at Platform Settings, and offers no Help', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/admin']}>
          <AppSidebar config={adminNavigation} collapsed={false} />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/admin/settings',
    );
    expect(screen.queryByRole('link', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /preferences/i })).not.toBeInTheDocument();
  });
});

/**
 * The groups are a single-open accordion: opening one closes any other, the
 * open one closes when chosen again, and navigation opens the group that
 * holds the page and so closes the rest. Highlighting is independent of it:
 * a parent stays lit, and its current child marked, while its list is shut.
 */
describe('AppSidebar groups — single-open accordion', () => {
  const records = () => screen.getByRole('button', { name: 'Medical Records' });
  const pharmacy = () => screen.getByRole('button', { name: 'Pharmacy' });
  const go = (to: string) => fireEvent.click(screen.getByRole('button', { name: `go ${to}` }));
  const openState = () => [
    records().getAttribute('aria-expanded'),
    pharmacy().getAttribute('aria-expanded'),
  ];

  it('opening Pharmacy closes Medical Records', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    fireEvent.click(records());
    expect(openState()).toEqual(['true', 'false']);
    fireEvent.click(pharmacy());
    expect(openState()).toEqual(['false', 'true']);
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/overview');
  });

  it('opening Medical Records closes Pharmacy', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    fireEvent.click(pharmacy());
    expect(openState()).toEqual(['false', 'true']);
    fireEvent.click(records());
    expect(openState()).toEqual(['true', 'false']);
  });

  it('closes the open group when it is chosen again, leaving every group shut', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    fireEvent.click(pharmacy());
    fireEvent.click(pharmacy());
    expect(openState()).toEqual(['false', 'false']);
  });

  it('keeps the current page highlighted while its group is closed by another opening', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records/new');
    expect(openState()).toEqual(['true', 'false']);

    fireEvent.click(pharmacy());
    expect(openState()).toEqual(['false', 'true']);
    // Medical Records is still the active area, and New Medical Record the page.
    expect(records().className).toContain('bg-primary-subtle');
    expect(pharmacy().className).not.toContain('bg-primary-subtle');
    expect(screen.getByRole('link', { name: 'New Medical Record' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('swaps groups when navigation moves between their pages, back and forward included', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/medical-records/new');
    expect(openState()).toEqual(['true', 'false']);

    go('/doctor/pharmacy/new');
    expect(openState()).toEqual(['false', 'true']);
    expect(screen.getByRole('link', { name: 'New Prescription' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'go back' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/medical-records/new');
    expect(openState()).toEqual(['true', 'false']);

    fireEvent.click(screen.getByRole('button', { name: 'go forward' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/doctor/pharmacy/new');
    expect(openState()).toEqual(['false', 'true']);
  });

  it('opens the route’s group on navigation even after the user opened another by hand', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, false, '/doctor/overview');
    fireEvent.click(pharmacy());
    go('/doctor/medical-records');
    expect(openState()).toEqual(['true', 'false']);
  });

  it('shows one flyout at a time on the collapsed rail', () => {
    renderAs('doctor', 'Amelia Chen', doctorNavigation, true, '/doctor/overview');
    fireEvent.click(records());
    expect(screen.getByRole('group', { name: 'Medical Records' })).toBeInTheDocument();

    fireEvent.click(pharmacy());
    expect(screen.getByRole('group', { name: 'Pharmacy' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Medical Records' })).not.toBeInTheDocument();
    expect(openState()).toEqual(['false', 'true']);

    fireEvent.click(pharmacy());
    expect(screen.queryByRole('group', { name: 'Pharmacy' })).not.toBeInTheDocument();
  });

  it('applies in the phone drawer too', () => {
    auth.user = { id: 'doctor-1', name: 'Amelia Chen', role: 'doctor' };
    const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/doctor/medical-records']}>
          <MobileNavDrawer open onClose={() => undefined} config={doctorNavigation} />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const drawer = within(screen.getByRole('dialog', { hidden: true }));
    const button = (name: string) => drawer.getByRole('button', { name, hidden: true });
    expect(button('Medical Records')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button('Pharmacy'));
    expect(button('Pharmacy')).toHaveAttribute('aria-expanded', 'true');
    expect(button('Medical Records')).toHaveAttribute('aria-expanded', 'false');
    expect(drawer.getByRole('link', { name: 'Medical Records', hidden: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
