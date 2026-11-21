/**
 * Reads `docs/BACKEND_API_CONTRACT.md` for the OpenAPI conformance check
 * (RM M33.2).
 *
 * The contract is prose with tables, not a machine format, so this reads it
 * conservatively: a **module** is a numbered `## N. Title` section, and a
 * **literal endpoint** is a back-ticked `METHOD /path` token inside it
 * (`GET/PUT /me/availability` names two). Shorthand such as `…/{id}` or
 * `· /request-documents` is not a literal and is not guessed at.
 */

export interface ContractModule {
  readonly number: number;
  readonly title: string;
  /** `GET /patients/{}` style, parameters collapsed, query string dropped. */
  readonly literals: readonly string[];
  /** Static path prefixes the module names, e.g. `/me/settings`. */
  readonly prefixes: readonly string[];
}

const VERBS = '(?:GET|POST|PUT|PATCH|DELETE)';
const TOKEN = new RegExp(`\`(${VERBS}(?:[/|]${VERBS})*) (/[^\`\\s]*)\``, 'g');

/** `/patients/{patientId}/notes?x=1` → `/patients/{}/notes`. */
export function normalisePath(path: string): string {
  return (path.split('?')[0] ?? path).replace(/\{[^}]*\}|:[A-Za-z0-9_]+/g, '{}').replace(/\/$/, '');
}

/** The leading segments with no parameter: `/patients/{}/notes` → `/patients`. */
export function staticPrefix(path: string): string {
  const parts = normalisePath(path).split('/').filter(Boolean);
  const keep: string[] = [];
  for (const part of parts) {
    if (part === '{}' || !/^[a-z0-9-]+$/i.test(part)) break;
    keep.push(part);
  }
  return `/${keep.join('/')}`;
}

export function parseContractModules(markdown: string): ContractModule[] {
  const sections = markdown.split(/^## (?=\d+\. )/m).slice(1);
  const modules: ContractModule[] = [];

  for (const section of sections) {
    const heading = /^(\d+)\. ([^\n]*)/.exec(section);
    if (heading === null) continue;
    const number = Number(heading[1]);
    if (number < 1) continue;

    const literals = new Set<string>();
    const prefixes = new Set<string>();
    for (const match of section.matchAll(TOKEN)) {
      const path = match[2]!;
      // `…` marks shorthand relative to an earlier path, not an endpoint.
      if (path.includes('…')) continue;
      for (const verb of match[1]!.split(/[/|]/)) literals.add(`${verb} ${normalisePath(path)}`);
      const prefix = staticPrefix(path);
      if (prefix !== '/') prefixes.add(prefix);
    }

    modules.push({
      number,
      title: heading[2]!.replace(/\s*\[.*$/, '').trim(),
      literals: [...literals].sort(),
      prefixes: [...prefixes].sort(),
    });
  }

  return modules;
}

/** `GET /api/v1/patients/{patientId}` → `GET /patients/{}`. */
export function contractKeyOf(operationKey: string, globalPrefix: string): string {
  const [verb, ...rest] = operationKey.split(' ');
  return `${verb!} ${normalisePath(rest.join(' ').slice(globalPrefix.length))}`;
}

export interface ModuleCoverage {
  readonly number: number;
  readonly title: string;
  readonly literals: number;
  readonly matched: number;
  /** Contract literals no operation serves, as `GET /me/x`. */
  readonly unmatched: readonly string[];
}

/** Which of each module's literal endpoints an operation serves. */
export function moduleCoverage(
  modules: readonly ContractModule[],
  operationKeys: readonly string[],
  globalPrefix: string,
): ModuleCoverage[] {
  const served = new Set(operationKeys.map((key) => contractKeyOf(key, globalPrefix)));
  return modules.map((module) => {
    const unmatched = module.literals.filter((literal) => !served.has(literal));
    return {
      number: module.number,
      title: module.title,
      literals: module.literals.length,
      matched: module.literals.length - unmatched.length,
      unmatched,
    };
  });
}
