import { CalendarCheck, FlaskConical, LayoutDashboard, Settings, Users, type LucideIcon } from 'lucide-react';

import { useAuth, useCan } from '@/app/providers';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { Card, LinkButton } from '@/components/ui';
import { routes } from '@/routes';
import type { Permission } from '@/types/auth';

/**
 * A staff workspace's home (DEC-006a): what this role can do here today, and
 * — said as plainly — what it cannot yet, because the server does not serve
 * it to the role. Nothing unavailable is drawn as a link or a button; it is a
 * sentence, so nobody presses something that was never going to work.
 *
 * The lists are data, one entry per role, so the three homes cannot drift
 * into three designs.
 */

export type StaffRole = 'reception' | 'laboratory' | 'pharmacy';

interface Destination {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** The capability the sidebar item for this destination requires; none for always-open ones. */
  readonly permission?: Permission;
}

interface StaffHome {
  readonly title: string;
  readonly available: readonly Destination[];
  readonly unavailable: readonly { readonly title: string; readonly description: string }[];
}

const SHARED_TAIL = (settings: string, patients: string): readonly Destination[] => [
  {
    title: 'Patient directory',
    description: 'Look up a registered patient by Patient ID. Identifiers are masked.',
    href: patients,
    icon: Users,
    permission: 'patients.view',
  },
  {
    title: 'Account and security',
    description: 'Your sign-in details, password, two-factor authentication and sessions.',
    href: settings,
    icon: Settings,
  },
];

const HOMES: { readonly [R in StaffRole]: StaffHome } = {
  reception: {
    title: 'Reception',
    available: [
      {
        title: 'Appointment oversight',
        description:
          'Every appointment across the clinic: what is waiting too long, reminders, and reassigning to another doctor.',
        href: routes.reception.appointments,
        icon: CalendarCheck,
        permission: 'appointments.reassign',
      },
      ...SHARED_TAIL(routes.reception.settings(), routes.reception.patients),
    ],
    unavailable: [
      {
        title: 'Booking, rescheduling and cancelling for a doctor',
        description:
          'The appointment book can only be changed by the doctor who owns it. Booking on a doctor’s behalf needs a server capability that does not exist yet.',
      },
      {
        title: 'Check-in and the waiting room',
        description:
          'The queue and waiting room are not connected to live data yet; where they are shown they are read-only for reception. Changing them is administrator-only.',
      },
    ],
  },
  laboratory: {
    title: 'Laboratory',
    available: [
      {
        title: 'Test catalogue',
        description: 'The tests the laboratory offers, with specimen, container and analytes.',
        href: routes.laboratory.catalogue,
        icon: FlaskConical,
        permission: 'labs.review',
      },
      ...SHARED_TAIL(routes.laboratory.settings(), routes.laboratory.patients),
    ],
    unavailable: [
      {
        title: 'Lab orders, result entry and order progress',
        description:
          'The server does not yet give laboratory accounts access to orders. Until it decides which orders a technician may work on, the worklist, entering results and moving an order along cannot be offered here.',
      },
    ],
  },
  pharmacy: {
    title: 'Pharmacy',
    available: [...SHARED_TAIL(routes.pharmacy.settings(), routes.pharmacy.patients)],
    unavailable: [
      {
        title: 'Viewing and dispensing prescriptions',
        description:
          'The server does not yet give pharmacy accounts any access to prescriptions, so the prescription queue and dispensing cannot be offered here.',
      },
    ],
  },
};

export function StaffHomePage({ role }: { role: StaffRole }) {
  const { user } = useAuth();
  const can = useCan();
  const home = HOMES[role];
  // The same capability filter as the sidebar: a revoked grant removes the card.
  const available = home.available.filter(
    (destination) => destination.permission === undefined || can(destination.permission),
  );

  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title={home.title}
          caption={user === null ? undefined : `Signed in as ${user.name}`}
          icon={LayoutDashboard}
        />

        <section aria-labelledby="staff-available">
          <h2 id="staff-available" className="mb-3 text-h5 text-text-primary">
            What you can do here
          </h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {available.map((destination) => {
              const Icon = destination.icon;
              return (
                <li key={destination.href}>
                  <Card padding="compact" className="h-full">
                    <div className="flex h-full flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Icon aria-hidden="true" className="h-4 w-4 text-text-secondary" />
                        <h3 className="text-body-sm font-semibold text-text-primary">
                          {destination.title}
                        </h3>
                      </div>
                      <p className="flex-1 text-body-sm text-text-secondary">
                        {destination.description}
                      </p>
                      <div>
                        <LinkButton href={destination.href} variant="secondary" size="sm">
                          Open {destination.title.toLowerCase()}
                        </LinkButton>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="staff-unavailable">
          <h2 id="staff-unavailable" className="mb-3 text-h5 text-text-primary">
            Not available yet
          </h2>
          <Card padding="compact">
            <ul className="flex flex-col divide-y divide-border">
              {home.unavailable.map((item) => (
                <li key={item.title} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-body-sm font-medium text-text-primary">{item.title}</p>
                  <p className="mt-0.5 text-body-sm text-text-secondary">{item.description}</p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </PageSections>
    </PageContainer>
  );
}
