import { useCallback } from 'react';

import { useT, type TranslateFn } from './LocaleProvider';
import { en, type MessageKey } from './messages';

/**
 * Form validation messages, in the patient's language (C-09).
 *
 * `features/auth/schemas.ts` writes its Zod messages in English on
 * purpose: they mirror the backend DTOs message for message, and
 * `schemas.test.ts` pins them. A module-level schema cannot read a hook,
 * so the translation happens here, at render: the message a schema
 * produced is matched against the ENGLISH value of every `validation.*`
 * key, and the key is rendered in the current locale.
 *
 * The patterns are derived from `en.ts`, not written twice, so a schema
 * message and its key cannot drift apart without the match failing — and
 * `validation.test.ts` asserts that every message in `schemas.ts`
 * matches one. A `{placeholder}` in a key becomes a capture group, so
 * `Use at least 8 characters` maps to `validation.password.length` with
 * `{ count: '8' }`.
 *
 * A message that matches nothing — a server's field error passed through
 * `setError` — is returned unchanged. That text is the server's, not this
 * app's, and is never guessed at.
 */

interface Matcher {
  readonly key: MessageKey;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every validation key, named so a reader (and the unread-key scan) can find it. */
export const VALIDATION_KEYS: readonly MessageKey[] = [
  'validation.password.length',
  'validation.password.lower',
  'validation.password.upper',
  'validation.password.digit',
  'validation.password.symbol',
  'validation.password.required',
  'validation.password.mismatch',
  'validation.password.reused',
  'validation.confirmPassword.required',
  'validation.currentPassword.required',
  'validation.confirmNewPassword.required',
  'validation.email.required',
  'validation.email.invalid',
  'validation.code.length',
  'validation.code.digits',
  'validation.firstName.required',
  'validation.lastName.required',
  'validation.name.max',
  'validation.phone.required',
  'validation.phone.invalid',
  'validation.terms.required',
  'validation.privacy.required',
  'validation.token.required',
];

const MATCHERS: readonly Matcher[] = VALIDATION_KEYS.map((key) => {
  const template = en[key];
  const names: string[] = [];
  const source = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const placeholder = /^\{(\w+)\}$/.exec(part);
      if (placeholder === null) return escape(part);
      names.push(placeholder[1] ?? '');
      return '(.+?)';
    })
    .join('');
  return { key, pattern: new RegExp(`^${source}$`), names };
});

/** The key (and its parameters) for a schema message, or `null`. */
export function validationMessageKey(
  message: string,
): { key: MessageKey; params: Record<string, string> } | null {
  for (const { key, pattern, names } of MATCHERS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    const params: Record<string, string> = {};
    names.forEach((name, index) => {
      params[name] = match[index + 1] ?? '';
    });
    return { key, params };
  }
  return null;
}

/** Pure form, for callers that already hold a `t`. */
export function translateValidation(t: TranslateFn, message: string): string {
  const found = validationMessageKey(message);
  return found === null ? message : t(found.key, found.params);
}

/** The hook a form renders its field errors through. */
export function useValidationMessage(): (message: string) => string {
  const t = useT();
  return useCallback((message: string) => translateValidation(t, message), [t]);
}
