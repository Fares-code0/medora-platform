import { describe, expect, it } from 'vitest';

import { parseBootstrapArgs } from './bootstrap-admin.args';

/**
 * `admin:bootstrap` stops on its arguments before touching a database.
 * The run itself is `test/admin-bootstrap.e2e-spec.ts`.
 */
describe('parseBootstrapArgs', () => {
  it('runs with an address and --confirm, mailing by default', () => {
    expect(parseBootstrapArgs(['--email', 'Owner@Clinic.example', '--confirm'])).toEqual({
      kind: 'run',
      args: { email: 'Owner@Clinic.example', delivery: 'email', reissue: false },
    });
  });

  it('prints instead of mailing, and reissues, only when asked', () => {
    expect(
      parseBootstrapArgs(['--confirm', '--print-link', '--reissue', '--email', 'a@b.example']),
    ).toEqual({
      kind: 'run',
      args: { email: 'a@b.example', delivery: 'print', reissue: true },
    });
  });

  it('does nothing without --confirm, and names the address it would have used', () => {
    const parsed = parseBootstrapArgs(['--email', 'a@b.example']);

    expect(parsed.kind).toBe('usage');
    expect(parsed.kind === 'usage' && parsed.problem).toContain('a@b.example');
  });

  it.each([
    [[], '--email is required'],
    [['--email'], '--email needs an address'],
    [['--email', '--confirm'], '--email needs an address'],
    [['--email', 'not-an-address', '--confirm'], 'Not an email address'],
    [['--email', 'a@b.example', '--confirm', '--force'], 'Unknown argument: --force'],
  ])('refuses %j', (argv, problem) => {
    const parsed = parseBootstrapArgs(argv);

    expect(parsed.kind).toBe('usage');
    expect(parsed.kind === 'usage' && parsed.problem).toContain(problem);
  });

  it('answers --help with the usage and no problem', () => {
    expect(parseBootstrapArgs(['--help'])).toEqual({ kind: 'usage', problem: null });
  });
});
