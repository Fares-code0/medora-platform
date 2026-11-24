import fs from 'node:fs';
import path from 'node:path';

import { passwordPolicyErrors, registerFormSchema } from '@/features/auth/schemas';

import { VALIDATION_KEYS, translateValidation, validationMessageKey } from './validation';

import { catalogues, interpolate } from './index';

/**
 * Form validation in the patient's language — C-09.
 *
 * `schemas.ts` keeps English messages that mirror the backend DTOs, and
 * `validation.ts` maps each to a `validation.*` key at render. The
 * mapping is only as good as its coverage, so this reads every literal
 * message out of the schema source and requires a key for each.
 */

const SCHEMAS = fs.readFileSync(
  path.resolve(__dirname, '..', 'features', 'auth', 'schemas.ts'),
  'utf8',
);

/** The messages the schemas hand to Zod, as written in the source. */
function schemaMessages(): string[] {
  const code = SCHEMAS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = new Set<string>();
  for (const pattern of [
    /\.(?:min|max|length|email|regex|refine)\([^'`]*?'([A-Z][^']+)'\)/g,
    /message:\s*'([A-Z][^']+)'/g,
    /failures\.push\('([A-Z][^']+)'\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.add(match[1] ?? '');
  }
  return [...found];
}

const tFor = (locale: 'en' | 'ar') => (key: (typeof VALIDATION_KEYS)[number], params?: object) =>
  interpolate(catalogues[locale][key], params as Record<string, string>);

describe('every schema message has a key (C-09)', () => {
  it('finds the schema messages it is checking', () => {
    // Guards the scan itself: an empty list would pass everything below.
    expect(schemaMessages().length).toBeGreaterThanOrEqual(20);
  });

  it.each(schemaMessages())('maps "%s" to a validation key', (message) => {
    expect(validationMessageKey(message)).not.toBeNull();
  });

  it('maps the templated password length, with its number', () => {
    const [first] = passwordPolicyErrors('');
    expect(first).toBe('Use at least 8 characters');
    expect(validationMessageKey(first ?? '')).toEqual({
      key: 'validation.password.length',
      params: { count: '8' },
    });
  });
});

describe('the rendered message', () => {
  it('is byte-identical to the schema message in English', () => {
    for (const message of [...schemaMessages(), ...passwordPolicyErrors('')]) {
      expect(translateValidation(tFor('en'), message)).toBe(message);
    }
  });

  it('is Arabic in Arabic, with no English left in it', () => {
    for (const message of [...schemaMessages(), ...passwordPolicyErrors('')]) {
      const arabic = translateValidation(tFor('ar'), message);
      expect({ message, arabic, latin: /[A-Za-z]{2,}/.test(arabic) }).toEqual({
        message,
        arabic,
        latin: false,
      });
    }
  });

  it('passes a message it does not know through unchanged — server text is not guessed at', () => {
    expect(translateValidation(tFor('ar'), 'That email is already registered')).toBe(
      'That email is already registered',
    );
  });

  it('names every validation key in the catalogue, and only those', () => {
    const inCatalogue = Object.keys(catalogues.en).filter((key) => key.startsWith('validation.'));
    expect([...VALIDATION_KEYS].sort()).toEqual(inCatalogue.sort());
  });
});

describe('the name length bound (review M-6)', () => {
  const tooLong = 'a'.repeat(61);
  const base = {
    firstName: 'Amina',
    lastName: 'Yusuf',
    email: 'amina@example.com',
    phone: '+962790000000',
    password: 'Password1!',
    confirmPassword: 'Password1!',
    acceptTerms: true,
    acceptPrivacy: true,
  };

  it('names the bound in a sentence of its own instead of Zod’s default', () => {
    const parsed = registerFormSchema.safeParse({ ...base, firstName: tooLong });
    const message = parsed.success ? '' : (parsed.error.issues[0]?.message ?? '');
    expect(message).toBe('Use 60 characters or fewer');
    expect(validationMessageKey(message)).toEqual({
      key: 'validation.name.max',
      params: { count: '60' },
    });
    expect(translateValidation(tFor('ar'), message)).toBe('استخدم 60 حرفًا أو أقل');
  });

  it('still accepts a 60-character name, and a 61-character last name still fails', () => {
    expect(registerFormSchema.safeParse({ ...base, firstName: 'a'.repeat(60) }).success).toBe(true);
    expect(registerFormSchema.safeParse({ ...base, lastName: tooLong }).success).toBe(false);
  });
});
