import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Containment, asserted against the source (RM M16.1, M16.6).
 *
 * > **M16.6** ✅ Verify: the AI module's DB role/service cannot insert
 * > into `medical_records*` (test asserts the failure); a saved AI note
 * > carries permanent `aiAssisted` provenance.
 *
 * > **M16.1** ✅ Verify: grep proves exactly one module imports the
 * > provider SDK; a fake adapter drives all tests.
 *
 * ## Why this is a source test and not a database test
 *
 * The verify step names a "DB role" — a PostgreSQL role granted SELECT
 * but not INSERT on the clinical tables. That role does not exist:
 * **M37.3 owns the database roles**, and it is the same milestone the
 * M12 gate is still waiting on for its own DELETE grant. Writing a test
 * that granted itself a role here would be building M37 inside M16, and
 * would leave M37 removing it.
 *
 * What is available now is stronger in one respect and weaker in
 * another, and both are worth stating plainly. **Weaker:** a source
 * assertion cannot stop a compromised process, which a database grant
 * can. **Stronger:** it fails in review, on the commit that introduces
 * the write, rather than at runtime on the first request that exercises
 * it — and it names the file. The two are complements, and this is the
 * half that can exist today. The obligation transfers to M37.3, recorded
 * in the roadmap at that sub-item.
 *
 * ## Why grep over the source rather than a unit test with a mock
 *
 * A mocked repository proves what the mock does. These cases read the
 * files the application actually ships and assert properties of them, so
 * a later edit that adds `tx.medicalRecord.create` to the AI module
 * fails here even if every other test still passes — which is precisely
 * the edit this milestone exists to prevent.
 */

const AI_MODULE = join(__dirname);
const SRC = join(__dirname, '..', '..');

function filesUnder(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
      continue;
    }

    if (entry.name.endsWith('.ts')) found.push(path);
  }

  return found;
}

/**
 * Comments stripped before anything is matched.
 *
 * This file's first draft did not, and it failed on its own prose: the
 * module header explains *why* `AI_API_KEY` is unreachable, and a naive
 * substring search read that explanation as a violation. A containment
 * test that cannot tell code from the comment describing it is one that
 * punishes documentation, so every check below runs against code alone.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFilesUnder(directory: string): readonly { path: string; text: string }[] {
  return filesUnder(directory)
    // The specs themselves are not shipped behaviour, and this file
    // necessarily contains every string it forbids.
    .filter((path) => !path.endsWith('.spec.ts'))
    .map((path) => ({
      // POSIX separators on every platform: the rules below compare against
      // `shared/ai/` and `config/`, which `relative()` spells with `\` on
      // Windows — every allowed file then read as an offender.
      path: relative(SRC, path).split(sep).join('/'),
      text: stripComments(readFileSync(path, 'utf8')),
    }));
}

/**
 * The Prisma model accessors for the clinical tables.
 *
 * Named individually rather than matched by a pattern: a regex over
 * "anything clinical-looking" would drift out of step with the schema
 * silently, whereas a missing name here is visible in the list.
 */
const CLINICAL_MODELS = [
  'medicalRecord',
  'recordDiagnosis',
  'recordMedication',
  'recordAllergy',
  'recordNote',
  'recordAttachment',
  'recordTimelineEvent',
  'recordVersion',
  'patient',
  'patientAllergy',
  'patientMedication',
  'patientVitalSign',
  'labOrder',
  'labResult',
  'labSpecimen',
  'prescription',
  'appointment',
] as const;

/** Every Prisma call that writes. */
const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

describe('M16.6 — the AI module cannot write to a clinical table', () => {
  const sources = sourceFilesUnder(AI_MODULE);

  it('has files to inspect, so a passing run means something', () => {
    // Without this, a refactor that moved the module elsewhere would
    // turn every case below into a vacuous pass over an empty list.
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(CLINICAL_MODELS)('never calls a write method on %s', (model) => {
    const offenders = sources.filter((file) =>
      WRITE_METHODS.some((method) => file.text.includes(`${model}.${method}(`)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('issues no raw SQL, which is the one thing the checks above cannot see', () => {
    // The model-level rules below scan `.db.<model>.<method>` and
    // `tx.<model>.<method>`. Raw SQL names a *table*, not a model, so it
    // would pass every one of them while writing anything at all —
    // which makes it the one construct that has to be forbidden
    // outright rather than constrained.
    //
    // Transactions themselves are NOT forbidden: `appendMessage` runs
    // in one, because appending a turn and touching the thread's
    // `updated_at` must not half-happen. What matters is which tables a
    // transaction touches, and the `tx.` scan below covers that.
    const offenders = sources.filter(
      (file) =>
        file.text.includes('$executeRaw') ||
        file.text.includes('$queryRaw') ||
        file.text.includes('$executeRawUnsafe'),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('writes only to ai_* tables', () => {
    // The positive form of the rule. Every write the module performs
    // names a table it owns — so the list above cannot go stale in the
    // one direction that matters, a clinical table nobody thought to add
    // to it.
    const written = new Set<string>();

    for (const file of sources) {
      for (const match of file.text.matchAll(/\.db\.(\w+)\.(\w+)\(/g)) {
        const [, model = '', method = ''] = match;
        if ((WRITE_METHODS as readonly string[]).includes(method)) written.add(model);
      }
      // `tx.<model>.<method>` — the transactional form, in case one is
      // ever introduced.
      for (const match of file.text.matchAll(/\btx\.(\w+)\.(\w+)\(/g)) {
        const [, model = '', method = ''] = match;
        if ((WRITE_METHODS as readonly string[]).includes(method)) written.add(model);
      }
    }

    expect([...written].sort()).toEqual(['aiConversation', 'aiMessage', 'aiUserSetting']);
  });

  it('reaches clinical tables only through the read-only context repository', () => {
    // The reads that do exist are narrow and live in one file. A
    // clinical `findMany` appearing anywhere else in the module would
    // mean a second, unreviewed path to chart data.
    const offenders = sources.filter(
      (file) =>
        !file.path.endsWith('ai-context.repository.ts') &&
        CLINICAL_MODELS.some((model) => file.text.includes(`.db.${model}.`)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('has no write method on the context repository at all', () => {
    const context = sources.find((file) => file.path.endsWith('ai-context.repository.ts'));

    expect(context).toBeDefined();
    for (const method of WRITE_METHODS) {
      expect(context?.text).not.toContain(`.${method}({`);
    }
  });
});

describe('M16.1 — exactly one place may talk to a provider', () => {
  /**
   * Provider SDK package names.
   *
   * None is installed today — the gateway's production binding answers
   * 503 until one is (`UnconfiguredAiGateway`). The list is therefore
   * forward-looking on purpose: it is what makes the boundary hold on
   * the commit that first adds a provider, rather than something written
   * afterwards once the import is already in the wrong place.
   */
  const PROVIDER_PACKAGES = [
    '@anthropic-ai/sdk',
    'openai',
    '@google/generative-ai',
    '@azure/openai',
    'cohere-ai',
    '@mistralai/mistralai',
    'ollama',
  ] as const;

  const everything = sourceFilesUnder(join(SRC, 'modules')).concat(
    sourceFilesUnder(join(SRC, 'shared')),
    sourceFilesUnder(join(SRC, 'common')),
    sourceFilesUnder(join(SRC, 'config')),
  );

  it.each(PROVIDER_PACKAGES)('only shared/ai may import %s', (pkg) => {
    const importers = everything.filter((file) =>
      new RegExp(`from '${pkg.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`).test(file.text),
    );

    for (const file of importers) {
      expect(file.path.startsWith('shared/ai/')).toBe(true);
    }
  });

  it('only shared/ai and config read the provider credential', () => {
    // `AI_API_KEY` is declared in `config/env.schema.ts` and surfaced as
    // `ConfigService.isAiConfigured`. Nothing else may name it — a
    // module that could would be a module that could send it somewhere.
    const offenders = everything.filter(
      (file) =>
        file.text.includes('AI_API_KEY') &&
        !file.path.startsWith('shared/ai/') &&
        !file.path.startsWith('config/'),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('the AI module never names the gateway’s concrete class', () => {
    // Injecting the token rather than the class is what lets a test
    // substitute a fake adapter — and what stops a module pinning the
    // binding the kernel is supposed to choose.
    const offenders = sourceFilesUnder(AI_MODULE).filter((file) =>
      file.text.includes('UnconfiguredAiGateway'),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
