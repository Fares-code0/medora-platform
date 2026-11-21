/**
 * PHI masking — the display half of RM M7.3 (UX §1.5.6, API §4.11).
 *
 * "Any admin table showing patient identifiers supports masked display
 * (e.g. 'Ah••• M•••', MRN last-4) with reveal-on-click that is
 * audit-logged."
 *
 * A verbatim port of `frontend/src/utils/phi-mask.ts`, which ADM-10
 * shipped. The roadmap requires the two to agree **character-for-
 * character**, so `phi-mask.spec.ts` loads the frontend module and
 * compares outputs rather than trusting this transcription.
 *
 * ## This kernel has no access to policy, on purpose
 *
 * The frontend's header is emphatic that these are "the display half
 * only: pure, synchronous, no policy… a masking function that could be
 * talked into returning the clear value would be worse than none".
 * `shared/phi/` therefore does not import `shared/authz/` and has no way
 * to ask whether the caller is permitted to see the clear value. There
 * is no argument, flag, or option that makes any function here return
 * unmasked input. Whether a value may be unmasked at all is decided by
 * the reveal path of RM M7.3, elsewhere.
 *
 * Two invariants hold throughout, and both are asserted directly:
 *  - The mask is a FIXED width (three bullets), so it never leaks how
 *    long the hidden part is.
 *  - An empty or unknown value masks to the same placeholder as any
 *    other, so a blank field is not distinguishable from a withheld one.
 */

const BULLETS = '•••';
const UNKNOWN = '•••';

/**
 * `Ahmed Mansour` → `Ah••• M•••`.
 * The first name keeps two letters and the rest keep one — enough to
 * disambiguate a row you already know, not enough to identify one you
 * do not.
 */
export function maskName(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return UNKNOWN;

  return words
    .map((word, index) => {
      const keep = index === 0 ? 2 : 1;
      // A word shorter than what we would keep is shown as bullets only,
      // rather than in the clear.
      if (word.length <= keep) return BULLETS;
      return word.slice(0, keep) + BULLETS;
    })
    .join(' ');
}

/** `PT-1004` → `••••1004`. Keeps the last four characters, digits or not. */
export function maskMrn(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return UNKNOWN;
  if (trimmed.length <= 4) return '••••';

  return `••••${trimmed.slice(-4)}`;
}

/**
 * `omar.farouk@example.test` → `o•••@example.test`.
 * The domain stays: it is operationally useful (which provider, which
 * clinic) and is not by itself an identifier.
 */
export function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return UNKNOWN;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);

  return `${local.slice(0, 1)}${BULLETS}${domain}`;
}

/** `+1 (555) 018-4402` → `••• ••• 4402`. Keeps the last four digits. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return UNKNOWN;

  return `••• ••• ${digits.slice(-4)}`;
}

/**
 * `1984-03-11` → `••/••/1984`. The year alone supports age-band checks
 * without pinning an individual, which is the usual reason an admin
 * needs a date of birth on a list at all.
 */
export function maskDateOfBirth(value: string): string {
  const match = /(\d{4})/.exec(value.trim());
  if (!match) return UNKNOWN;

  return `••/••/${match[1] ?? ''}`;
}

export type PhiFieldKind = 'name' | 'mrn' | 'email' | 'phone' | 'dateOfBirth';

const MASKERS: Record<PhiFieldKind, (value: string) => string> = {
  name: maskName,
  mrn: maskMrn,
  email: maskEmail,
  phone: maskPhone,
  dateOfBirth: maskDateOfBirth,
};

/** Masks by field kind — the form a projection actually calls. */
export function maskPhi(kind: PhiFieldKind, value: string): string {
  return MASKERS[kind](value);
}

/** Human label for a field kind, used in the justification prompt and log. */
export const PHI_FIELD_LABEL: Record<PhiFieldKind, string> = {
  name: 'Patient name',
  mrn: 'Medical record number',
  email: 'Email address',
  phone: 'Phone number',
  dateOfBirth: 'Date of birth',
};

export const PHI_FIELD_KINDS: readonly PhiFieldKind[] = [
  'name',
  'mrn',
  'email',
  'phone',
  'dateOfBirth',
];
