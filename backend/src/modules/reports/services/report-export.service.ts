/**
 * Exports — API §12.5, RM M21.5.
 *
 * > `POST /reports/export` `{ category, filters, format: csv|excel|pdf }`
 * > → **sync CSV** or **async job → file + notification**
 *
 * ## CSV ships; Excel and PDF do not, and the reason is two milestones
 *
 * The contract itself splits this route in two. The synchronous half is
 * a text serialisation of a snapshot this module already computes, so it
 * is built here and returns the bytes.
 *
 * The asynchronous half needs both halves of an infrastructure that does
 * not exist: a **job runner** (M30.1's queue registry, retries and
 * dead-lettering) and **object storage** to put the artefact in
 * (`FILE_STORAGE.put` rejects with 503 until M25, deliberately — ADR-019
 * §2: "a `put()` that resolved without writing would hand back a file id
 * for bytes that do not exist"). `report_exports` is the row ADR-010
 * group 15 scoped IN for exactly that artefact, and it stays empty until
 * there is an artefact to point at.
 *
 * So `excel` and `pdf` answer **501 `not_implemented`**, which is the
 * same status and the same reasoning M17.2 used for the eight
 * unimplemented analytics categories: the route exists and the format is
 * a real part of the contract. A 404 would deny the format is in the
 * API, a 422 would blame the client for asking, and a fabricated job id
 * would promise a file that never arrives.
 *
 * ## The CSV is the snapshot, not a second query path
 *
 * It serialises the same `AnalyticsSnapshotView` the JSON endpoint
 * returns. A separate query path would be a second place for the doctor
 * scope to be got right, and the first one to drift.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AnalyticsSnapshotView } from '../dto/analytics.dto';

export interface CsvExport {
  readonly filename: string;
  readonly content: string;
}

/** RFC 4180: quote when the value contains a delimiter, quote or newline. */
function cell(value: string | number): string {
  const text = String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class ReportExportService {
  /**
   * Refuses the asynchronous formats with 501 rather than a stub job.
   *
   * Built as a plain `AppException` with a module-owned code, the way
   * `analytics.service.ts` already raises its own 501 — `error-codes.ts`
   * leaves the domain codes to the modules that own them.
   */
  assertSynchronous(format: string): void {
    if (format === 'csv') return;

    throw new AppException(501, {
      message: `The \`${format}\` export format is not implemented yet. It needs the M30 job runner and M25 file storage.`,
      code: 'not_implemented',
    });
  }

  /**
   * A snapshot as CSV.
   *
   * One section per populated member, because a snapshot is not a table:
   * flattening eleven differently-shaped series into one grid would
   * produce a file with more empty cells than values. Sections are
   * separated by a blank line, which every spreadsheet reads as a new
   * block.
   */
  toCsv(snapshot: AnalyticsSnapshotView): CsvExport {
    const lines: string[] = [];

    lines.push(`Medora analytics export`);
    lines.push(`Category,${cell(snapshot.category)}`);
    lines.push(`From,${cell(snapshot.range.from)}`);
    lines.push(`To,${cell(snapshot.range.to)}`);
    lines.push('');

    if (snapshot.kpis.length > 0) {
      lines.push('KPIs');
      lines.push('Id,Label,Value,Format,Delta %');
      for (const kpi of snapshot.kpis) {
        lines.push(
          [kpi.id, kpi.label, kpi.value, kpi.format, kpi.deltaPercent].map(cell).join(','),
        );
      }
      lines.push('');
    }

    for (const series of snapshot.trend) {
      lines.push(`Trend — ${series.name}`);
      lines.push('Label,Value');
      for (const point of series.points) lines.push(`${cell(point.label)},${cell(point.value)}`);
      lines.push('');
    }

    const named = [
      ['Weekday', snapshot.weekday],
      ['Age distribution', snapshot.ageDistribution],
      ['Pharmacy', snapshot.pharmacy],
      ['Messages', snapshot.messages],
      ['AI usage', snapshot.aiUsage],
      ['Records', snapshot.records],
    ] as const;

    for (const [title, series] of named) {
      if (series.points.length === 0) continue;

      lines.push(title);
      lines.push('Label,Value');
      for (const point of series.points) lines.push(`${cell(point.label)},${cell(point.value)}`);
      lines.push('');
    }

    const sliced = [
      ['Departments', snapshot.departments],
      ['Lab status', snapshot.labStatus],
    ] as const;

    for (const [title, slices] of sliced) {
      if (slices.length === 0) continue;

      lines.push(title);
      lines.push('Label,Value');
      for (const slice of slices) lines.push(`${cell(slice.label)},${cell(slice.value)}`);
      lines.push('');
    }

    if (snapshot.heatmap.rows.length > 0) {
      lines.push('Activity heatmap');
      lines.push(['', ...snapshot.heatmap.columns].map(cell).join(','));
      snapshot.heatmap.rows.forEach((row, index) => {
        lines.push([row, ...(snapshot.heatmap.cells[index] ?? [])].map(cell).join(','));
      });
      lines.push('');
    }

    const day = snapshot.range.from.slice(0, 10);

    return {
      filename: `medora-${snapshot.category}-${day}.csv`,
      content: lines.join('\r\n'),
    };
  }
}
