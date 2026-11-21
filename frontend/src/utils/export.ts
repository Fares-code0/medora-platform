/**
 * Export engine — real, dependency-free exporters used by every "Export"
 * action in the app. CSV and Excel produce genuine files; PDF is a minimal
 * hand-rolled PDF (valid Helvetica text pages, no library); Print renders the
 * dataset into an isolated iframe and opens the browser print dialog. One
 * shared implementation so no export is a fake dialog.
 */

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'print';

export interface ExportDataset {
  /** File base name (no extension), e.g. "medora-patients". */
  readonly filename: string;
  /** Document title, shown in PDF/Print output. */
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

/* ── Download helper ────────────────────────────────────────────── */

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cell(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

/* ── CSV ────────────────────────────────────────────────────────── */

/**
 * Text that a spreadsheet would read as a formula (OWASP "CSV injection").
 *
 * Quoting stops a value from splitting a row; it does not stop Excel,
 * LibreOffice or Sheets from *evaluating* a cell that begins with `=`, `+`,
 * `-` or `@` (or a tab or carriage return ahead of one). Every export here
 * carries free text someone else typed (a name, a chief complaint, an
 * indication) and is opened by a clinician on a workstation with PHI on it,
 * so `=HYPERLINK(…)` in a chart field must arrive as text. A leading single
 * quote is what every mainstream spreadsheet reads as "this is text" — the
 * same rule as the server's `common/http/csv-export.ts`, so a client export
 * and a server export of one list agree. Numbers are written as numbers and
 * never prefixed, so a negative value stays numeric.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function neutralised(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvCell(value: string | number): string {
  return typeof value === 'number' ? String(value) : csvField(neutralised(value));
}

export function toCsv(data: ExportDataset): string {
  const header = data.columns.map((column) => csvField(neutralised(column))).join(',');
  const body = data.rows.map((row) => row.map(csvCell).join(',')).join('\n');
  return `${header}\n${body}`;
}

const UTF8_BOM = String.fromCharCode(0xfeff);

export function exportCsv(data: ExportDataset): void {
  // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
  const blob = new Blob([UTF8_BOM + toCsv(data)], { type: 'text/csv;charset=utf-8' });
  download(blob, `${data.filename}.csv`);
}

/* ── JSON ───────────────────────────────────────────────────────── */

/**
 * The dataset as an array of objects keyed by column name.
 *
 * Row-oriented rather than the `{ columns, rows }` shape held here, because
 * the consumer of a JSON export is a script or a spreadsheet importer, and
 * both read `[{ Timestamp: …, Actor: … }]` without being told the header
 * separately. A short row yields `null` for the missing columns rather than
 * `undefined`, so the key survives `JSON.stringify`.
 */
export function toJson(data: ExportDataset): string {
  const objects = data.rows.map((row) =>
    Object.fromEntries(data.columns.map((column, index) => [column, row[index] ?? null])),
  );
  return JSON.stringify(objects, null, 2);
}

export function exportJson(data: ExportDataset): void {
  const blob = new Blob([toJson(data)], { type: 'application/json;charset=utf-8' });
  download(blob, `${data.filename}.json`);
}

/* ── Excel (.xls, Excel-readable HTML table) ────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A text cell as the spreadsheet will hold it. The `.xls` export is an HTML
 * table, and a spreadsheet importing one evaluates a cell that begins with a
 * formula character exactly as it does from a CSV — measured: LibreOffice
 * turned `=HYPERLINK(…)` in a patient's name into a live formula. Excel's
 * `mso-number-format` text hint is ignored by LibreOffice, so the guard is the
 * CSV's: the same leading single quote (`neutralised`). Numbers stay numbers.
 */
function excelCell(value: string | number): string {
  return escapeHtml(typeof value === 'number' ? String(value) : neutralised(value));
}

export function toExcelHtml(data: ExportDataset): string {
  const head = data.columns.map((c) => `<th>${excelCell(c)}</th>`).join('');
  const body = data.rows
    .map((row) => `<tr>${row.map((v) => `<td>${excelCell(v)}</td>`).join('')}</tr>`)
    .join('');
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>` +
    `<x:ExcelWorksheet><x:Name>${escapeHtml(data.title)}</x:Name><x:WorksheetOptions>` +
    `<x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets>` +
    `</x:ExcelWorkbook></xml><![endif]--></head><body>` +
    `<table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
  );
}

export function exportExcel(data: ExportDataset): void {
  const blob = new Blob([toExcelHtml(data)], { type: 'application/vnd.ms-excel' });
  download(blob, `${data.filename}.xls`);
}

/* ── PDF (minimal, hand-rolled) ─────────────────────────────────── */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT) - 2;
const MAX_CHARS = 95;

function pdfText(value: string): string {
  // Helvetica is Latin-1; drop the rest, escape PDF string delimiters.
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, MAX_CHARS);
}

function toLines(data: ExportDataset): string[] {
  const lines: string[] = [data.title, ''];
  lines.push(data.columns.join('  |  '));
  lines.push('-'.repeat(MAX_CHARS));
  for (const row of data.rows) lines.push(row.map(cell).join('  |  '));
  return lines;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildPdf(data: ExportDataset): Blob {
  const pages = chunk(toLines(data), LINES_PER_PAGE);
  if (pages.length === 0) pages.push([data.title]);

  const objects: string[] = [];
  // 1: catalog, 2: pages, 3: font — page/content objects follow.
  const pageObjNums = pages.map((_, i) => 4 + i * 2);
  const kids = pageObjNums.map((n) => `${String(n)} 0 R`).join(' ');

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((lines, i) => {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    const startY = PAGE_HEIGHT - MARGIN;
    const stream =
      `BT /F1 ${String(FONT_SIZE)} Tf ${String(MARGIN)} ${String(startY)} Td ${String(LINE_HEIGHT)} TL\n` +
      lines.map((line, idx) => `${idx === 0 ? '' : 'T* '}(${pdfText(line)}) Tj`).join('\n') +
      `\nET`;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
      `/Contents ${String(contentNum)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentNum] = `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`;
  });

  // Assemble with a correct xref table.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n += 1) {
    const obj = objects[n];
    if (obj === undefined) continue;
    offsets[n] = body.length;
    body += `${String(n)} 0 obj\n${obj}\nendobj\n`;
  }
  const xrefStart = body.length;
  const count = objects.length; // includes index 0 (free)
  let xref = `xref\n0 ${String(count)}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n += 1) {
    const off = offsets[n] ?? 0;
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${String(count)} /Root 1 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF`;

  return new Blob([body + xref + trailer], { type: 'application/pdf' });
}

export function exportPdf(data: ExportDataset): void {
  download(buildPdf(data), `${data.filename}.pdf`);
}

/** Open the dataset as a PDF in a new tab ("View" actions on documents). */
export function openPdfPreview(data: ExportDataset): void {
  const url = URL.createObjectURL(buildPdf(data));
  window.open(url, '_blank', 'noopener');
  // Give the tab time to load the blob before releasing the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ── Print ──────────────────────────────────────────────────────── */

export function printDataset(data: ExportDataset): void {
  const head = data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const rows = data.rows
    .map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(cell(v))}</td>`).join('')}</tr>`)
    .join('');
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title>` +
    `<style>body{font-family:Arial,Helvetica,sans-serif;color:#202832;margin:24px}` +
    `h1{font-size:18px;margin:0 0 12px}table{border-collapse:collapse;width:100%;font-size:12px}` +
    `th,td{border:1px solid #a5afba;padding:6px 8px;text-align:left}` +
    `thead{background:#f1f5f8}</style></head><body>` +
    `<h1>${escapeHtml(data.title)}</h1>` +
    `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></body></html>`;

  const iframe = window.document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  window.document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow;
  if (win) {
    win.focus();
    win.print();
  }
  // Give the print dialog time to read the document before teardown.
  window.setTimeout(() => iframe.remove(), 1000);
}

/* ── Dispatcher ─────────────────────────────────────────────────── */

export function runExport(format: ExportFormat, data: ExportDataset): void {
  switch (format) {
    case 'csv':
      exportCsv(data);
      break;
    case 'excel':
      exportExcel(data);
      break;
    case 'pdf':
      exportPdf(data);
      break;
    case 'print':
      printDataset(data);
      break;
  }
}
