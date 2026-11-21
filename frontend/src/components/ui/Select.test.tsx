import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { isolateLtr } from '@/i18n';

import { Select } from './Select';

/**
 * The field/control seam — the bug behind the admin toolbars.
 *
 * Every text field renders through `FieldWrapper`, which is `w-full`.
 * `className` styles the CONTROL; `containerClassName` styles the FIELD. 35
 * call sites had passed a width on `className`, which produces a full-width
 * field holding a narrow trigger. Two things go wrong, and both read as a
 * spacing mistake rather than a wiring one:
 *
 *  - in a flex toolbar every filter claims a row of its own, because each
 *    field is still 100% wide;
 *  - the chevron is absolutely positioned, and used to anchor to the wrapper
 *    rather than the trigger, so it landed at the far right of that
 *    full-width row, yards from the control it belongs to.
 *
 * `scripts/check-retired-tokens.mjs` fails the build on the call-site half.
 * These assert the component half it relies on.
 */

const OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return render(
    <Select
      options={OPTIONS}
      value="all"
      onChange={() => undefined}
      aria-label="Filter by status"
      {...props}
    />,
  );
}

describe('Select field sizing', () => {
  it('puts containerClassName on the field, not on the trigger', () => {
    const { container } = renderSelect({ containerClassName: 'sm:w-44' });

    const field = container.firstElementChild;
    expect(field).toHaveClass('sm:w-44');
    expect(screen.getByRole('combobox')).not.toHaveClass('sm:w-44');
  });

  it('puts className on the trigger, not on the field', () => {
    const { container } = renderSelect({ className: 'font-mono' });

    expect(screen.getByRole('combobox')).toHaveClass('font-mono');
    expect(container.firstElementChild).not.toHaveClass('font-mono');
  });

  /**
   * The chevron is `absolute`, so it lands on whichever ancestor establishes
   * the containing block. That has to be the trigger itself — the field
   * around it can be wider, and then the icon detaches from the control.
   */
  it('anchors the chevron to the trigger', () => {
    renderSelect();

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveClass('relative');

    const chevron = trigger.querySelector('svg');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveClass('absolute');
  });
});

describe('Select typeahead', () => {
  it('matches a label that is LTR-isolated, as if the controls were not there', async () => {
    /*
     * "30 min" is isolated so an RTL page does not show "min 30" (NEW-32).
     * The isolate controls are invisible and never typed, so typing "3"
     * must still land on it.
     */
    const onChange = vi.fn();
    render(
      <Select
        options={[
          { value: '15', label: isolateLtr('15 min') },
          { value: '30', label: isolateLtr('30 min') },
        ]}
        value="15"
        onChange={onChange}
        aria-label="Duration"
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Duration' }));
    await userEvent.keyboard('3');
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('30');
  });
});
