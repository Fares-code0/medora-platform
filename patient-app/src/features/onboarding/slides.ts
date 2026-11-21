import type { IconName } from '@/components';
import type { MessageKey } from '@/i18n';

/**
 * The onboarding content — checklist E-02, "≤3 slides".
 *
 * Three, and each one earns its place by answering a question a patient
 * actually has on first launch. None of them is a feature tour, because a
 * feature tour of screens the patient has not reached is a list they
 * cannot act on.
 *
 * ── What is deliberately NOT said ────────────────────────────────────
 *
 * No slide promises a capability that is not built. There is no "chat
 * with your doctor" slide (messaging is not MVP), no "see your lab
 * results" slide (blocked by ADR-031), and no AI slide at all. Onboarding
 * is the first thing a patient reads, and a promise made here is the one
 * they remember when the screen turns out to be empty.
 *
 * The third slide is Emergency, and it is last on purpose: it is the
 * thing worth remembering after the other two are forgotten.
 */

export interface OnboardingSlide {
  readonly id: string;
  readonly icon: IconName;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}

/**
 * The slides carry keys, not sentences: this is a module-level constant
 * and cannot read a hook, and onboarding is the first thing a patient
 * sees — including a patient whose stored locale is Arabic from a
 * previous install (C-09).
 */
export const ONBOARDING_SLIDES: readonly OnboardingSlide[] = [
  {
    id: 'appointments',
    icon: 'calendar',
    titleKey: 'onboarding.slide.appointments.title',
    bodyKey: 'onboarding.slide.appointments.body',
  },
  {
    id: 'clinic',
    icon: 'search',
    titleKey: 'onboarding.slide.clinic.title',
    bodyKey: 'onboarding.slide.clinic.body',
  },
  {
    id: 'emergency',
    icon: 'alert',
    titleKey: 'onboarding.slide.emergency.title',
    bodyKey: 'onboarding.slide.emergency.body',
  },
];
