import { fireEvent, renderHook, waitFor } from '@testing-library/react-native';
import { StyleSheet, type TextInputInstance } from 'react-native';

import { Input } from '@/components';
import { ChangePasswordForm } from '@/features/auth/components/ChangePasswordForm';
import { authService } from '@/features/auth/service';
import { renderWithProviders } from '@/test/render';

import { useFieldChain } from './useFieldChain';

/**
 * Focus order — checklist S-05.
 *
 * Two things are asserted here, and the second is a bug this row
 * uncovered rather than a feature it added: the Return key has to move
 * focus to the next field and submit on the last, and a field that has
 * been left must stop drawing a focus ring.
 */

/** A stand-in for the native input: only `focus` is ever called on it. */
function fakeNode() {
  return { focus: jest.fn() } as unknown as TextInputInstance;
}

describe('the Return key walks the form (S-05)', () => {
  it('offers Next on every field but the last, and Done on the last', () => {
    const { result } = renderHook(() => useFieldChain({ length: 3 }));

    expect(result.current.field(0).returnKeyType).toBe('next');
    expect(result.current.field(1).returnKeyType).toBe('next');
    expect(result.current.field(2).returnKeyType).toBe('done');
  });

  it('keeps the keyboard up between fields and lets it go on the last', () => {
    // Without `submit` on the intermediate fields every Next closes and
    // reopens the keyboard, and the form jumps under the patient's thumb.
    const { result } = renderHook(() => useFieldChain({ length: 2 }));

    expect(result.current.field(0).submitBehavior).toBe('submit');
    expect(result.current.field(1).submitBehavior).toBe('blurAndSubmit');
  });

  it('moves focus to the next field', () => {
    const { result } = renderHook(() => useFieldChain({ length: 2 }));
    const second = fakeNode();
    result.current.field(1).inputRef(second);

    result.current.field(0).onSubmitEditing();

    expect(second.focus).toHaveBeenCalled();
  });

  it('submits from the last field rather than moving focus off the end', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useFieldChain({ length: 2, onSubmit }));

    result.current.field(1).onSubmitEditing();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits rather than swallowing the key when the next field is not mounted', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useFieldChain({ length: 2, onSubmit }));

    // Nothing registered at index 1 — a conditionally rendered row.
    result.current.field(0).onSubmitEditing();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('the focus ring follows focus (S-05)', () => {
  /**
   * The ring is drawn by the container around the input, so this climbs
   * out of the `TextInput` to the first ancestor that draws a border.
   */
  function ringWidth(screen: ReturnType<typeof renderWithProviders>): number | undefined {
    let node = screen.getByTestId('probe').parent;
    while (node !== null) {
      const style = StyleSheet.flatten(node.props.style) as { borderWidth?: number } | undefined;
      if (style?.borderWidth !== undefined) return style.borderWidth;
      node = node.parent;
    }
    return undefined;
  }

  it('thickens the border on focus and thins it again on blur', () => {
    const screen = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} testID="probe" />,
    );

    expect(ringWidth(screen)).toBe(1);
    fireEvent(screen.getByTestId('probe'), 'focus');
    expect(ringWidth(screen)).toBe(2);
    fireEvent(screen.getByTestId('probe'), 'blur');
    expect(ringWidth(screen)).toBe(1);
  });

  it('still calls a caller-supplied onBlur — the two are composed, not replaced', () => {
    // React Hook Form's `onBlur` arrives through `ControlledInput`. A
    // spread that overwrote the internal handler would leave the ring on
    // every field the patient has ever touched.
    const onBlur = jest.fn();
    const screen = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} testID="probe" onBlur={onBlur} />,
    );

    fireEvent(screen.getByTestId('probe'), 'focus');
    fireEvent(screen.getByTestId('probe'), 'blur');

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(ringWidth(screen)).toBe(1);
  });
});

describe('a real form (S-05)', () => {
  let changePassword: jest.SpyInstance | null = null;

  afterEach(() => {
    changePassword?.mockRestore();
    changePassword = null;
  });

  it('submits from the last field, so a keyboard alone completes it', async () => {
    changePassword = jest.spyOn(authService, 'changePassword').mockResolvedValue(undefined);
    const screen = renderWithProviders(<ChangePasswordForm />);

    fireEvent.changeText(screen.getByTestId('change-password-current'), 'Password1!');
    fireEvent.changeText(screen.getByTestId('change-password-new'), 'NewPassword2@');
    fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NewPassword2@');

    // No tap on the button: Done on the confirm field.
    fireEvent(screen.getByTestId('change-password-confirm'), 'submitEditing');

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'Password1!',
        newPassword: 'NewPassword2@',
      });
    });
  });
});
