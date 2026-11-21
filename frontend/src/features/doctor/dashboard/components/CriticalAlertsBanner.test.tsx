import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CriticalAlert } from '../model/critical-alerts';

import { CriticalAlertsBanner } from './CriticalAlertsBanner';

/**
 * Row 0 (UX §2.1). What it must never do is say nothing when it could not
 * check, or let a doctor put it away.
 */

const LAB: CriticalAlert = {
  id: 'lab-LAB-1',
  kind: 'unreviewed-critical-lab',
  patientName: 'Khaled Nassar',
  message: 'Potassium — critical value awaiting review',
  detail: 'Ordered 3 h ago',
  href: '/doctor/labs/LAB-1',
};

const CONFLICT: CriticalAlert = {
  id: 'alert-1',
  kind: 'allergy-conflict',
  patientName: 'Mona Adel',
  message: 'Penicillin allergy — amoxicillin ordered',
  detail: null,
  href: '/doctor/appointments',
};

function renderBanner(props: Partial<Parameters<typeof CriticalAlertsBanner>[0]> = {}) {
  const onRetry = vi.fn();
  const view = render(
    <CriticalAlertsBanner
      alerts={[]}
      failed={false}
      retrying={false}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { ...view, onRetry };
}

describe('CriticalAlertsBanner', () => {
  it('renders nothing when the check succeeded and found nothing', () => {
    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists each alert with its patient, summary and one resolving action', () => {
    renderBanner({ alerts: [LAB, CONFLICT] });

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('2 critical alerts need your attention')).toBeInTheDocument();
    const rows = within(banner).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Khaled Nassar — Potassium — critical value awaiting review');
    expect(rows[0]).toHaveTextContent('Ordered 3 h ago');

    const review = within(rows[0]!).getByRole('link', {
      name: 'Review result — Khaled Nassar: Potassium — critical value awaiting review',
    });
    expect(review).toHaveAttribute('href', '/doctor/labs/LAB-1');
    expect(review).toHaveTextContent('Review result');
    expect(
      within(rows[1]!).getByRole('link', { name: /^Open today's appointments — Mona Adel/ }),
    ).toHaveAttribute('href', '/doctor/appointments');
  });

  it('says one alert in the singular', () => {
    renderBanner({ alerts: [LAB] });

    expect(screen.getByText('1 critical alert needs your attention')).toBeInTheDocument();
  });

  it('cannot be dismissed', () => {
    renderBanner({ alerts: [LAB], failed: true });

    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('says it could not check, as an alert, and offers to check again', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderBanner({ failed: true });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent("Couldn't check for critical alerts");
    await user.click(within(banner).getByRole('button', { name: 'Check again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the last alerts it knew beneath a failed re-check', () => {
    renderBanner({ alerts: [LAB], failed: true });

    const banners = screen.getAllByRole('alert');
    expect(banners).toHaveLength(2);
    expect(banners[0]).toHaveTextContent("Couldn't check for critical alerts");
    expect(banners[1]).toHaveTextContent('Khaled Nassar');
  });
});
