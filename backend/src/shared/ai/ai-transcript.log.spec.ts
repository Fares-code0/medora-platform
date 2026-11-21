import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { Logger } from '@nestjs/common';
import pinoHttp, { type Options } from 'pino-http';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLoggerOptions } from '../../common/logging/logger.config';
import { REDACTED_KEYS } from '../../common/logging/redaction';
import {
  AI_LOG_RETENTION_DAYS,
  AiTranscriptLog,
  type AiTranscriptRecord,
} from './ai-transcript.log';

/**
 * The PHI-log scan, extended to the AI transcript log (RM M37.3, item 3).
 *
 * `ai-transcript.log.ts` records shape and cost and never the prompt or the
 * completion. That is true by construction today; this is what keeps it true
 * rather than merely intended. Three layers, because each catches a different
 * edit:
 *
 *  1. **The record's declared fields** are an exact allow-list. Adding a field
 *     (a `prompt`, a `patientId`) fails here and names it.
 *  2. **Every call site** of `transcript.record(...)` passes only allow-listed
 *     keys, so a field cannot reach the line from the caller's side either.
 *  3. **The line pino actually writes**, through the real `buildLoggerOptions`,
 *     carries exactly the allow-listed keys with values of the allowed *kind*
 *     (ids, counts, booleans, short enums), and none of the PHI sentinels.
 *
 * Allowing a new field is a deliberate edit to `ALLOWED_FIELDS` below, in the
 * same commit, reviewed as a PHI decision.
 */

/** field -> the kind of value it may hold. Counts and bits, never text. */
const ALLOWED_FIELDS: Readonly<Record<string, 'uuid' | 'boolean' | 'count' | 'token'>> = {
  conversationId: 'uuid',
  userId: 'uuid',
  patientBound: 'boolean',
  contextMode: 'token',
  promptChars: 'count',
  completionChars: 'count',
  durationMs: 'count',
  outcome: 'token',
  errorCode: 'token',
};

/** Fields the logger itself adds around the record. */
const LOGGER_FIELDS = ['event', 'retentionDays'];

const SRC = join(__dirname, '..', '..');
const LOG_SOURCE = join(__dirname, 'ai-transcript.log.ts');

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function declaredFields(): string[] {
  const names: string[] = [];
  sourceFile(LOG_SOURCE).forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'AiTranscriptRecord') {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name))
          names.push(member.name.text);
      }
    }
  });
  return names;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.e2e-spec.ts')
      ? [full]
      : [];
  });
}

interface CallSite {
  readonly file: string;
  readonly keys: string[];
  readonly spread: boolean;
}

/** Every `<something>.transcript.record({...})` / `AiTranscriptLog#record` literal under src. */
function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of walk(SRC)) {
    if (file === LOG_SOURCE) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('AiTranscriptLog')) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'record' &&
        /transcript/i.test(node.expression.expression.getText())
      ) {
        const arg = node.arguments[0];
        const keys: string[] = [];
        let spread = false;
        if (arg !== undefined && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (ts.isSpreadAssignment(prop)) {
              // `...(cond ? {} : { errorCode })` is fine: read the literals inside it.
              // A spread of anything else (a variable, a call) cannot be proven.
              const inner: ts.ObjectLiteralExpression[] = [];
              const collect = (n: ts.Node): void => {
                if (ts.isObjectLiteralExpression(n)) inner.push(n);
                ts.forEachChild(n, collect);
              };
              collect(prop.expression);
              if (inner.length === 0) spread = true;
              for (const literal of inner) {
                for (const p of literal.properties) {
                  if (ts.isSpreadAssignment(p)) spread = true;
                  else if (p.name !== undefined) keys.push(p.name.getText());
                }
              }
            } else if (prop.name !== undefined) keys.push(prop.name.getText());
          }
        } else {
          spread = true; // not a literal: cannot be proven, so it fails below
        }
        sites.push({ file, keys, spread });
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  return sites;
}

/** Drive the real logger call through the production pino configuration. */
function logged(entry: AiTranscriptRecord): Record<string, unknown> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const pino = pinoHttp(
    buildLoggerOptions({ appEnv: 'production' }).pinoHttp as Options,
    sink,
  ).logger;

  const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation((payload: unknown) => {
    pino.info(payload as object);
  });
  try {
    new AiTranscriptLog().record(entry);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ENTRY: AiTranscriptRecord = {
  conversationId: '6f1c2a54-7a64-4c1e-9d0e-2f6a8b1c3d4e',
  userId: '0b9c1d7e-5a3f-4e2b-8c6d-1a2b3c4d5e6f',
  patientBound: true,
  contextMode: 'patient',
  promptChars: 412,
  completionChars: 1873,
  durationMs: 5120,
  outcome: 'error',
  errorCode: 'generation_failed',
};

afterEach(() => vi.restoreAllMocks());

describe('the AI transcript log never records text or identifiers of a patient (M37.3)', () => {
  it('declares exactly the allow-listed fields, no more', () => {
    expect(declaredFields().sort()).toEqual(Object.keys(ALLOWED_FIELDS).sort());
  });

  it('allow-lists no field the redaction list classes as PHI or a secret', () => {
    // A field named like one the logger censors elsewhere is a field somebody
    // believed could hold PHI; it should not be a field of this record at all.
    const sensitive = new Set(REDACTED_KEYS.map((key) => key.toLowerCase()));
    expect(Object.keys(ALLOWED_FIELDS).filter((key) => sensitive.has(key.toLowerCase()))).toEqual(
      [],
    );
    for (const banned of [
      'prompt',
      'completion',
      'content',
      'text',
      'message',
      'patientid',
      'patient',
    ]) {
      expect(Object.keys(ALLOWED_FIELDS).map((key) => key.toLowerCase())).not.toContain(banned);
    }
  });

  it('is called, everywhere, with a literal of allow-listed keys and no spread', () => {
    const sites = callSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      const where = site.file.slice(SRC.length + 1);
      expect(site.spread, `${where}: record() must be passed a plain literal`).toBe(false);
      expect(
        site.keys.filter((key) => !(key in ALLOWED_FIELDS)),
        `${where}: a key outside the PHI allow-list reaches the transcript log`,
      ).toEqual([]);
    }
  });

  it('writes a line of ids, counts, a boolean and short tokens, through production pino', () => {
    const line = logged(ENTRY);

    // pino's own bookkeeping aside, the line has nothing but allow-listed and logger fields.
    const pinoFields = ['level', 'time', 'pid', 'hostname', 'msg'];
    expect(
      Object.keys(line).filter(
        (key) =>
          !pinoFields.includes(key) && !LOGGER_FIELDS.includes(key) && !(key in ALLOWED_FIELDS),
      ),
    ).toEqual([]);
    expect(line).toMatchObject({ event: 'ai.generation', retentionDays: AI_LOG_RETENTION_DAYS });

    for (const [field, kind] of Object.entries(ALLOWED_FIELDS)) {
      const value = line[field];
      switch (kind) {
        case 'uuid':
          expect(value, field).toMatch(UUID);
          break;
        case 'boolean':
          expect(typeof value, field).toBe('boolean');
          break;
        case 'count':
          expect(Number.isInteger(value), field).toBe(true);
          break;
        case 'token':
          expect(String(value), field).toMatch(/^[a-z_-]{1,32}$/);
          break;
      }
    }
  });

  it('is not censored into uselessness by the redaction paths', () => {
    expect(JSON.stringify(logged(ENTRY))).not.toContain('[redacted]');
  });

  it('drops whatever a caller smuggles past the type, rather than logging it', () => {
    // The call-site scan above is one guard; this is the other. A cast is all it
    // takes to put text on the entry, and the logger must not pass it through.
    const smuggled = {
      ...ENTRY,
      prompt: 'Summarise Mona Adel’s penicillin anaphylaxis',
      completion: 'The patient reports…',
      patientId: 'PT-1002',
    } as unknown as AiTranscriptRecord;

    const line = logged(smuggled);

    for (const field of ['prompt', 'completion', 'patientId']) {
      expect(line, field).not.toHaveProperty(field);
    }
    expect(JSON.stringify(line)).not.toMatch(/Mona|penicillin|PT-1002|reports/);
    expect(line).toMatchObject({ conversationId: ENTRY.conversationId, outcome: 'error' });
  });
});
