import { beforeAll, describe, expect, it } from 'vitest';

import { LOCALE_CODES } from '@/i18n/locales';
import { loadAllCatalogues, type PartialMessages } from '@/i18n/messages';

import { adminNavigation, doctorNavigation, receptionNavigation } from './navigation';

describe('doctorNavigation', () => {
  it('keeps Labs and Pharmacy as the Clinical section', () => {
    const clinical = doctorNavigation.sections.find(
      (section) => section.labelKey === 'nav.section.clinical',
    );
    expect(clinical?.items.map((item) => item.id)).toEqual(['my-clinic', 'labs', 'pharmacy']);
  });
});

describe('doctorNavigation Pharmacy group', () => {
  const pharmacy = doctorNavigation.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === 'pharmacy');

  it('keeps its own path for the bottom bar and search, and nests the two flows', () => {
    expect(pharmacy?.path).toBe('/doctor/pharmacy');
    expect(pharmacy?.children?.map((child) => [child.id, child.path])).toEqual([
      ['pharmacy-all', '/doctor/pharmacy'],
      ['pharmacy-new', '/doctor/pharmacy/new'],
    ]);
  });

  it('gates New Prescription on the existing prescriptions.create permission', () => {
    const create = pharmacy?.children?.find((child) => child.id === 'pharmacy-new');
    expect(create?.requiredPermission).toBe('prescriptions.create');
  });
});

describe('doctorNavigation Medical Records group', () => {
  const records = doctorNavigation.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === 'medical-records');

  it('keeps its own path for the bottom bar and search, and nests the existing list and form', () => {
    expect(records?.path).toBe('/doctor/medical-records');
    expect(records?.children?.map((child) => [child.id, child.labelKey, child.path])).toEqual([
      ['medical-records-all', 'nav.medicalRecords', '/doctor/medical-records'],
      ['medical-records-new', 'nav.medicalRecordsNew', '/doctor/medical-records/new'],
    ]);
  });

  it('gates New Medical Record on the existing records.edit permission, and nothing else', () => {
    expect(records?.requiredPermission).toBeUndefined();
    expect(records?.children?.[0]?.requiredPermission).toBeUndefined();
    expect(records?.children?.[1]?.requiredPermission).toBe('records.edit');
  });
});

describe('doctorNavigation Appointments group', () => {
  const appointments = doctorNavigation.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === 'appointments');

  it('keeps its own path for the bottom bar and search, and nests the list and the booking page', () => {
    expect(appointments?.path).toBe('/doctor/appointments');
    expect(appointments?.children?.map((child) => [child.id, child.labelKey, child.path])).toEqual([
      ['appointments-all', 'nav.appointments', '/doctor/appointments'],
      ['appointments-new', 'nav.appointmentsNew', '/doctor/appointments/new'],
    ]);
  });

  it('stays in the bottom bar under its own path', () => {
    expect(doctorNavigation.bottomTabIds).toContain('appointments');
  });

  it('labels Add Appointment in every locale', async () => {
    const catalogues = await loadAllCatalogues();
    expect(LOCALE_CODES.map((code) => catalogues[code]['nav.appointmentsNew'])).toEqual(
      LOCALE_CODES.map(
        (code) =>
          ({
            en: 'Add Appointment',
            ar: 'إضافة موعد',
            fa: 'افزودن نوبت',
            fr: 'Ajouter un rendez-vous',
            tr: 'Randevu ekle',
          })[code],
      ),
    );
  });
});

/**
 * The sidebar’s group labels in every supported locale: the Pharmacy list
 * child is "Prescriptions" (no longer "All Prescriptions"), and the Medical
 * Records children are the area’s own name and "New Medical Record".
 */
describe('doctor sidebar group labels in every locale', () => {
  let catalogues: Record<(typeof LOCALE_CODES)[number], PartialMessages>;
  beforeAll(async () => {
    catalogues = await loadAllCatalogues();
  });

  const expected = {
    en: ['Prescriptions', 'New Prescription', 'Medical Records', 'New Medical Record'],
    ar: ['الوصفات', 'وصفة جديدة', 'السجلات الطبية', 'سجل طبي جديد'],
    fa: ['نسخه‌ها', 'نسخه جدید', 'پرونده‌های پزشکی', 'پرونده پزشکی جدید'],
    fr: ['Ordonnances', 'Nouvelle ordonnance', 'Dossiers médicaux', 'Nouveau dossier médical'],
    tr: ['Reçeteler', 'Yeni reçete', 'Tıbbi kayıtlar', 'Yeni tıbbi kayıt'],
  } as const;

  it.each(LOCALE_CODES)('%s carries the four labels', (code) => {
    const messages = catalogues[code];
    expect([
      messages['nav.pharmacyAll'],
      messages['nav.pharmacyNew'],
      messages['nav.medicalRecords'],
      messages['nav.medicalRecordsNew'],
    ]).toEqual(expected[code]);
  });

  it('drops the old "All Prescriptions" wording everywhere', () => {
    const old = [
      'All Prescriptions',
      'جميع الوصفات',
      'همه نسخه‌ها',
      'Toutes les ordonnances',
      'Tüm reçeteler',
    ];
    for (const code of LOCALE_CODES) {
      expect(old).not.toContain(catalogues[code]['nav.pharmacyAll']);
    }
  });
});

/**
 * Queue and Waiting Room moved from the admin sidebar to the reception one,
 * at reception’s own paths. Everything else in both menus is as it was.
 */
describe('Queue and Waiting Room ownership', () => {
  const ids = (config: typeof adminNavigation) =>
    config.sections.flatMap((section) => section.items.map((item) => item.id));
  const item = (config: typeof adminNavigation, id: string) =>
    config.sections.flatMap((section) => section.items).find((entry) => entry.id === id);

  it('lists both under Reception, after Appointments, with the rest unchanged', () => {
    expect(ids(receptionNavigation)).toEqual([
      'home',
      'appointments',
      'queue',
      'waiting-room',
      'patients',
    ]);
    expect(item(receptionNavigation, 'queue')).toMatchObject({
      labelKey: 'nav.queue',
      path: '/reception/queue',
    });
    expect(item(receptionNavigation, 'waiting-room')).toMatchObject({
      labelKey: 'nav.waitingRoom',
      path: '/reception/waiting-room',
    });
    // The reception bottom bar is unchanged; the two are one tap away in More.
    expect(receptionNavigation.bottomTabIds).toEqual(['home', 'appointments', 'patients']);
  });

  it('keeps the icons the admin menu gave them', () => {
    expect(item(receptionNavigation, 'queue')?.icon.displayName).toBe('ListOrdered');
    expect(item(receptionNavigation, 'waiting-room')?.icon.displayName).toBe('Armchair');
  });

  it('drops both from the admin menu, leaving every other admin entry in place', () => {
    expect(ids(adminNavigation)).toEqual([
      'overview',
      'clinic',
      'reports',
      'doctors',
      'patients',
      'appointments',
      'staff',
      'departments',
      'shifts',
      'schedule',
      'holidays',
      'rooms',
      'resources',
      'communications',
      'logs',
      'announcements',
      'policies',
      'templates',
    ]);
    const paths = adminNavigation.sections.flatMap((section) =>
      section.items.map((entry) => entry.path),
    );
    expect(paths.some((path) => /queue|waiting-room/.test(path))).toBe(false);
  });
});

describe('doctorNavigation Patients group', () => {
  const items = doctorNavigation.sections.flatMap((section) => section.items);
  const patients = items.find((item) => item.id === 'patients');

  it('keeps its own path and nests the list and the existing registration page', () => {
    expect(patients?.path).toBe('/doctor/patients');
    expect(patients?.children?.map((child) => [child.id, child.labelKey, child.path])).toEqual([
      ['patients-all', 'nav.patients', '/doctor/patients'],
      ['patients-new', 'nav.patientsNew', '/doctor/patients/new'],
    ]);
  });

  it('adds no permission gate the Patients page itself does not have', () => {
    expect(patients?.requiredPermission).toBeUndefined();
    expect(patients?.children?.every((child) => child.requiredPermission === undefined)).toBe(true);
  });

  it('labels Add Patient in every locale', async () => {
    const catalogues = await loadAllCatalogues();
    for (const code of LOCALE_CODES) {
      expect(catalogues[code]['nav.patientsNew']).toEqual(expect.any(String));
      expect((catalogues[code]['nav.patientsNew'] ?? '').length).toBeGreaterThan(0);
    }
    expect(catalogues.en['nav.patientsNew']).toBe('Add Patient');
  });
});

describe('doctorNavigation Labs group', () => {
  const items = doctorNavigation.sections.flatMap((section) => section.items);
  const labs = items.find((item) => item.id === 'labs');

  it('keeps its own path and nests the list and the existing order page', () => {
    expect(labs?.path).toBe('/doctor/labs');
    expect(labs?.children?.map((child) => [child.id, child.labelKey, child.path])).toEqual([
      ['labs-all', 'nav.labs', '/doctor/labs'],
      ['labs-new', 'nav.labsNew', '/doctor/labs/new'],
    ]);
  });

  it('labels New Order in every locale', async () => {
    const catalogues = await loadAllCatalogues();
    for (const code of LOCALE_CODES) {
      expect((catalogues[code]['nav.labsNew'] ?? '').length).toBeGreaterThan(0);
    }
    expect(catalogues.en['nav.labsNew']).toBe('New Order');
  });
});
