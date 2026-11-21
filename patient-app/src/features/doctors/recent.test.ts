import type { PatientSafeDoctor } from './model/types';
import {
  clearRecentDoctors,
  listRecentDoctors,
  recordDoctorView,
  RECENT_DOCTORS_LIMIT,
  type RecentDoctor,
} from './recent';

/**
 * Recently viewed doctors — checklist G-10.
 *
 * The assertion that carries the most weight is the last one: the list
 * is memory-only and goes with the session. "Which specialists this
 * patient looked at" is an inference about their health, and audit R-8's
 * reasoning about a phone recovered from a taxi reaches it.
 */

function doctor(id: string, specialty = 'Cardiology'): PatientSafeDoctor {
  return {
    id,
    fullName: `Doctor ${id}`,
    title: 'Dr',
    specialty,
    departmentName: null,
    photoUrl: null,
    yearsOfExperience: null,
    languages: [],
    biography: null,
    education: [],
    ratingAvg: null,
    hospital: null,
    officeLocation: null,
  };
}

beforeEach(() => {
  clearRecentDoctors();
});

describe('recording a view', () => {
  it('starts empty', () => {
    expect(listRecentDoctors()).toEqual([]);
  });

  it('puts the most recently viewed first', () => {
    recordDoctorView(doctor('a'));
    recordDoctorView(doctor('b'));

    expect(listRecentDoctors().map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('moves a re-viewed doctor to the front rather than duplicating them', () => {
    // A patient who opens the same profile twice has one recent doctor.
    recordDoctorView(doctor('a'));
    recordDoctorView(doctor('b'));
    recordDoctorView(doctor('a'));

    expect(listRecentDoctors().map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('caps the list', () => {
    for (let i = 0; i < RECENT_DOCTORS_LIMIT + 3; i += 1) {
      recordDoctorView(doctor(`d${i}`));
    }

    const ids = listRecentDoctors().map((entry) => entry.id);
    expect(ids).toHaveLength(RECENT_DOCTORS_LIMIT);
    // The oldest fell off the end, not the newest.
    expect(ids[0]).toBe(`d${RECENT_DOCTORS_LIMIT + 2}`);
    expect(ids).not.toContain('d0');
  });

  it('keeps only what a card renders — no biography, no education, no rating', () => {
    recordDoctorView(doctor('a'));

    expect(Object.keys(listRecentDoctors()[0] ?? {}).sort()).toEqual([
      'fullName',
      'id',
      'photoUrl',
      'specialty',
      'title',
    ]);
  });

  it('hands back a copy, so a caller cannot edit the store by accident', () => {
    recordDoctorView(doctor('a'));

    // The returned array is typed readonly; the point of this test is
    // that it is also a genuine copy at runtime.
    (listRecentDoctors() as unknown as RecentDoctor[]).pop();

    expect(listRecentDoctors()).toHaveLength(1);
  });
});

describe('clearing (T-08)', () => {
  it('leaves nothing behind', () => {
    // `SessionProvider.endSession` calls this in the same breath as
    // `clearPhiCache`: a list of specialists is an inference about a
    // patient's health, so it goes when the clinical cache goes.
    recordDoctorView(doctor('a', 'Oncology'));
    recordDoctorView(doctor('b', 'Haematology'));

    clearRecentDoctors();

    expect(listRecentDoctors()).toEqual([]);
  });
});
