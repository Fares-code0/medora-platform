import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import { readData } from '@/api/http';
import { env } from '@/configs/env';

import { useAuth } from './AuthProvider';
import {
  SERVER_PROFILE_FIELDS,
  emptyProfile,
  putProfilePhoto,
  toProfile,
  toProfilePatch,
} from './doctor-profile-wire';

/**
 * Doctor profile — the SINGLE SOURCE OF TRUTH for the signed-in doctor's
 * identity across the whole app (navbar, sidebar, dashboard greeting,
 * messages, AI, reports, and the Settings profile editor all read from
 * here). Editing the profile in Settings updates every surface immediately,
 * with no duplicated profile state.
 *
 * Mock mode: persisted per user under `medora.<userId>.doctorProfile` (wiped
 * on logout by the auth provider's `clearUserPreferences`) — the single
 * `window.localStorage` boundary for the profile. Live (FE-10.9): the
 * server's `/me/profile`, nothing seeded and nothing stored in the browser.
 */

export interface DoctorProfile {
  /** Data-URL photo or null → initials fallback. */
  readonly photo: string | null;
  readonly fullName: string;
  /** Medical title/credentials, e.g. "MD, FACP". */
  readonly title: string;
  readonly specialty: string;
  readonly licenseNumber: string;
  readonly employeeId: string;
  readonly department: string;
  readonly hospital: string;
  readonly yearsOfExperience: number;
  readonly languages: readonly string[];
  readonly biography: string;
  /** Degrees and training, newest first (e.g. "MD — Johns Hopkins, 2009"). */
  readonly education: readonly string[];
  /** Board certifications and credentials. */
  readonly certifications: readonly string[];
  /** Clinical skills and areas of focus. */
  readonly skills: readonly string[];
  readonly linkedinUrl: string;
  readonly websiteUrl: string;
  readonly emergencyContactName: string;
  readonly emergencyContactPhone: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly officeLocation: string;
  readonly officeHours: string;
}

/**
 * Mock-mode seed values; `fullName`/`contactEmail` are filled from the auth
 * user. Never shown live — the live profile is the server's, or empty.
 */
export const DEFAULT_DOCTOR_PROFILE: DoctorProfile = {
  photo: null,
  fullName: 'Doctor',
  title: 'MD, FACP',
  specialty: 'Internal Medicine',
  licenseNumber: 'MED-482913',
  employeeId: 'EMP-2041',
  department: 'Internal Medicine',
  hospital: 'Medora General Hospital',
  yearsOfExperience: 12,
  languages: ['English', 'Mandarin'],
  biography: '',
  education: [
    'MD — Johns Hopkins University School of Medicine, 2009',
    'Residency, Internal Medicine — Massachusetts General Hospital, 2013',
  ],
  certifications: [
    'Board Certified, Internal Medicine (ABIM)',
    'Advanced Cardiac Life Support (ACLS)',
  ],
  skills: ['Chronic disease management', 'Preventive care', 'Clinical ultrasound'],
  linkedinUrl: '',
  websiteUrl: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  contactEmail: 'doctor@medora.health',
  contactPhone: '+1 (555) 012-4477',
  officeLocation: 'Building C · Suite 340',
  officeHours: 'Mon–Fri, 9:00–17:00',
};

interface DoctorProfileContextValue {
  readonly profile: DoctorProfile;
  /**
   * Saves the profile. Resolves once it is stored — locally in mock mode,
   * on the server live (FE-10.9) — and rejects with the server's error, so
   * the editor never reports a save that did not happen.
   */
  readonly updateProfile: (next: DoctorProfile) => Promise<void>;
  /** The fields this source keeps; the editor offers only these. */
  readonly editable: ReadonlySet<keyof DoctorProfile>;
  /**
   * Uploads a profile photo on its own (`PUT /me/profile/photo`, NEW-13),
   * resolving once the server has stored it and rejecting with the server's
   * refusal. `null` where the photo is not uploaded this way: in mock mode it
   * is a form field like any other, and an account without a practitioner
   * profile has no photo to set (the route answers 404).
   */
  readonly uploadPhoto: ((image: Blob) => Promise<DoctorProfile>) | null;
  /** `loading` until a live profile has answered; `error` if it could not. */
  readonly status: 'ready' | 'loading' | 'error';
}

const DoctorProfileContext = createContext<DoctorProfileContextValue | null>(null);

function storageKey(userId: string): string {
  return `medora.${userId}.doctorProfile`;
}

function seedFor(name: string | undefined, email: string | undefined): DoctorProfile {
  return {
    ...DEFAULT_DOCTOR_PROFILE,
    fullName: name ?? DEFAULT_DOCTOR_PROFILE.fullName,
    contactEmail: email ?? DEFAULT_DOCTOR_PROFILE.contactEmail,
  };
}

function readProfile(userId: string, seed: DoctorProfile): DoctorProfile {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return seed;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return seed;
    // Merge over the seed so new fields added later can't produce holes.
    return { ...seed, ...(parsed as Partial<DoctorProfile>) };
  } catch {
    return seed;
  }
}

function writeProfile(userId: string, profile: DoctorProfile): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(profile));
  } catch {
    // Storage unavailable — profile stays session-local.
  }
}

/** Every field — the demo source keeps all of them. Built on first use, not at load. */
let allFields: ReadonlySet<keyof DoctorProfile> | null = null;
function allProfileFields(): ReadonlySet<keyof DoctorProfile> {
  allFields ??= new Set(Object.keys(DEFAULT_DOCTOR_PROFILE) as (keyof DoctorProfile)[]);
  return allFields;
}

export function DoctorProfileProvider({ children }: { children: ReactNode }) {
  // The constant lets a production build drop the demo provider and the demo
  // profile with it (RM M40.4); `env.enableMocks` alone does not fold, and a
  // module-level field set used to keep the seed alive regardless.
  return import.meta.env.MEDORA_MOCKS_STRIPPED !== true && env.enableMocks ? (
    <LocalDoctorProfileProvider>{children}</LocalDoctorProfileProvider>
  ) : (
    <ServerDoctorProfileProvider>{children}</ServerDoctorProfileProvider>
  );
}

/** Mock mode: the demo seed, persisted per user in this browser. */
function LocalDoctorProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';

  const [profile, setProfile] = useState<DoctorProfile>(() =>
    readProfile(userId, seedFor(user?.name, user?.email)),
  );

  // Re-hydrate when the signed-in user changes (login/switch).
  useEffect(() => {
    setProfile(readProfile(userId, seedFor(user?.name, user?.email)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const updateProfile = useCallback(
    (next: DoctorProfile) => {
      setProfile(next);
      writeProfile(userId, next);
      return Promise.resolve();
    },
    [userId],
  );

  const value = useMemo<DoctorProfileContextValue>(
    () => ({
      profile,
      updateProfile,
      editable: allProfileFields(),
      uploadPhoto: null,
      status: 'ready',
    }),
    [profile, updateProfile],
  );

  return <DoctorProfileContext.Provider value={value}>{children}</DoctorProfileContext.Provider>;
}

/**
 * Live (FE-10.9): `GET /me/profile` and `PATCH /me/profile`, API §3.
 *
 * Nothing is seeded. A field the server does not hold — hospital, employee
 * id, emergency contact — is empty and not offered for editing, rather than
 * a demo value shown as the doctor's own; the department is the server's and
 * read-only. The photo is not a profile field here: it is its own multipart
 * upload (`uploadPhoto`), because the server takes it as bytes, not a value.
 */
function ServerDoctorProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const queryKey = useMemo(() => ['me', 'profile', userId] as const, [userId]);

  const query = useQuery({
    queryKey,
    queryFn: async () => toProfile(readData(await apiClient.get('/me/profile'), 'profile')),
    // `/me/profile` answers 404 without a practitioner record. The staff
    // roles (DEC-006a) never show a profile, so they do not ask; the admin's
    // own "My Settings → Profile" keeps its current behaviour until DEC-007.
    enabled:
      userId !== null && (user?.role === 'doctor' || user?.role === 'admin'),
    staleTime: 5 * 60_000,
  });

  const fallback = useMemo(() => emptyProfile(user?.name, user?.email), [user?.name, user?.email]);
  const profile = query.data ?? fallback;

  const updateProfile = useCallback(
    async (next: DoctorProfile) => {
      const saved = toProfile(
        readData(await apiClient.patch('/me/profile', toProfilePatch(next)), 'profile'),
      );
      queryClient.setQueryData(queryKey, saved);
    },
    [queryClient, queryKey],
  );

  const isDoctor = user?.role === 'doctor';
  const uploadPhoto = useCallback(
    async (image: Blob) => {
      const saved = await putProfilePhoto(image);
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
    [queryClient, queryKey],
  );

  const value = useMemo<DoctorProfileContextValue>(
    () => ({
      profile,
      updateProfile,
      editable: SERVER_PROFILE_FIELDS,
      uploadPhoto: isDoctor ? uploadPhoto : null,
      status: query.isError ? 'error' : query.data === undefined ? 'loading' : 'ready',
    }),
    [profile, updateProfile, isDoctor, uploadPhoto, query.isError, query.data],
  );

  return <DoctorProfileContext.Provider value={value}>{children}</DoctorProfileContext.Provider>;
}

export function useDoctorProfile(): DoctorProfileContextValue {
  const ctx = useContext(DoctorProfileContext);
  if (!ctx) throw new Error('useDoctorProfile must be used within DoctorProfileProvider');
  return ctx;
}
