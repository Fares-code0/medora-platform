import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import { Pagination } from './Pagination';

function renderPagination(props: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  render(
    <Pagination
      page={1}
      pageSize={DEFAULT_PAGE_SIZE}
      totalItems={35}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />,
  );
  return { onPageChange, onPageSizeChange };
}

describe('the worklist page-size standard', () => {
  it('opens on ten rows, with 20, 50 and 100 on offer and no unbounded option', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10);
    expect(PAGE_SIZES).toEqual([10, 20, 50, 100]);
  });
});

describe('Pagination', () => {
  it('labels the page-size control "Rows per page" and shows the current size', () => {
    renderPagination();

    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(select).toHaveTextContent('10');
    expect(screen.getByText('Rows per page')).toBeVisible();
  });

  it('offers every page size and reports the one chosen', async () => {
    const { onPageSizeChange } = renderPagination();

    await userEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['10', '20', '50', '100']);

    await userEvent.click(within(listbox).getByRole('option', { name: '50' }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('disables Previous on the first page and Next on the last', () => {
    renderPagination({ page: 1, totalItems: 35 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    renderPagination({ page: 4, totalItems: 35 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('marks the current page and names every page button', () => {
    renderPagination({ page: 2, totalItems: 35 });

    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Page 1' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Page 4' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 5' })).not.toBeInTheDocument();
  });

  it('moves one page at a time from Previous and Next', async () => {
    const { onPageChange } = renderPagination({ page: 2, totalItems: 35 });

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it.each([10, 20, 50, 100])('fits exactly %i rows on a single page of that size', (size) => {
    renderPagination({ pageSize: size, totalItems: size });

    expect(screen.getByText(`Showing 1–${String(size)} of ${String(size)}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Page 2' })).not.toBeInTheDocument();
  });

  it('pages a list longer than 100 rows at the largest size', () => {
    renderPagination({ page: 3, pageSize: 100, totalItems: 250 });

    expect(screen.getByText('Showing 201–250 of 250')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reads an empty list as one empty page with nowhere to go', () => {
    renderPagination({ totalItems: 0 });

    expect(screen.getByText('Showing 0–0 of 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('treats a page past the end as the last page', () => {
    renderPagination({ page: 9, totalItems: 35 });

    expect(screen.getByText('Showing 31–35 of 35')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 4' })).toHaveAttribute('aria-current', 'page');
  });
});
