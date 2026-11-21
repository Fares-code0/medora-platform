import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../errors/app.exception';

import {
  appliedFilterNames,
  csvFileName,
  EXPORT_ROW_LIMIT,
  exportTooLarge,
  quote,
  sendCsv,
  toCsv,
  type CsvColumn,
} from './csv-export';

describe('quote', () => {
  it('quotes every field and doubles embedded quotes (RFC 4180)', () => {
    expect(quote('plain')).toBe('"plain"');
    expect(quote('a, b')).toBe('"a, b"');
    expect(quote('say "hi"')).toBe('"say ""hi"""');
    expect(quote('line\nbreak')).toBe('"line\nbreak"');
  });

  it('writes null and undefined as an empty field', () => {
    expect(quote(null)).toBe('""');
    expect(quote(undefined)).toBe('""');
  });

  it.each(['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'neutralises formula-leading text %j with a leading single quote',
    (value) => {
      const field = quote(value);
      expect(field.startsWith(`"'`)).toBe(true);
      expect(field.slice(2, 3)).toBe(value.slice(0, 1));
    },
  );

  it('leaves numbers and booleans numeric — a negative number is not text', () => {
    expect(quote(-5)).toBe('"-5"');
    expect(quote(42)).toBe('"42"');
    expect(quote(true)).toBe('"true"');
  });

  it('does not prefix text that merely contains a formula character', () => {
    expect(quote('BP 120/80 - stable')).toBe('"BP 120/80 - stable"');
    expect(quote('a=b')).toBe('"a=b"');
  });
});

describe('toCsv', () => {
  interface Row {
    readonly id: string;
    readonly note: string | null;
    readonly count: number;
  }

  const columns: readonly CsvColumn<Row>[] = [
    { header: 'id', value: (row) => row.id },
    { header: 'note', value: (row) => row.note },
    { header: 'count', value: (row) => row.count },
  ];

  it('writes a header row and CRLF-terminated records', () => {
    const csv = toCsv(columns, [
      { id: 'PT-1', note: 'ok', count: 1 },
      { id: 'PT-2', note: null, count: 0 },
    ]);

    expect(csv).toBe('"id","note","count"\r\n"PT-1","ok","1"\r\n"PT-2","","0"\r\n');
  });

  it('writes only the header for an empty list', () => {
    expect(toCsv(columns, [])).toBe('"id","note","count"\r\n');
  });

  it('keeps a multi-line value inside one record', () => {
    const csv = toCsv(columns, [{ id: 'PT-1', note: 'one\r\ntwo', count: 1 }]);

    // Two CRLFs end the two records; the one inside the quotes is data.
    expect(csv.split('"\r\n')).toHaveLength(3);
  });
});

describe('appliedFilterNames', () => {
  it('names the filters that were set, sorted, never their values', () => {
    expect(
      appliedFilterNames({ q: 'Layla', status: ['active'], sort: 'name:asc', to: undefined }),
    ).toBe('q,status');
  });

  it('is empty when nothing but the sort was given', () => {
    expect(appliedFilterNames({ sort: 'name:asc' })).toBe('');
  });
});

describe('exportTooLarge', () => {
  it('is a 409 with a stable code and the count in the detail', () => {
    const error = exportTooLarge(EXPORT_ROW_LIMIT + 1);

    expect(error).toBeInstanceOf(AppException);
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('export_too_large');
    expect(error.detail).toContain(String(EXPORT_ROW_LIMIT + 1));
  });
});

describe('csvFileName / sendCsv', () => {
  it('dates the file name in UTC', () => {
    expect(csvFileName('patients', new Date('2026-11-05T23:59:00Z'))).toBe(
      'patients-2026-11-05.csv',
    );
  });

  it('sends an attachment that no cache may store', () => {
    const headers: Record<string, string> = {};
    const response = {
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(function (this: unknown, name: string, value: string) {
        headers[name] = value;
        return this;
      }),
      send: vi.fn().mockReturnThis(),
    };

    sendCsv(response as never, { fileName: 'x.csv', body: '"a"\r\n', rowCount: 0 });

    expect(response.status).toHaveBeenCalledWith(200);
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toBe('attachment; filename="x.csv"');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(response.send).toHaveBeenCalledWith('"a"\r\n');
  });
});
