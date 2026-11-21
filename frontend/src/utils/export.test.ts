import { describe, expect, it } from 'vitest';

import { toCsv, toExcelHtml, type ExportDataset } from './export';

function dataset(rows: ExportDataset['rows'], columns = ['Name', 'Note']): ExportDataset {
  return { filename: 'f', title: 't', columns, rows };
}

const lines = (csv: string) => csv.split('\n');

describe('toCsv — formula-leading text arrives as text (CSV injection)', () => {
  it.each(['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'])(
    'prefixes %j with a single quote',
    (value) => {
      const [, row] = lines(toCsv(dataset([['Ana', value]])));
      expect(row?.split(',').slice(1).join(',').replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    },
  );

  it('still quotes a neutralised value that needs quoting', () => {
    const [, row] = lines(toCsv(dataset([['Ana', '=A1,"B"']])));
    expect(row).toBe(`Ana,"'=A1,""B"""`);
  });

  it('quotes a carriage return so it cannot start a record', () => {
    const [, row] = lines(toCsv(dataset([['Ana', 'line one\rline two']])));
    expect(row).toBe('Ana,"line one\rline two"');
  });

  it('leaves numbers numeric, negative ones included', () => {
    const [, row] = lines(toCsv(dataset([[-4.5, 120]], ['Delta', 'Systolic'])));
    expect(row).toBe('-4.5,120');
  });

  it('leaves ordinary text and a value with a later minus sign unchanged', () => {
    const [header, row] = lines(toCsv(dataset([['Ana Silva', 'BP 120-80']])));
    expect(header).toBe('Name,Note');
    expect(row).toBe('Ana Silva,BP 120-80');
  });

  it('neutralises a header too', () => {
    const [header] = lines(toCsv(dataset([], ['=cmd', 'Note'])));
    expect(header).toBe("'=cmd,Note");
  });
});

describe('toExcelHtml — the .xls export guards formula text too', () => {
  it.each(['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1'])(
    'prefixes %j with a single quote inside its cell',
    (value) => {
      const html = toExcelHtml(dataset([['Ana', value]]));
      const cells = [...html.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]);
      expect(cells[1]?.startsWith("'")).toBe(true);
    },
  );

  it('still escapes HTML after neutralising', () => {
    const html = toExcelHtml(dataset([['Ana', '=<img src=x onerror=alert(1)>']]));
    expect(html).toContain("<td>'=&lt;img src=x onerror=alert(1)&gt;</td>");
    expect(html).not.toContain('<img');
  });

  it('leaves numbers and ordinary text alone, and guards headers', () => {
    const html = toExcelHtml(dataset([[-4.5, 'BP 120-80']], ['=cmd', 'Note']));
    expect(html).toContain('<th>&#39;=cmd</th>'.replace('&#39;', "'"));
    expect(html).toContain('<td>-4.5</td><td>BP 120-80</td>');
  });
});
