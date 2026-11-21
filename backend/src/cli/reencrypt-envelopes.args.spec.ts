import { describe, expect, it } from 'vitest';

import { parseReencryptArgs } from './reencrypt-envelopes.args';

/**
 * `npm run crypto:reencrypt` argument rules (M37 key rotation). Each
 * refusal must stop the command before it opens the application, which
 * `runReencryptCommand` guarantees by parsing first.
 */
describe('parseReencryptArgs', () => {
  it('refuses to do anything without --dry-run or --confirm', () => {
    const parsed = parseReencryptArgs([]);
    expect(parsed.kind).toBe('usage');
    expect(parsed.kind === 'usage' ? parsed.problem : null).toContain('Nothing was done');
  });

  it('accepts a dry run', () => {
    expect(parseReencryptArgs(['--dry-run'])).toEqual({
      kind: 'run',
      args: { dryRun: true, batchSize: undefined },
    });
  });

  it('accepts a confirmed run with a batch size', () => {
    expect(parseReencryptArgs(['--confirm', '--batch-size', '50'])).toEqual({
      kind: 'run',
      args: { dryRun: false, batchSize: 50 },
    });
  });

  it('refuses both modes at once — the operator meant one of them', () => {
    expect(parseReencryptArgs(['--dry-run', '--confirm'])).toMatchObject({ kind: 'usage' });
  });

  it.each([
    [['--confirm', '--batch-size']],
    [['--confirm', '--batch-size', 'many']],
    [['--confirm', '--batch-size', '-5']],
    [['--confirm', '--batch-size', '0']],
    [['--confirm', '--batch-size', '5001']],
    [['--confirm', '--batch-size', '1.5']],
  ])('refuses a batch size that is not a whole number in range: %j', (argv) => {
    expect(parseReencryptArgs(argv)).toMatchObject({ kind: 'usage' });
  });

  it('accepts both ends of the batch-size range', () => {
    expect(parseReencryptArgs(['--dry-run', '--batch-size', '1'])).toMatchObject({ kind: 'run' });
    expect(parseReencryptArgs(['--dry-run', '--batch-size', '5000'])).toMatchObject({
      kind: 'run',
    });
  });

  it('refuses an unknown argument rather than ignoring it', () => {
    expect(parseReencryptArgs(['--confirm', '--force'])).toEqual({
      kind: 'usage',
      problem: 'Unknown argument: --force',
    });
  });

  it('prints usage on --help without a problem line', () => {
    expect(parseReencryptArgs(['--help'])).toEqual({ kind: 'usage', problem: null });
    expect(parseReencryptArgs(['-h'])).toEqual({ kind: 'usage', problem: null });
  });
});
