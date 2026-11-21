import type { DoctorProfile } from '@/app/providers';
import { formatDateWith } from '@/i18n';

import type { SecuritySettings, SettingsDocument } from './types';

/**
 * Derived views over the settings document — profile completion scoring and
 * the security posture summary. Pure functions so sections and widgets
 * share one source of truth for every computed number on the page.
 */

/* ── Profile completion ─────────────────────────────────────────── */

export interface CompletionField {
  /** Which profile field the check covers. */
  readonly label: string;
  readonly complete: boolean;
  /** Shown as the recommendation when the field is missing. */
  readonly recommendation: string;
}

export interface ProfileCompletion {
  readonly percent: number;
  readonly fields: readonly CompletionField[];
  readonly missing: readonly CompletionField[];
}

const hasText = (value: string): boolean => value.trim().length > 0;

export function selectProfileCompletion(profile: DoctorProfile): ProfileCompletion {
  const fields: readonly CompletionField[] = [
    {
      label: 'Profile photo',
      complete: profile.photo !== null,
      recommendation: 'Add a photo so colleagues recognize you in shared views.',
    },
    {
      label: 'Full name',
      complete: hasText(profile.fullName),
      recommendation: 'Add your full name.',
    },
    {
      label: 'Medical title',
      complete: hasText(profile.title),
      recommendation: 'Add your credentials (e.g. MD, FACP).',
    },
    {
      label: 'Specialty',
      complete: hasText(profile.specialty),
      recommendation: 'Add your specialty so referrals reach you.',
    },
    {
      label: 'License number',
      complete: hasText(profile.licenseNumber),
      recommendation: 'Add your license number for verification.',
    },
    {
      label: 'Department',
      complete: hasText(profile.department),
      recommendation: 'Add your department.',
    },
    {
      label: 'Years of experience',
      complete: profile.yearsOfExperience > 0,
      recommendation: 'Add your years of experience.',
    },
    {
      label: 'Languages',
      complete: profile.languages.length > 0,
      recommendation: 'List the languages you consult in.',
    },
    {
      label: 'Biography',
      complete: hasText(profile.biography),
      recommendation: 'Write a short biography for your public profile.',
    },
    {
      label: 'Education',
      complete: profile.education.length > 0,
      recommendation: 'Add your degrees and training.',
    },
    {
      label: 'Certifications',
      complete: profile.certifications.length > 0,
      recommendation: 'List your board certifications.',
    },
    {
      label: 'Skills',
      complete: profile.skills.length > 0,
      recommendation: 'Highlight your clinical areas of focus.',
    },
    {
      label: 'Contact phone',
      complete: hasText(profile.contactPhone),
      recommendation: 'Add a contact phone number.',
    },
  ];

  const done = fields.filter((field) => field.complete).length;
  return {
    percent: Math.round((done / fields.length) * 100),
    fields,
    missing: fields.filter((field) => !field.complete),
  };
}

/* ── Security posture ───────────────────────────────────────────── */

export interface SecurityPosture {
  readonly level: 'strong' | 'good' | 'at-risk';
  readonly headline: string;
  readonly items: readonly { readonly label: string; readonly ok: boolean }[];
}

export function selectSecurityPosture(
  security: SecuritySettings,
  passwordUpdatedAt: string,
): SecurityPosture {
  const passwordAgeDays = Math.floor(
    (Date.now() - new Date(passwordUpdatedAt).getTime()) / 86_400_000,
  );
  const otherSessions = security.activeSessions.filter((session) => !session.current).length;

  const items = [
    { label: 'Two-factor authentication enabled', ok: security.twoFactorEnabled },
    { label: 'Password changed in the last 180 days', ok: passwordAgeDays <= 180 },
    { label: 'No more than 2 other active sessions', ok: otherSessions <= 2 },
  ];

  const okCount = items.filter((item) => item.ok).length;
  const level: SecurityPosture['level'] =
    okCount === items.length ? 'strong' : okCount >= 2 ? 'good' : 'at-risk';

  const headline =
    level === 'strong'
      ? 'Your account security is strong.'
      : level === 'good'
        ? 'Your account is in good shape — one improvement available.'
        : 'Your account needs attention.';

  return { level, headline, items };
}

/* ── Small formatting helpers shared by the sections ────────────── */

export function formatDateTime(iso: string): string {
  return formatDateWith(new Date(iso), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return formatDateWith(new Date(iso), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function selectConnectedCount(document: SettingsDocument): number {
  return document.integrations.filter((integration) => integration.connected).length;
}
