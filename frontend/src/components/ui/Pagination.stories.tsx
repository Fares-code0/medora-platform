import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Pagination } from './Pagination';

/** DS §8.26. Page numbers with ellipses, page size, and the item range. */
function Controlled({ totalItems, disabled = false }: { totalItems: number; disabled?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      totalItems={totalItems}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      disabled={disabled}
    />
  );
}

const meta = {
  title: 'UI/Pagination',
  component: Pagination,
  args: { page: 1, pageSize: 10, totalItems: 240, onPageChange: () => {} },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManyPages: Story = { render: () => <Controlled totalItems={240} /> };
export const FewPages: Story = { render: () => <Controlled totalItems={25} /> };
export const SinglePage: Story = { render: () => <Controlled totalItems={4} /> };
export const Empty: Story = { render: () => <Controlled totalItems={0} /> };
export const Disabled: Story = { render: () => <Controlled totalItems={240} disabled /> };
