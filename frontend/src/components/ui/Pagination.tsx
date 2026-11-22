import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PAGE_SIZES } from '@/constants';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';
import { clampPage, pageCount as countPages } from '@/utils/pagination';

import { IconButton } from './IconButton';
import { Select } from './Select';

/**
 * Pagination — DS §8.26.
 * "Showing 1–10 of 312" left; "Rows per page", prev/next + page numbers
 * right (36px ghost buttons, current = primary-subtle + aria-current). Prev
 * is disabled on the first page and Next on the last — never hidden. Mobile
 * shows prev/next + "Page 3 of 13". Infinite scroll is prohibited on
 * clinical data tables.
 */
export interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((size: number) => void) | undefined;
  pageSizeOptions?: readonly number[];
  disabled?: boolean;
  className?: string;
}

type PageToken = number | 'ellipsis-start' | 'ellipsis-end';

function pageTokens(current: number, count: number): readonly PageToken[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const middle = [current - 1, current, current + 1].filter((p) => p > 1 && p < count);
  const tokens: PageToken[] = [1];
  if ((middle[0] ?? count) > 2) tokens.push('ellipsis-start');
  tokens.push(...middle);
  if ((middle[middle.length - 1] ?? 0) < count - 1) tokens.push('ellipsis-end');
  tokens.push(count);
  return tokens;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZES,
  disabled = false,
  className,
}: PaginationProps) {
  const pageCount = countPages(totalItems, pageSize);
  const t = useT();
  const clampedPage = clampPage(page, totalItems, pageSize);
  const rangeStart = totalItems === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(clampedPage * pageSize, totalItems);

  return (
    <nav
      aria-label={t('ui.pagination')}
      className={cn('flex flex-wrap items-center justify-between gap-4', className)}
    >
      <p className="text-body-sm text-text-secondary tabular-nums">
        Showing {rangeStart}–{rangeEnd} of {totalItems}
      </p>
      {/* Wraps on a 320px phone, where the rows-per-page group and the
          page controls together are wider than the row. */}
      <div className="flex max-w-full flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          /*
           * The visible words and the control's accessible name are the same
           * string, so a speech-input user can say what they see (WCAG 2.5.3).
           * The text itself is hidden from assistive tech only because the
           * combobox already announces it — reading it twice adds nothing.
           */
          <div className="flex items-center gap-2 me-2">
            <span aria-hidden="true" className="whitespace-nowrap text-body-sm text-text-secondary">
              {t('ui.rowsPerPage')}
            </span>
            <Select
              aria-label={t('ui.rowsPerPage')}
              options={pageSizeOptions.map((size) => ({
                value: String(size),
                label: String(size),
              }))}
              value={String(pageSize)}
              onChange={(value) => onPageSizeChange(Number(value))}
              disabled={disabled}
              containerClassName="w-24"
            />
          </div>
        ) : null}
        <IconButton
          icon={ChevronLeft}
          aria-label={t('ui.previousPage')}
          disabled={disabled || clampedPage <= 1}
          onClick={() => onPageChange(clampedPage - 1)}
          size="sm"
        />
        <span className="text-body-sm text-text-secondary tabular-nums sm:hidden">
          Page {clampedPage} of {pageCount}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageTokens(clampedPage, pageCount).map((token) =>
            typeof token === 'number' ? (
              <button
                key={token}
                type="button"
                disabled={disabled}
                aria-label={`Page ${String(token)}`}
                aria-current={token === clampedPage ? 'page' : undefined}
                onClick={() => onPageChange(token)}
                className={cn(
                  'touch-target inline-flex h-9 w-9 items-center justify-center rounded-surface text-body-sm font-medium tabular-nums [--touch-x:4px] [--touch-y:4px]',
                  'transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:text-text-disabled',
                  token === clampedPage
                    ? 'bg-primary-subtle text-primary'
                    : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                )}
              >
                {token}
              </button>
            ) : (
              <span key={token} aria-hidden="true" className="px-1 text-body-sm text-text-tertiary">
                …
              </span>
            ),
          )}
        </div>
        <IconButton
          icon={ChevronRight}
          aria-label={t('ui.nextPage')}
          disabled={disabled || clampedPage >= pageCount}
          onClick={() => onPageChange(clampedPage + 1)}
          size="sm"
        />
      </div>
    </nav>
  );
}
