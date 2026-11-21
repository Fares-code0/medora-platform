/**
 * Synchronous CSV exports of clinical lists — API §4.10, §6.10, §7.10,
 * §8.11.
 *
 * ## One serialiser for four modules
 *
 * The patient, record, prescription and lab-order exports are the same
 * act over four projections: take the list the caller can already see,
 * with the filters they already applied, and hand it back as a file.
 * The column choice is each module's; the quoting, the row cap and the
 * response headers are not, and four hand-written copies of them would
 * be four places to get CSV injection wrong.
 *
 * ## Every field is quoted, and formula-leading text is neutralised
 *
 * RFC 4180 quoting is applied to every field, for the reason
 * `audit-export.service.ts` gives: a comma splits a row, a quote breaks
 * the parser, a newline invents a record.
 *
 * Quoting does not stop a spreadsheet from **evaluating** a cell. A
 * chief complaint or an allergy reaction typed as `=HYPERLINK(…)` is
 * free text a clinician — or anyone who can write to the chart — chose,
 * and the person opening the export is a different clinician on a
 * workstation with PHI on it (OWASP "CSV injection"). A text value
 * starting with `=`, `+`, `-`, `@`, tab or carriage return is therefore
 * prefixed with a single quote, which every mainstream spreadsheet reads
 * as "this is text". Numbers are written as numbers and never prefixed,
 * so a negative value stays numeric.
 *
 * ## Bounded, and a refusal rather than a truncation
 *
 * The contract's large-export path is "async job → file → notification",
 * which needs a generated file to pass M25.3's scan gate — the same
 * carry RA-M21.2 records for report exports. Until it exists the export
 * is synchronous and bounded at {@link EXPORT_ROW_LIMIT} rows. Above the
 * bound it answers **409 `export_too_large`** naming the count, and
 * writes nothing: a file silently cut at row 5,000 is a file somebody
 * will treat as the whole list. 409 rather than 422 by ADR-013's rule:
 * the request is well-formed and would be served against a smaller
 * list — what refuses it is the state of the data, not the body.
 */

import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { AppException } from '../errors/app.exception';

/** The most rows one synchronous export carries. */
export const EXPORT_ROW_LIMIT = 5_000;

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | null | undefined;
}

export interface CsvFile {
  readonly fileName: string;
  readonly body: string;
  readonly rowCount: number;
}

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => quote(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => quote(column.value(row))).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** One RFC 4180 field. Exported for its unit tests. */
export function quote(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';

  if (typeof value !== 'string') return `"${String(value)}"`;

  const text = FORMULA_LEAD.test(value) ? `'${value}` : value;

  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * The refusal above the bound. Not `413`: the request is small; what
 * cannot be served is the size of its answer.
 */
export function exportTooLarge(totalItems: number): AppException {
  return new AppException(HttpStatus.CONFLICT, {
    code: 'export_too_large',
    message: 'This export is too large to download at once',
    detail: `The filters match ${totalItems} rows; narrow them to ${EXPORT_ROW_LIMIT} or fewer`,
  });
}

/**
 * The names of the filters an export applied, sorted and comma-joined
 * for its audit row. **Names, never values**: a search term is a name or
 * a phone number, and the ledger keeps field names, not field values
 * (`audit.types`). `sort` is not a filter and is recorded on its own.
 */
export function appliedFilterNames(query: object): string {
  return Object.entries(query)
    .filter(([key, value]) => key !== 'sort' && value !== undefined)
    .map(([key]) => key)
    .sort()
    .join(',');
}

/** `<prefix>-YYYY-MM-DD.csv`, dated by the server's clock in UTC. */
export function csvFileName(prefix: string, now: Date = new Date()): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * Writes the file. `no-store`, because the body is PHI in bulk and a
 * browser's disk cache is not where a clinic's patient list should
 * outlive the download.
 */
export function sendCsv(response: Response, file: CsvFile): void {
  response
    .status(200)
    .setHeader('Content-Type', 'text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
    .setHeader('Cache-Control', 'no-store')
    .send(file.body);
}
