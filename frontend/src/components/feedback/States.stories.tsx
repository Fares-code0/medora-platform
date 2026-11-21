import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlaskConical } from 'lucide-react';

import { Button } from '../ui/Button';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

/**
 * The loading / empty / error trio (DS §8.31–8.33) in one place, because
 * they are chosen against each other: the question a reviewer is really
 * asking is "does this screen use the right one", and that is easier to see
 * when all three are side by side than in three separate stories.
 */

/*
 * Title kept free of middots: Storybook derives the story id from it, and
 * `feedback-loading-·-empty-·-error--all-three` is an id no one can type or
 * link to reliably.
 */
const meta = { title: 'Feedback/States' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllThree: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="rounded-surface border border-border p-4">
        <p className="mb-3 text-caption text-text-secondary">Loading</p>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-1/2" />
          <div className="pt-2">
            <Spinner />
          </div>
        </div>
      </div>
      <div className="rounded-surface border border-border p-4">
        <p className="mb-3 text-caption text-text-secondary">Empty</p>
        <EmptyState
          icon={FlaskConical}
          title="No lab work on record"
          description="Nothing has been ordered for this patient yet."
          action={<Button size="sm">Order a test</Button>}
        />
      </div>
      <div className="rounded-surface border border-border p-4">
        <p className="mb-3 text-caption text-text-secondary">Error</p>
        <ErrorState
          title="Lab results could not be loaded"
          description="The laboratory record for this patient is unavailable."
          onRetry={() => undefined}
        />
      </div>
    </div>
  ),
};
