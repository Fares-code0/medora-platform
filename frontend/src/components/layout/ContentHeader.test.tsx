import { render, screen, within } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ContentHeader } from './ContentHeader';

/**
 * Every page keeps a visible identity — its icon chip and its h1, on one row
 * with the page actions — while the tagline caption under the title is gone
 * unless a page opts in with `showCaption` because the line is information
 * (a detail page's patient, a settings page's scope).
 */
describe('ContentHeader — compact visible page identity', () => {
  it('shows one visible h1 and the module icon, but not a tagline caption', () => {
    const { container } = render(
      <ContentHeader
        title="Notifications"
        caption="Clinical alerts, reminders and team updates."
        icon={Bell}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Notifications');
    expect(headings[0]).not.toHaveClass('sr-only');
    expect(container.querySelector('header')).not.toHaveClass('sr-only');
    expect(screen.getByTestId('content-header-icon')).toBeInTheDocument();
    expect(screen.queryByText('Clinical alerts, reminders and team updates.')).toBeNull();
  });

  it('shows the caption when the page says it is information', () => {
    render(
      <ContentHeader
        title="LAB-1042"
        caption="Lipid panel · Chemistry · Nov 2, 2026 · Amina Haddad"
        showCaption
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'LAB-1042' })).toBeVisible();
    expect(
      screen.getByText('Lipid panel · Chemistry · Nov 2, 2026 · Amina Haddad'),
    ).toBeInTheDocument();
  });

  it('keeps the breadcrumb above, and the actions on the title row', () => {
    const { container } = render(
      <ContentHeader
        title="Appointments"
        breadcrumb={<nav aria-label="Breadcrumb">Overview / Appointments</nav>}
        actions={<button type="button">New appointment</button>}
      />,
    );

    const header = container.querySelector('header')!;
    expect(within(header).getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    const action = within(header).getByRole('button', { name: 'New appointment' });
    const title = within(header).getByRole('heading', { level: 1, name: 'Appointments' });
    // The title block and the actions are siblings in the same row.
    const row = action.parentElement!.parentElement!;
    expect(row).toContainElement(title);
    expect(row).toHaveClass('flex-wrap');
  });

  it('treats null, false and empty actions as none', () => {
    const { container } = render(<ContentHeader title="Reports" actions={false} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
  });
});
