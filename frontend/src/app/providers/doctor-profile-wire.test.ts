import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import {
  displayablePhoto,
  emptyProfile,
  putProfilePhoto,
  toProfile,
  toProfilePatch,
} from './doctor-profile-wire';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The doctor profile on the wire (FE-10.9) — `/me/profile`. */

const VIEW = {
  account: {
    id: 'usr_demo_1',
    firstName: 'Amelia',
    lastName: 'Chen',
    displayName: 'Dr. Amelia Chen',
    email: 'doctor@medora.health',
    phone: '+20 100 000 0000',
    emailVerified: true,
    twoFactorEnabled: false,
    avatarUrl: null,
  },
  patient: null,
  doctor: {
    id: '545e8b20-0997-4fcb-860e-5b37042be266',
    fullName: 'Dr. Amelia Chen',
    title: null,
    specialty: 'Internal Medicine',
    departmentName: 'Internal Medicine',
    licenseNumber: 'MED-DEMO-0001',
    licenseExpiresOn: null,
    professionalCategory: null,
    yearsOfExperience: 0,
    biography: null,
    languages: ['English'],
    education: [],
    certifications: [],
    skills: [],
    contactEmail: 'doctor@medora.health',
    contactPhone: '+20 100 000 0000',
    officeLocation: null,
    officeHours: null,
    linkedinUrl: null,
    websiteUrl: null,
    photoUrl: null,
    verificationStatus: 'verified',
    verifiedAt: '2026-10-04T15:51:06.387Z',
    practiceStatus: 'active',
    ratingAvg: null,
  },
};

describe('toProfile', () => {
  it('reads the server’s profile and invents nothing it does not hold', () => {
    const profile = toProfile(VIEW);
    expect(profile).toMatchObject({
      fullName: 'Dr. Amelia Chen',
      title: '',
      specialty: 'Internal Medicine',
      department: 'Internal Medicine',
      licenseNumber: 'MED-DEMO-0001',
      languages: ['English'],
      // Not on the server: empty, never the demo seed.
      hospital: '',
      employeeId: '',
      emergencyContactName: '',
    });
  });

  it('reads an account with no doctor profile as an empty one', () => {
    expect(toProfile({ ...VIEW, doctor: null })).toEqual(
      emptyProfile('Dr. Amelia Chen', 'doctor@medora.health'),
    );
  });
});

describe('toProfilePatch', () => {
  it('sends only the fields the server keeps, an emptied optional one as null', () => {
    const patch = toProfilePatch({ ...toProfile(VIEW), title: '  ', biography: ' Cardiology ' });
    expect(patch).toMatchObject({ title: null, biography: 'Cardiology', officeLocation: null });
    expect(Object.keys(patch)).not.toContain('hospital');
    expect(Object.keys(patch)).not.toContain('photo');
  });
});

describe('the profile photo (NEW-13)', () => {
  it('shows only a photo a browser can load', () => {
    expect(displayablePhoto('https://files.medora.test/p/1.png?sig=x')).toBe(
      'https://files.medora.test/p/1.png?sig=x',
    );
    expect(displayablePhoto('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
    // What `PUT /me/profile/photo` saves today: the object-store key.
    expect(displayablePhoto('profile_photo/2f7c0b3e.png')).toBeNull();
    expect(displayablePhoto(null)).toBeNull();
  });

  it('reads a storage key in the profile as no photo, not a broken image', () => {
    const profile = toProfile({
      ...VIEW,
      doctor: { ...VIEW.doctor, photoUrl: 'profile_photo/2f7c0b3e.png' },
    });
    expect(profile.photo).toBeNull();
  });

  it('uploads the image as the multipart part `photo` and reads the saved profile', async () => {
    const { requests } = stubApi({ 'PUT /me/profile/photo': () => envelope(VIEW) });

    const saved = await putProfilePhoto(new Blob(['png'], { type: 'image/png' }));

    expect(requests).toHaveLength(1);
    const body = requests[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    const part = (body as FormData).get('photo');
    expect(part).toBeInstanceOf(Blob);
    expect((part as Blob).type).toBe('image/png');
    expect(saved.fullName).toBe('Dr. Amelia Chen');
  });

  it("passes the server's refusal through: its 422 on `photo`, and its 503", async () => {
    stubApi({
      'PUT /me/profile/photo': () =>
        json(
          { message: 'Image too large', fieldErrors: { photo: ['Keep the image under 5 MB'] } },
          422,
        ),
    });
    await expect(putProfilePhoto(new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({
      kind: 'validation',
      fieldErrors: { photo: ['Keep the image under 5 MB'] },
    });

    stubApi({
      'PUT /me/profile/photo': () =>
        json({ message: 'File storage is not configured', code: 'service_unavailable' }, 503),
    });
    await expect(putProfilePhoto(new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({
      kind: 'server',
      code: 'service_unavailable',
    });
  });
});
