import { selectService, unavailableService } from '@/api/seam';

import type {
  ClinicAnnouncement,
  ClinicProfile,
  ClinicService,
  Holiday,
  OpeningDay,
} from './model/types';

/**
 * Clinic information.
 *
 * The fixture is a plausible single clinic for development. The HTTP
 * adapter is unavailable. BE-11's `GET /public/clinic` and `/clinic/hours`
 * are superseded by the signed-in `GET /patient/hospitals` and
 * `/patient/hospitals/:id` (DR-09; `docs/multi-hospital/
 * API_CONTRACT_CHANGES.md` §5), which are not built; `platform_settings`
 * is reachable only behind `can:settings.manageSystem`. The `'BE-11'`
 * label below is the dependency name the seam reports, left as it is.
 */
const PROFILE: ClinicProfile = {
  name: 'Medora Clinic',
  addressLine: '14 Al-Nahda Street',
  city: 'Amman',
  country: 'Jordan',
  phone: '+962 6 000 0000',
  website: 'https://example.invalid',
};

const HOURS: readonly OpeningDay[] = [
  { weekday: 'sunday', opensAt: '08:00', closesAt: '17:00', closed: false },
  { weekday: 'monday', opensAt: '08:00', closesAt: '17:00', closed: false },
  { weekday: 'tuesday', opensAt: '08:00', closesAt: '17:00', closed: false },
  { weekday: 'wednesday', opensAt: '08:00', closesAt: '17:00', closed: false },
  { weekday: 'thursday', opensAt: '08:00', closesAt: '14:00', closed: false },
  { weekday: 'friday', opensAt: null, closesAt: null, closed: true },
  { weekday: 'saturday', opensAt: '09:00', closesAt: '13:00', closed: false },
];

const HOLIDAYS: readonly Holiday[] = [
  { id: 'H-01', name: 'New Year', date: '2027-01-01' },
  { id: 'H-02', name: 'Independence Day', date: '2027-05-25' },
];

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/**
 * Three, in the order a server would send them: the pinned one first,
 * then newest. The set covers all three priorities, because `high` is
 * the only one that changes how the card renders and a fixture where
 * everything is `normal` produces a component that only works when
 * everything is normal.
 */
const ANNOUNCEMENTS: readonly ClinicAnnouncement[] = [
  {
    id: 'AN-1',
    title: 'Friday clinic closed for maintenance',
    body: 'The clinic will be closed all day on Friday. Appointments booked for that day have been moved and you will hear from us.',
    priority: 'high',
    pinned: true,
    publishedAt: daysAgo(2),
  },
  {
    id: 'AN-2',
    title: 'Flu vaccinations are available',
    body: 'Ask at reception or mention it at your next visit. No appointment is needed.',
    priority: 'normal',
    pinned: false,
    publishedAt: daysAgo(9),
  },
  {
    id: 'AN-3',
    title: 'New entrance on Al-Nahda Street',
    body: 'The side entrance is now step-free and is the closest one to the pharmacy.',
    priority: 'low',
    pinned: false,
    publishedAt: daysAgo(30),
  },
];

const fixtureClinicService: ClinicService = {
  async getProfile() {
    return PROFILE;
  },
  async getOpeningHours() {
    return HOURS;
  },
  async getHolidays() {
    return HOLIDAYS;
  },
  async listAnnouncements() {
    return ANNOUNCEMENTS;
  },
};

export const clinicService: ClinicService = selectService({
  fixture: fixtureClinicService,
  http: unavailableService<ClinicService>('BE-11', 'capability.clinic', [
    'getProfile',
    'getOpeningHours',
    'getHolidays',
    'listAnnouncements',
  ]),
});
