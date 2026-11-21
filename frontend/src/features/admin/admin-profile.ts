/**
 * Administrator profile — domain model, mock persistence, and query layer
 * (Phase 18). One per-user document in localStorage (seeded from the auth
 * user), mirroring the doctor-profile pattern: every mutation returns the
 * full document and seeds the query cache. Sessions, devices, and the
 * activity log live inside the document so revoking/removing persists.
 */

import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/providers';

import type { AdminSectionSlug } from './administration.types';

/* ── Model ────────────────────────────────────────────────────── */

export interface AdminSession {
  readonly id: string;
  readonly device: string;
  readonly location: string;
  readonly lastActiveAt: string;
  readonly current: boolean;
}

export interface AdminDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: 'desktop' | 'mobile' | 'tablet';
  readonly trustedSince: string;
}

export interface AdminActivityEntry {
  readonly id: string;
  readonly label: string;
  readonly at: string;
}

export interface AdminProfile {
  readonly photo: string | null;
  readonly fullName: string;
  readonly title: string;
  readonly biography: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly officeLocation: string;
  readonly emergencyContactName: string;
  readonly emergencyContactPhone: string;
  readonly education: readonly string[];
  readonly certifications: readonly string[];
  readonly experience: readonly string[];
  readonly linkedinUrl: string;
  readonly websiteUrl: string;
  readonly landingSection: AdminSectionSlug;
  readonly weeklyDigest: boolean;
  readonly sessions: readonly AdminSession[];
  readonly devices: readonly AdminDevice[];
  readonly activity: readonly AdminActivityEntry[];
}

export const DEFAULT_ADMIN_PROFILE: AdminProfile = {
  photo: null,
  fullName: 'Administrator',
  title: 'Platform Administrator',
  biography: '',
  contactEmail: 'admin@medora.health',
  contactPhone: '+1 (555) 018-0001',
  officeLocation: 'Administration · Level 2',
  emergencyContactName: '',
  emergencyContactPhone: '',
  education: ['BSc Health Informatics — Oregon State University, 2016'],
  certifications: ['Certified Healthcare CIO (CHCIO)'],
  experience: ['Clinic Operations Manager — Medora Clinic, 2021–present'],
  linkedinUrl: '',
  websiteUrl: '',
  landingSection: 'overview',
  weeklyDigest: true,
  sessions: [
    {
      id: 'ses-current',
      device: 'Windows · Chrome',
      location: 'Portland, OR',
      lastActiveAt: '2026-07-19T08:05:00Z',
      current: true,
    },
    {
      id: 'ses-tablet',
      device: 'iPad · Safari',
      location: 'Portland, OR',
      lastActiveAt: '2026-07-17T19:22:00Z',
      current: false,
    },
  ],
  devices: [
    {
      id: 'dev-desk',
      name: 'Front-office workstation',
      kind: 'desktop',
      trustedSince: '2026-02-11',
    },
    { id: 'dev-ipad', name: 'Reception iPad', kind: 'tablet', trustedSince: '2026-04-03' },
    { id: 'dev-phone', name: 'Personal phone', kind: 'mobile', trustedSince: '2026-06-20' },
  ],
  activity: [
    { id: 'act-1', label: 'Signed in from Windows · Chrome', at: '2026-07-19T08:05:00Z' },
    { id: 'act-2', label: 'Updated security policy', at: '2026-07-19T08:02:00Z' },
    { id: 'act-3', label: 'Created manual backup', at: '2026-07-15T18:20:00Z' },
    { id: 'act-4', label: 'Deactivated user Sofia Marin', at: '2026-07-18T16:20:00Z' },
    { id: 'act-5', label: 'Connected Google Calendar', at: '2026-07-10T09:12:00Z' },
  ],
};

/** The slice edited by the profile form (everything except the lists). */
export type AdminProfileFormValues = Omit<AdminProfile, 'sessions' | 'devices' | 'activity'>;

// Moved beside `SECTION_META` (RM M40.4): the platform-settings panel needs
// it in a live build, and reading it from here kept this demo store in one.
export { resolveLandingSection } from './administration.meta';

/* ── Completion ───────────────────────────────────────────────── */

export interface AdminProfileCompletion {
  readonly percent: number;
  readonly missing: readonly string[];
}

export function selectAdminProfileCompletion(profile: AdminProfile): AdminProfileCompletion {
  const checks: readonly { readonly label: string; readonly complete: boolean }[] = [
    { label: 'Profile photo', complete: profile.photo !== null },
    { label: 'Full name', complete: profile.fullName.trim().length > 0 },
    { label: 'Job title', complete: profile.title.trim().length > 0 },
    { label: 'Biography', complete: profile.biography.trim().length > 0 },
    { label: 'Contact phone', complete: profile.contactPhone.trim().length > 0 },
    { label: 'Emergency contact', complete: profile.emergencyContactName.trim().length > 0 },
    { label: 'Education', complete: profile.education.length > 0 },
    { label: 'Certificates', complete: profile.certifications.length > 0 },
    { label: 'Experience', complete: profile.experience.length > 0 },
    { label: 'Social links', complete: profile.linkedinUrl !== '' || profile.websiteUrl !== '' },
  ];
  const done = checks.filter((check) => check.complete).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}

/* ── Storage ──────────────────────────────────────────────────── */

const LATENCY_MS = 280;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function storageKey(userId: string): string {
  return `medora.${userId}.adminProfile.v1`;
}

function seedFor(name: string | undefined, email: string | undefined): AdminProfile {
  return {
    ...DEFAULT_ADMIN_PROFILE,
    fullName: name ?? DEFAULT_ADMIN_PROFILE.fullName,
    contactEmail: email ?? DEFAULT_ADMIN_PROFILE.contactEmail,
  };
}

function load(userId: string, seed: AdminProfile): AdminProfile {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return seed;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return seed;
    return { ...seed, ...(parsed as Partial<AdminProfile>) };
  } catch {
    return seed;
  }
}

function persist(userId: string, profile: AdminProfile): AdminProfile {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(profile));
  } catch {
    // Storage unavailable — profile stays session-local.
  }
  return profile;
}

function appendActivity(profile: AdminProfile, label: string): AdminProfile {
  return {
    ...profile,
    activity: [
      { id: `act-${String(Date.now())}`, label, at: new Date().toISOString() },
      ...profile.activity,
    ].slice(0, 5),
  };
}

/* ── Queries ──────────────────────────────────────────────────── */

const profileKeys = {
  document: (userId: string) => ['administration', 'admin-profile', userId] as const,
};

export function useAdminProfile() {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  return useQuery({
    queryKey: profileKeys.document(userId),
    queryFn: () => delay(load(userId, seedFor(user?.name, user?.email))),
    staleTime: 60_000,
  });
}

function useProfileMutation<TVariables>(
  mutate: (current: AdminProfile, variables: TVariables) => AdminProfile,
) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => {
      const seed = seedFor(user?.name, user?.email);
      return delay(persist(userId, mutate(load(userId, seed), variables)));
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKeys.document(userId), profile);
    },
  });
}

export function useSaveAdminProfileMutation() {
  return useProfileMutation((current, values: AdminProfileFormValues) =>
    appendActivity({ ...current, ...values }, 'Updated profile'),
  );
}

export function useRevokeSessionMutation() {
  return useProfileMutation((current, sessionId: string) =>
    appendActivity(
      {
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
      },
      'Revoked a session',
    ),
  );
}

export function useRemoveDeviceMutation() {
  return useProfileMutation((current, deviceId: string) =>
    appendActivity(
      {
        ...current,
        devices: current.devices.filter((device) => device.id !== deviceId),
      },
      'Removed a trusted device',
    ),
  );
}
