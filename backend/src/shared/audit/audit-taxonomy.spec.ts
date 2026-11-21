import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classify } from './audit-taxonomy';

/**
 * The taxonomy, held to the actions the codebase actually emits
 * (UX §3.7, RM M28.1).
 *
 * ## Why this spec reads the source tree
 *
 * The taxonomy classifies by entity prefix, so a module that invents a
 * new entity gets `system` and a warning rather than a wrong category.
 * That is the safe failure, not a good one — `system` on a clinical act
 * is a mis-filed ledger row. This spec closes the gap: it collects every
 * `action:` literal in `src/modules` and asserts each one is classified
 * explicitly, so adding an audited action to a new entity **fails here**
 * rather than being discovered in a log.
 *
 * Template-literal actions are covered by their prefix, which is what the
 * table keys on — `platform_settings.${slice}_updated` needs one entry,
 * not eleven.
 */
const MODULES = resolve(__dirname, '../../modules');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);

    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * Every `action: '<entity>.<verb>'` and `action: \`<entity>.…\``.
 *
 * `(\.[a-z_]+)+` rather than a single `\.[a-z_]+`, and that plus sign is
 * load-bearing: the first version of this spec matched two segments only
 * and so never saw `ai.conversation.create`, which was reaching the
 * ledger as an unclassified `system` event. A coverage check that cannot
 * see part of what it covers is worse than none, because it reports
 * green.
 */
function emittedActions(): string[] {
  const actions = new Set<string>();

  for (const file of sourceFiles(MODULES)) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(/action: '([a-z_]+(?:\.[a-z_]+)+)'/g)) {
      actions.add(match[1] ?? '');
    }
    // A template literal's entity is still literal, which is all the
    // taxonomy keys on — `platform_settings.${slice}_updated`.
    for (const match of source.matchAll(/action: `([a-z_]+)\./g)) {
      actions.add(`${match[1] ?? ''}.updated`);
    }
  }

  return [...actions].sort();
}

describe('every audited action the codebase emits is classified', () => {
  it('finds the actions at all', () => {
    // The guard against a regex that silently stops matching, which
    // would make every assertion below pass vacuously.
    expect(emittedActions().length).toBeGreaterThan(70);
  });

  it('classifies each one explicitly, never by falling through to system', () => {
    const unclassified = emittedActions().filter((action) => classify(action).unclassified);

    // A new entity added to `CATEGORY_BY_ENTITY` is a one-line change;
    // a clinical act filed under `system` is a mis-filed ledger row that
    // an investigator's category filter would never show them.
    expect(unclassified).toEqual([]);
  });

  it('writes a readable summary for each one', () => {
    for (const action of emittedActions()) {
      const summary = classify(action).summary;

      // The frontend renders `summary` verbatim in the log table. These
      // two assertions are what caught `updatedd` and
      // `administrativelyd` in the first draft of the participle rule.
      expect(summary, action).not.toMatch(/dd$/);
      expect(summary, action).not.toContain('_');
      // A dot means a multi-segment verb reached the prose unsplit.
      expect(summary, action).not.toContain('.');
      expect(summary.length, action).toBeLessThanOrEqual(300);
      expect(summary.charAt(0), action).toBe(summary.charAt(0).toUpperCase());
    }
  });
});

describe('the categories follow §14.1', () => {
  it('files getting in and out as authentication', () => {
    expect(classify('auth.login').category).toBe('authentication');
    expect(classify('session.revoke').category).toBe('authentication');
  });

  it('files boundary changes as security', () => {
    expect(classify('device.trust').category).toBe('security');
    expect(classify('communication_access.view').category).toBe('security');
  });

  it('files platform and account administration as admin_activity', () => {
    expect(classify('roles.matrix_update').category).toBe('admin_activity');
    expect(classify('platform_settings.security_updated').category).toBe('admin_activity');
    expect(classify('user.administer').category).toBe('admin_activity');
  });

  it('files clinical work as user_action', () => {
    expect(classify('prescription.sign').category).toBe('user_action');
    expect(classify('medical_record.note_sign').category).toBe('user_action');
    // Three segments, and the entity is still the first. This is the
    // action the coverage regex used to miss.
    expect(classify('ai.conversation.create').category).toBe('user_action');
  });

  it('files an unknown entity as system, and says it was unclassified', () => {
    const unknown = classify('telemetry.ping');

    expect(unknown.category).toBe('system');
    // The flag is what makes the dispatcher warn. Without it the row
    // would be indistinguishable from a deliberate `system` event.
    expect(unknown.unclassified).toBe(true);
  });
});

describe('the severities reserve critical for what an investigator opens first', () => {
  it('marks a replayed refresh token critical', () => {
    // Either token theft or a client bug, and ADR-026 treats it as theft.
    expect(classify('auth.refresh_reuse_detected').severity).toBe('critical');
  });

  it('marks a permission matrix rewrite critical', () => {
    expect(classify('roles.matrix_update').severity).toBe('critical');
  });

  it('separates routine from consequential on the same entity', () => {
    // The verb decides, not the entity: registering a patient is work,
    // deactivating one is not.
    expect(classify('patient.create').severity).toBe('info');
    expect(classify('patient.deactivate').severity).toBe('warning');
  });

  it('marks the two risky settings slices, and not the other nine', () => {
    expect(classify('platform_settings.security_updated').severity).toBe('warning');
    expect(classify('platform_settings.retention_updated').severity).toBe('warning');
    expect(classify('platform_settings.branding_updated').severity).toBe('info');
  });
});

describe('the summaries read as prose', () => {
  it.each([
    ['prescription.sign', 'Prescription signed'],
    ['medical_record.note_add', 'Medical record note added'],
    ['appointment.cancel_administratively', 'Appointment cancelled by an administrator'],
    ['platform_settings.security_updated', 'Platform settings security updated'],
    ['auth.two_factor_setup', 'Auth two-factor set up'],
    ['lab_order.attach_to_record', 'Lab order attached to a record'],
    ['medical_record.report_issue', 'Medical record issue reported'],
    ['file.download', 'File downloaded'],
    ['appointment.propose_slots', 'Appointment slots proposed'],
    ['ai.conversation.create', 'Ai conversation created'],
  ])('%s → %s', (action, summary) => {
    expect(classify(action).summary).toBe(summary);
  });
});
