import { apiClient, UPLOAD_TIMEOUT_MS } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  readArray,
  readNumber,
  readData,
  readOptionalString,
  readString,
} from '@/api/http';

import type { DoctorProfile } from './DoctorProfileProvider';

/**
 * The doctor profile on the wire (FE-10.9) — `SelfProfileView` from
 * `GET /me/profile`, and the body `PATCH /me/profile` takes
 * (`updateDoctorProfileSchema`). Kept apart from the provider so the
 * mapping is testable and the provider file exports only what React needs.
 */

/** What `PATCH /me/profile` accepts (`updateDoctorProfileSchema`). */
export const SERVER_PROFILE_FIELDS: ReadonlySet<keyof DoctorProfile> = new Set<keyof DoctorProfile>(
  [
    'fullName',
    'title',
    'specialty',
    'licenseNumber',
    'yearsOfExperience',
    'biography',
    'languages',
    'education',
    'certifications',
    'skills',
    'contactEmail',
    'contactPhone',
    'officeLocation',
    'officeHours',
    'linkedinUrl',
    'websiteUrl',
  ],
);

export function emptyProfile(name: string | undefined, email: string | undefined): DoctorProfile {
  return {
    photo: null,
    fullName: name ?? '',
    title: '',
    specialty: '',
    licenseNumber: '',
    employeeId: '',
    department: '',
    hospital: '',
    yearsOfExperience: 0,
    languages: [],
    biography: '',
    education: [],
    certifications: [],
    skills: [],
    linkedinUrl: '',
    websiteUrl: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    contactEmail: email ?? '',
    contactPhone: '',
    officeLocation: '',
    officeHours: '',
  };
}

function readStrings(dto: Record<string, unknown>, key: string): readonly string[] {
  return readArray(dto, key, 'profile.doctor').map((entry) => {
    if (typeof entry !== 'string') throw malformedResponse(`profile.doctor.${key}`);
    return entry;
  });
}

/**
 * The photo only when a browser can load it.
 *
 * `PUT /me/profile/photo` stores the upload and saves the object-store key
 * as `photoUrl` (`setDoctorPhoto(doctorId, stored.key, …)` on `main` and
 * `backend`), so the profile can name a key such as `profile_photo/…` rather
 * than a URL. Put in an `<img>`, that is a broken image in the sidebar and
 * the avatar menu; the avatar's initials are the honest fallback until the
 * server serves a signed URL (NEW-13, §32).
 */
export function displayablePhoto(value: string | null): string | null {
  if (value === null) return null;
  return /^(https?:|data:image\/)/i.test(value) ? value : null;
}

/** `SelfProfileView` → the profile. An account with no doctor profile reads as empty. */
export function toProfile(value: unknown): DoctorProfile {
  const view = asRecord(value, 'profile');
  const account = asRecord(view.account, 'profile.account');
  const base = emptyProfile(
    readString(account, 'displayName', 'profile.account'),
    readString(account, 'email', 'profile.account'),
  );
  if (view.doctor === null) return base;
  const doctor = asRecord(view.doctor, 'profile.doctor');
  const text = (key: string) => readOptionalString(doctor, key, 'profile.doctor') ?? '';
  return {
    ...base,
    photo: displayablePhoto(readOptionalString(doctor, 'photoUrl', 'profile.doctor')),
    fullName: readString(doctor, 'fullName', 'profile.doctor'),
    title: text('title'),
    specialty: readString(doctor, 'specialty', 'profile.doctor'),
    licenseNumber: readString(doctor, 'licenseNumber', 'profile.doctor'),
    department: text('departmentName'),
    yearsOfExperience: readNumber(doctor, 'yearsOfExperience', 'profile.doctor'),
    biography: text('biography'),
    languages: readStrings(doctor, 'languages'),
    education: readStrings(doctor, 'education'),
    certifications: readStrings(doctor, 'certifications'),
    skills: readStrings(doctor, 'skills'),
    contactEmail: readString(doctor, 'contactEmail', 'profile.doctor'),
    contactPhone: readString(doctor, 'contactPhone', 'profile.doctor'),
    officeLocation: text('officeLocation'),
    officeHours: text('officeHours'),
    linkedinUrl: text('linkedinUrl'),
    websiteUrl: text('websiteUrl'),
  };
}

/** The editable fields as the server takes them: an emptied optional field is `null`. */
export function toProfilePatch(profile: DoctorProfile) {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    fullName: profile.fullName.trim(),
    title: orNull(profile.title),
    specialty: profile.specialty.trim(),
    licenseNumber: profile.licenseNumber.trim(),
    yearsOfExperience: profile.yearsOfExperience,
    biography: orNull(profile.biography),
    languages: profile.languages,
    education: profile.education,
    certifications: profile.certifications,
    skills: profile.skills,
    contactEmail: profile.contactEmail.trim(),
    contactPhone: profile.contactPhone.trim(),
    officeLocation: orNull(profile.officeLocation),
    officeHours: orNull(profile.officeHours),
    linkedinUrl: orNull(profile.linkedinUrl),
    websiteUrl: orNull(profile.websiteUrl),
  };
}

/**
 * `PUT /me/profile/photo` (API §3.3, NEW-13): the image as the multipart
 * part `photo`, answered with the saved profile. The type and size rules
 * (JPEG, PNG or WebP; at most 5 MB) are the server's, and a refusal comes
 * back as its 422 on `photo`; until storage is wired the route answers 503.
 */
export async function putProfilePhoto(image: Blob): Promise<DoctorProfile> {
  const form = new FormData();
  form.append('photo', image, `photo.${image.type === 'image/png' ? 'png' : 'jpg'}`);
  return toProfile(
    readData(
      await apiClient.put('/me/profile/photo', form, { timeoutMs: UPLOAD_TIMEOUT_MS }),
      'profile',
    ),
  );
}
