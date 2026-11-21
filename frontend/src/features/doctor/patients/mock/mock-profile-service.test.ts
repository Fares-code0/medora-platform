import { beforeEach, describe, expect, it } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import {
  ALERT_MESSAGE_MAX,
  NOT_NOTE_AUTHOR,
  PATIENT_NOT_FOUND,
  RETRACTION_REASON_MAX,
} from '../model/profile-service';

import {
  __mockRetractionReason,
  __resetMockProfileWrites,
  mockProfileService,
} from './mock-profile-service';

/**
 * The mock twin of the chart's alert and history writes: it keeps what the
 * API would keep, shows it where the chart reads it, and refuses what the
 * API's schema refuses — so the demo never holds a write the server would not.
 */

const PATIENT_ID = MOCK_PATIENTS[0]?.id ?? '';

beforeEach(() => {
  __resetMockProfileWrites();
});

describe('addAlert', () => {
  it('puts the raised alert first among the chart’s banners', async () => {
    const alert = await mockProfileService.addAlert(PATIENT_ID, {
      severity: 'warning',
      message: '  Falls risk — assist when mobilising.  ',
    });

    expect(alert.message).toBe('Falls risk — assist when mobilising.');
    const { profile } = await mockProfileService.getProfile(PATIENT_ID);
    expect(profile.alerts[0]).toEqual(alert);
  });

  it('refuses an empty or over-long message, and an unknown patient', async () => {
    await expect(
      mockProfileService.addAlert(PATIENT_ID, { severity: 'critical', message: '   ' }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      mockProfileService.addAlert(PATIENT_ID, {
        severity: 'critical',
        message: 'x'.repeat(ALERT_MESSAGE_MAX + 1),
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      mockProfileService.addAlert('PT-NOBODY', { severity: 'critical', message: 'x' }),
    ).rejects.toThrow(PATIENT_NOT_FOUND);
  });
});

describe('addHistoryEvent', () => {
  it('adds the event to the History tab, in date order', async () => {
    const event = await mockProfileService.addHistoryEvent(PATIENT_ID, {
      kind: 'vaccination',
      title: 'Influenza vaccine',
      occurredOn: '2000-01-01',
      detail: '',
      facility: '',
    });

    expect(event.facility).toBeNull();
    const history = await mockProfileService.getTab(PATIENT_ID, 'history');
    expect(history).toContainEqual(event);
    const dates = history.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });

  it('refuses a future date and an empty title, as the API does', async () => {
    const base = { kind: 'diagnosis' as const, detail: '', facility: '' };
    await expect(
      mockProfileService.addHistoryEvent(PATIENT_ID, {
        ...base,
        title: 'Hypertension',
        occurredOn: '2999-01-01',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      mockProfileService.addHistoryEvent(PATIENT_ID, {
        ...base,
        title: '  ',
        occurredOn: '2020-01-01',
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('emergency contacts', () => {
  const contact = {
    name: 'Omar Nassar',
    relationship: 'Brother',
    phone: '+20 100 123 4567',
  };

  it('keeps at most one primary: adding a primary contact demotes the old one', async () => {
    const added = await mockProfileService.addEmergencyContact(PATIENT_ID, {
      ...contact,
      isPrimary: true,
    });

    const { profile } = await mockProfileService.getProfile(PATIENT_ID);
    expect(profile.emergencyContacts.filter((entry) => entry.isPrimary)).toEqual([added]);
    expect(profile.emergencyContacts.length).toBeGreaterThan(1);
  });

  it('corrects a contact in place', async () => {
    const before = (await mockProfileService.getProfile(PATIENT_ID)).profile.emergencyContacts;
    const target = before[0];
    if (target === undefined) throw new Error('the generated chart has no contact');

    await mockProfileService.updateEmergencyContact(PATIENT_ID, target.id, {
      ...contact,
      isPrimary: target.isPrimary,
    });

    const after = (await mockProfileService.getProfile(PATIENT_ID)).profile.emergencyContacts;
    expect(after).toHaveLength(before.length);
    expect(after.find((entry) => entry.id === target.id)).toMatchObject(contact);
  });

  it('refuses a phone the API would refuse, and an unknown contact', async () => {
    await expect(
      mockProfileService.addEmergencyContact(PATIENT_ID, {
        ...contact,
        phone: 'call me',
        isPrimary: false,
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      mockProfileService.updateEmergencyContact(PATIENT_ID, 'ec-nope', {
        ...contact,
        isPrimary: false,
      }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('retractions — DEC-003, BR-DEC-003', () => {
  it('a resolved alert leaves the chart’s banners, keeping a reason when one is given', async () => {
    const alert = await mockProfileService.addAlert(PATIENT_ID, {
      severity: 'warning',
      message: 'Falls risk.',
    });

    await mockProfileService.resolveAlert(PATIENT_ID, alert.id, ' Mobilising independently ');

    const { profile } = await mockProfileService.getProfile(PATIENT_ID);
    expect(profile.alerts.map((entry) => entry.id)).not.toContain(alert.id);
    expect(__mockRetractionReason(PATIENT_ID, alert.id)).toBe('Mobilising independently');
    await expect(mockProfileService.resolveAlert(PATIENT_ID, 'alr-nope', '')).rejects.toMatchObject(
      { kind: 'not_found' },
    );
  });

  it('resolves an alert without a reason, as the server allows', async () => {
    const alert = await mockProfileService.addAlert(PATIENT_ID, {
      severity: 'warning',
      message: 'Falls risk.',
    });

    await mockProfileService.resolveAlert(PATIENT_ID, alert.id, '   ');

    expect(__mockRetractionReason(PATIENT_ID, alert.id)).toBeUndefined();
  });

  it('removing the primary contact promotes no one, as the server does', async () => {
    const primary = await mockProfileService.addEmergencyContact(PATIENT_ID, {
      name: 'Omar Nassar',
      relationship: 'Brother',
      phone: '+20 100 123 4567',
      isPrimary: true,
    });

    await mockProfileService.removeEmergencyContact(PATIENT_ID, primary.id, 'Number disconnected');

    const { profile } = await mockProfileService.getProfile(PATIENT_ID);
    expect(profile.emergencyContacts.map((entry) => entry.id)).not.toContain(primary.id);
    expect(profile.emergencyContacts.some((entry) => entry.isPrimary)).toBe(false);
    expect(__mockRetractionReason(PATIENT_ID, primary.id)).toBe('Number disconnected');
    await expect(
      mockProfileService.removeEmergencyContact(PATIENT_ID, primary.id, 'Again'),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('refuses a reason longer than the server keeps', async () => {
    const alert = await mockProfileService.addAlert(PATIENT_ID, {
      severity: 'warning',
      message: 'Falls risk.',
    });
    await expect(
      mockProfileService.resolveAlert(PATIENT_ID, alert.id, 'x'.repeat(RETRACTION_REASON_MAX + 1)),
    ).rejects.toMatchObject({ kind: 'validation' });
    const { profile } = await mockProfileService.getProfile(PATIENT_ID);
    expect(profile.alerts.map((entry) => entry.id)).toContain(alert.id);
  });

  it('removes a history event only with a reason, and it leaves every read', async () => {
    const [event] = await mockProfileService.getTab(PATIENT_ID, 'history');
    if (event === undefined) throw new Error('the generated chart has no history');

    await expect(
      mockProfileService.removeHistoryEvent(PATIENT_ID, event.id, '  '),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(
      (await mockProfileService.getTab(PATIENT_ID, 'history')).map((entry) => entry.id),
    ).toContain(event.id);

    await mockProfileService.removeHistoryEvent(PATIENT_ID, event.id, 'Wrong chart');

    expect(
      (await mockProfileService.getTab(PATIENT_ID, 'history')).map((entry) => entry.id),
    ).not.toContain(event.id);
    expect(__mockRetractionReason(PATIENT_ID, event.id)).toBe('Wrong chart');
    await expect(
      mockProfileService.removeHistoryEvent(PATIENT_ID, event.id, 'Again'),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('chart notes — DEC-001', () => {
  const ME = { id: 'usr_doctor_amelia', name: 'Dr. Amelia Chen' };

  it('writes unsigned under the given author, then freezes the note once signed', async () => {
    const written = await mockProfileService.addNote(
      PATIENT_ID,
      { title: ' Plan ', body: ' Start low dose. ' },
      ME,
    );
    expect(written).toMatchObject({
      authorId: ME.id,
      author: ME.name,
      title: 'Plan',
      signed: false,
    });

    await mockProfileService.signNote(PATIENT_ID, written.id, ME);

    await expect(
      mockProfileService.updateNote(
        PATIENT_ID,
        written.id,
        { title: 'Plan', body: 'Changed.' },
        ME,
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mockProfileService.signNote(PATIENT_ID, written.id, ME)).rejects.toMatchObject({
      kind: 'conflict',
    });
    const notes = await mockProfileService.getTab(PATIENT_ID, 'notes');
    expect(notes.find((entry) => entry.id === written.id)).toMatchObject({ signed: true });
  });

  it('refuses an edit or a signature by anyone but the author, as the API does (BR-DEC-001)', async () => {
    const colleague = { id: 'usr_doctor_omar', name: 'Dr. Omar Haddad' };
    const written = await mockProfileService.addNote(
      PATIENT_ID,
      { title: 'Plan', body: 'Start low dose.' },
      ME,
    );

    await expect(
      mockProfileService.updateNote(
        PATIENT_ID,
        written.id,
        { title: 'Plan', body: 'Rewritten.' },
        colleague,
      ),
    ).rejects.toMatchObject({ kind: 'forbidden', code: NOT_NOTE_AUTHOR });
    await expect(
      mockProfileService.signNote(PATIENT_ID, written.id, colleague),
    ).rejects.toMatchObject({ kind: 'forbidden', code: NOT_NOTE_AUTHOR });

    const notes = await mockProfileService.getTab(PATIENT_ID, 'notes');
    expect(notes.find((entry) => entry.id === written.id)).toMatchObject({
      body: 'Start low dose.',
      signed: false,
    });
  });

  it('refuses an empty note, as the API does', async () => {
    await expect(
      mockProfileService.addNote(PATIENT_ID, { title: 'Plan', body: '   ' }, ME),
    ).rejects.toMatchObject({ kind: 'validation' });
  });
});
