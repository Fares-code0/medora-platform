import { describe, expect, it } from 'vitest';

import { clampPage, pageCount, pageSlice } from './pagination';

const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('pageCount', () => {
  it('is 1 for an empty list', () => {
    expect(pageCount(0, 10)).toBe(1);
  });

  it.each([10, 20, 50, 100])('fits exactly %i rows on one page of that size', (size) => {
    expect(pageCount(size, size)).toBe(1);
    expect(pageCount(size + 1, size)).toBe(2);
  });

  it('counts past 100', () => {
    expect(pageCount(250, 100)).toBe(3);
    expect(pageCount(250, 10)).toBe(25);
  });
});

describe('clampPage', () => {
  it('keeps an in-range page', () => {
    expect(clampPage(2, 25, 10)).toBe(2);
  });

  it('pulls a page past the end back to the last page', () => {
    expect(clampPage(9, 25, 10)).toBe(3);
  });

  it('never goes below page 1', () => {
    expect(clampPage(0, 25, 10)).toBe(1);
    expect(clampPage(4, 0, 10)).toBe(1);
  });
});

describe('pageSlice', () => {
  it('returns the requested page', () => {
    expect(pageSlice(rows(25), 2, 10)).toEqual(rows(20).slice(10));
  });

  it('returns a short last page', () => {
    expect(pageSlice(rows(25), 3, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('returns the last page, not nothing, for a page past the end', () => {
    expect(pageSlice(rows(25), 9, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('returns every row when they fit on one page', () => {
    expect(pageSlice(rows(100), 1, 100)).toHaveLength(100);
  });

  it('returns nothing for an empty list', () => {
    expect(pageSlice([], 1, 10)).toEqual([]);
  });
});
