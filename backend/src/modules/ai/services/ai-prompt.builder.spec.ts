import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OUTPUT_TOKENS,
  buildSystemPrompt,
  outputTokensFor,
  titleFromMessage,
} from './ai-prompt.builder';
import type { ResolvedContext } from './ai-context.service';

/**
 * What leaves the deployment (RM M16.3, M16.6).
 *
 * The prompt builder is the boundary between what the server knows and
 * what is sent to a third party, so the interesting assertions here are
 * **negative**: which facts the server holds and does not send. A test
 * that only checked the happy string would pass just as well if the
 * builder started appending the patient's MRN, their chart, or the
 * contents of the bound record.
 */
const GENERAL: ResolvedContext = { mode: 'general', patient: null, entity: null, scope: null };

const PATIENT: ResolvedContext = {
  mode: 'patient',
  patient: { id: 'uuid-1', publicId: 'PT-1004', fullName: 'Layla Morsi' },
  entity: null,
  scope: null,
};

const LABS: ResolvedContext = {
  mode: 'labs',
  patient: PATIENT.patient,
  entity: { refId: 'LAB-100429', summary: 'Basic Metabolic Panel (completed)' },
  scope: null,
};

const BALANCED = { responseLength: 'balanced', language: 'en' };

describe('what the prompt refuses to carry', () => {
  it('never contains an MRN', () => {
    // The name makes an answer readable and is already in the thread's
    // title bar. The MRN identifies the person *across systems*, which
    // is what makes it the more dangerous of the two to hand to a third
    // party, and it adds nothing to an answer.
    const prompt = buildSystemPrompt(LABS, BALANCED);

    expect(prompt).not.toContain('MRN');
    expect(prompt).not.toMatch(/\bMRN-\w+/);
  });

  it('never contains a uuid', () => {
    // Internal keys are the deployment's, not a provider's.
    expect(buildSystemPrompt(LABS, BALANCED)).not.toContain('uuid-1');
  });

  it('names what was bound without saying what it contains', () => {
    // `BoundEntity.summary` is built from a narrow projection — the test
    // name and its status, not a single result value. This asserts the
    // *shape* of that promise at the boundary it matters.
    const prompt = buildSystemPrompt(LABS, BALANCED);

    expect(prompt).toContain('LAB-100429');
    expect(prompt).toContain('Basic Metabolic Panel');
    // And the instruction that makes the omission legible to the model,
    // rather than leaving it to infer that it has the chart.
    expect(prompt).toContain('You have not been given their chart');
  });

  it('tells the model it cannot write to the record (M16.6)', () => {
    // Containment is structural — the module has no write path — but a
    // model that believes it is writing to the chart will phrase its
    // answers as though it had. Saying so is how the prose matches what
    // the system does.
    const prompt = buildSystemPrompt(PATIENT, BALANCED);

    expect(prompt).toContain('cannot read or write the patient record');
    expect(prompt).toContain('sign a note');
  });
});

describe('the context line says which binding is in force', () => {
  it('states plainly that a general thread has no patient', () => {
    // Said explicitly rather than omitted: a model given no context line
    // may assume it has one, and would phrase an answer as though about
    // someone.
    const prompt = buildSystemPrompt(GENERAL, BALANCED);

    expect(prompt).toContain('No patient is attached');
    expect(prompt).not.toContain('Layla Morsi');
  });

  it('names the patient in a patient-bound thread', () => {
    const prompt = buildSystemPrompt(PATIENT, BALANCED);

    expect(prompt).toContain('Layla Morsi');
    expect(prompt).toContain('PT-1004');
  });

  it('adds the entity line only when an entity is bound', () => {
    expect(buildSystemPrompt(PATIENT, BALANCED)).not.toContain('grounded in');
    expect(buildSystemPrompt(LABS, BALANCED)).toContain('grounded in');
  });
});

describe('settings shape the request rather than the content', () => {
  it('asks for the length the doctor chose', () => {
    expect(
      buildSystemPrompt(GENERAL, { responseLength: 'concise', language: 'en' }),
    ).toContain('few sentences');
    expect(
      buildSystemPrompt(GENERAL, { responseLength: 'detailed', language: 'en' }),
    ).toContain('thoroughly');
  });

  it('asks for the language the doctor chose', () => {
    expect(buildSystemPrompt(GENERAL, { responseLength: 'balanced', language: 'ar' })).toContain(
      'Arabic',
    );
  });

  it('omits guidance rather than inventing it for an unknown value', () => {
    // Unreachable through the API — the Zod enum refuses anything else —
    // so the property under test is that the fallback is silence, not a
    // guess. A builder that defaulted to "concise" would quietly halve
    // every answer if a new vocabulary value were added upstream.
    const prompt = buildSystemPrompt(GENERAL, { responseLength: 'epic', language: 'kl' });

    expect(prompt).not.toContain('sentences');
    expect(prompt).not.toContain('English');
  });

  it('maps response length to a token ceiling, ascending', () => {
    expect(outputTokensFor('concise')).toBeLessThan(outputTokensFor('balanced'));
    expect(outputTokensFor('balanced')).toBeLessThan(outputTokensFor('detailed'));
  });

  it('falls back to the balanced ceiling for an unknown length', () => {
    // A ceiling of `undefined` would reach the provider as "no limit",
    // which is the one failure mode that costs money.
    expect(outputTokensFor('epic')).toBe(DEFAULT_OUTPUT_TOKENS);
  });
});

describe('a thread is named by its opening question', () => {
  it('uses the question when it is short enough', () => {
    expect(titleFromMessage('Check for interactions', 'New conversation')).toBe(
      'Check for interactions',
    );
  });

  it('collapses whitespace so a pasted question does not wrap the sidebar', () => {
    expect(titleFromMessage('Check   for\n\ninteractions', 'x')).toBe('Check for interactions');
  });

  it('truncates on a word boundary, and says it truncated', () => {
    const title = titleFromMessage(
      'Please review this medication regimen for appropriateness, dosing and duplication',
      'x',
    );

    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    // Not cut mid-word: the character before the ellipsis is the end of
    // a word, not the middle of one.
    expect(title).not.toMatch(/\s…$/);
    expect(title.startsWith('Please review this medication regimen')).toBe(true);
  });

  it('falls back when the question is only whitespace', () => {
    // Unreachable through the API (`min(1)` after `trim`), so what is
    // asserted is that the fallback exists rather than producing an
    // empty title in a sidebar.
    expect(titleFromMessage('   ', 'New conversation')).toBe('New conversation');
  });
});
