import { act, fireEvent } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { ar, en } from '@/i18n/messages';
import { renderWithProviders } from '@/test/render';

import { Chip } from './Chip';
import { ConfirmSheet } from './ConfirmSheet';
import { Skeleton } from './feedback/Skeleton';

/**
 * The primitives' *states* — checklist C-05, C-06, R-06, S-06.
 *
 * `components.test.tsx` covers what each primitive renders. These are the
 * branches it does not reach: the selected/disabled/pressed combinations
 * that decide a chip's colours, the confirm sheet's two outcomes, and the
 * skeleton's reduced-motion path.
 *
 * They matter for a reason that is not coverage. Every one of these
 * branches is a **visual** decision expressed as a condition, so the
 * usual failure is not a crash — it is a disabled chip that still looks
 * pressable, or a destructive confirmation whose two buttons are the same
 * colour. In a tree where the design system is the only thing standing
 * between eight screens and eight different-looking buttons, that is
 * worth an assertion.
 */

describe('Chip states (C-05)', () => {
  it('reports selection to assistive technology, not only in colour', () => {
    // WCAG 1.4.1: colour is never the only carrier. A screen-reader user
    // has no colour at all.
    const selected = renderWithProviders(
      <Chip testID="chip" label="Cardiology" selected onPress={jest.fn()} />,
    );
    expect(selected.getByTestId('chip').props.accessibilityState).toMatchObject({
      selected: true,
    });
    selected.unmount();

    const unselected = renderWithProviders(
      <Chip testID="chip" label="Cardiology" onPress={jest.fn()} />,
    );
    expect(unselected.getByTestId('chip').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('does not fire while disabled, and says it is disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithProviders(
      <Chip testID="chip" label="Cardiology" disabled onPress={onPress} />,
    );

    fireEvent.press(getByTestId('chip'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('chip').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('draws disabled differently from selected, which is the pair most easily confused', () => {
    // Both are "not the default", and a chip that reads as selected when
    // it is unavailable is a filter the patient thinks they applied.
    const disabled = renderWithProviders(
      <Chip testID="a" label="Cardiology" disabled onPress={jest.fn()} />,
    );
    const selected = renderWithProviders(
      <Chip testID="b" label="Cardiology" selected onPress={jest.fn()} />,
    );

    const style = (view: ReturnType<typeof renderWithProviders>, id: string) =>
      JSON.stringify(view.getByTestId(id).props.style);

    expect(style(disabled, 'a')).not.toBe(style(selected, 'b'));
  });

  it('clears a hit target larger than it draws', () => {
    // A pill chip is under 44dp tall by design; `hitSlop` is what keeps
    // the touch target at the S-01 floor without inflating the row.
    const { getByTestId } = renderWithProviders(
      <Chip testID="chip" label="Cardiology" onPress={jest.fn()} />,
    );

    expect(getByTestId('chip').props.hitSlop).toMatchObject({ top: 8, bottom: 8 });
  });
});

describe('ConfirmSheet is the gate in front of anything irreversible (R-06)', () => {
  function renderSheet(overrides: Partial<Parameters<typeof ConfirmSheet>[0]> = {}) {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const view = renderWithProviders(
      <ConfirmSheet
        testID="sheet"
        visible
        title="Cancel this appointment?"
        detail="The clinic will be told."
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />,
    );
    return { ...view, onConfirm, onCancel };
  }

  it('offers both outcomes, and calls only the one pressed', () => {
    const view = renderSheet();

    fireEvent.press(view.getByTestId('sheet-confirm'));

    expect(view.onConfirm).toHaveBeenCalledTimes(1);
    expect(view.onCancel).not.toHaveBeenCalled();
  });

  it('cancels without confirming', () => {
    const view = renderSheet();

    fireEvent.press(view.getByTestId('sheet-cancel'));

    expect(view.onCancel).toHaveBeenCalledTimes(1);
    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing while it is not visible', () => {
    const view = renderSheet({ visible: false });

    expect(view.queryByTestId('sheet-confirm')).toBeNull();
  });

  it('takes its confirm label from the caller, so the button names the action', () => {
    // "Confirm" tells a patient nothing about what they are confirming;
    // "Cancel appointment" does. The same rule the emergency sheet
    // follows by naming the number.
    const view = renderSheet();

    expect(view.getByText('Cancel appointment')).toBeTruthy();
    expect(view.getByText('Keep it')).toBeTruthy();
  });

  it('falls back to the catalogue for cancel, in whichever language is set', () => {
    // The default was the English literal `'Cancel'` until 2026-09-13,
    // and a default is the worst place for one: it reaches every caller
    // that did the ordinary thing and it is invisible until a patient
    // opens the sheet. Two of them — closing an account and signing out
    // — read Arabic above an English Cancel.
    const english = renderWithProviders(
      <ConfirmSheet
        testID="sheet"
        visible
        title="Sign out?"
        detail="You will need to sign in again."
        confirmLabel="Sign out"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(english.getByText(en['action.cancel'])).toBeTruthy();

    const arabic = renderWithProviders(
      <ConfirmSheet
        testID="sheet"
        visible
        title="Sign out?"
        detail="You will need to sign in again."
        confirmLabel="Sign out"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
      { locale: 'ar' },
    );
    expect(arabic.getByText(ar['action.cancel'])).toBeTruthy();
    expect(arabic.queryByText(en['action.cancel'])).toBeNull();
  });

  it('carries no testID on its buttons when it was given none', () => {
    const view = renderWithProviders(
      <ConfirmSheet
        visible
        title="Sign out?"
        detail="You will need to sign in again."
        confirmLabel="Sign out"
        cancelLabel="Stay"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(view.queryByTestId('undefined-confirm')).toBeNull();
    expect(view.getByText('Sign out')).toBeTruthy();
  });
});

describe('Skeleton honours reduced motion (S-06, C-10)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise<boolean>(() => undefined));
  });

  /**
   * `Skeleton` takes no `testID` — only the composite `SkeletonCard` and
   * `SkeletonList` do, because those are what a screen waits on. So the
   * rendered node is read directly rather than adding a prop to the
   * source for a test's convenience.
   */
  interface JsonNode {
    readonly props: Record<string, unknown>;
    readonly children?: (JsonNode | string)[] | null;
  }

  /** The deepest node in the render — the placeholder itself. */
  function deepest(node: JsonNode | string | null): JsonNode {
    if (node === null || typeof node === 'string') throw new Error('nothing rendered');
    const child = node.children?.find((entry) => typeof entry !== 'string');
    return child === undefined ? node : deepest(child);
  }

  async function renderBone(props: Parameters<typeof Skeleton>[0] = {}) {
    const view = renderWithProviders(<Skeleton {...props} />);
    await act(async () => undefined);
    // `toJSON()` returns the provider wrapper this helper mounts, so the
    // placeholder is found rather than assumed to be the root.
    return deepest(view.toJSON());
  }

  it('starts no animation loop when motion is reduced', async () => {
    // A loading placeholder that pulses is motion nobody asked for, on a
    // screen the patient is waiting at rather than reading. Asserted on
    // `Animated.loop` rather than on the rendered opacity: under the
    // test renderer the driver never ticks, so both paths serialise to
    // the same value and only the decision is observable.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loop = jest.spyOn(Animated, 'loop');

    const bone = await renderBone();

    expect(loop).not.toHaveBeenCalled();
    // It settles at a fixed opacity instead, so the placeholder is still
    // visible as a placeholder.
    expect(JSON.stringify(bone.props['style'])).toContain('opacity');
  });

  it('starts one when motion is allowed', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const loop = jest.spyOn(Animated, 'loop');

    await renderBone();

    expect(loop).toHaveBeenCalledTimes(1);
  });

  it('is hidden from assistive technology either way', async () => {
    // It carries no information a sighted user gets — the announcement a
    // screen-reader user needs is the loading state's own live region,
    // not eight rectangles.
    const bone = await renderBone();

    expect(bone.props['accessibilityElementsHidden']).toBe(true);
    expect(bone.props['importantForAccessibility']).toBe('no-hide-descendants');
    expect(bone.props['accessible']).toBe(false);
  });

  it('takes a percentage width, which is what a text placeholder needs', async () => {
    const bone = await renderBone({ width: '60%', height: 12 });

    expect(JSON.stringify(bone.props['style'])).toContain('60%');
  });
});
