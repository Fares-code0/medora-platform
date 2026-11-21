import { useCallback, useRef } from 'react';

import type { TextInputInstance, TextInputProps } from 'react-native';

/**
 * Focus order for a form — checklist S-05.
 *
 * ── The problem ──────────────────────────────────────────────────────
 * On a phone keyboard the Return key on a text field does nothing by
 * default: it neither advances nor submits, so a patient filling in six
 * registration fields dismisses the keyboard, scrolls, taps the next
 * field, and gets the keyboard back. On an external keyboard — the case
 * S-05 names, and the one a patient with a motor impairment is most
 * likely to be using — there is no tap to fall back on.
 *
 * ── The shape ────────────────────────────────────────────────────────
 * One hook per form, one spread per field, in the order they are read:
 *
 * ```tsx
 * const chain = useFieldChain({ length: 2, onSubmit: () => void submit() });
 * <ControlledInput {...chain.field(0)} name="email" … />
 * <ControlledInput {...chain.field(1)} name="password" … />
 * ```
 *
 * Every field but the last gets a **Next** key that moves focus on; the
 * last gets **Done** and submits. The order is the argument order, which
 * is also the visual order, which is also the order a screen reader
 * walks — one list, so they cannot drift apart.
 *
 * `submitBehavior: 'submit'` on the intermediate fields keeps the
 * keyboard up while focus moves; without it every Next closes and
 * reopens the keyboard, and the form jumps under the patient's thumb.
 */

export interface FieldChainOptions {
  /** How many fields the form has, in reading order. */
  readonly length: number;
  /** Run when Done is pressed on the last field. */
  readonly onSubmit?: () => void;
}

/**
 * Exactly the props a chained field needs, and nothing else.
 *
 * `onSubmitEditing` is declared as taking no arguments rather than
 * borrowing `TextInputProps`' signature: the handler ignores the event,
 * and a nullary function is assignable where the event handler is
 * expected. It keeps the call sites — and the tests — free of a
 * synthetic event nobody reads.
 */
export type FieldChainProps = Pick<TextInputProps, 'returnKeyType' | 'submitBehavior'> & {
  readonly inputRef: (node: TextInputInstance | null) => void;
  readonly onSubmitEditing: () => void;
};

export interface FieldChain {
  /** Props for the field at `index`, counting from zero. */
  field: (index: number) => FieldChainProps;
}

export function useFieldChain({ length, onSubmit }: FieldChainOptions): FieldChain {
  const nodes = useRef<(TextInputInstance | null)[]>([]);

  const field = useCallback(
    (index: number): FieldChainProps => {
      const isLast = index >= length - 1;

      return {
        inputRef: (node) => {
          nodes.current[index] = node;
        },
        returnKeyType: isLast ? 'done' : 'next',
        submitBehavior: isLast ? 'blurAndSubmit' : 'submit',
        onSubmitEditing: () => {
          if (isLast) {
            onSubmit?.();
            return;
          }
          // A field that has not mounted yet — a step not yet revealed,
          // a conditionally rendered row — is skipped rather than
          // swallowing the key press.
          const next = nodes.current[index + 1];
          if (next) next.focus();
          else onSubmit?.();
        },
      };
    },
    [length, onSubmit],
  );

  return { field };
}
