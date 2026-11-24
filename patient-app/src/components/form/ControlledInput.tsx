import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';

import { useValidationMessage } from '@/i18n';

import { Input, type InputProps } from '../Input';

/**
 * `Input`, bound to a React Hook Form field.
 *
 * RHF + Zod is the frontend's stack (`@hookform/resolvers`, same
 * versions), so validation rules are written once as a Zod schema that
 * mirrors the backend DTO and both clients enforce the same thing.
 *
 * The field error is passed through to `Input`, which renders it with an
 * icon, a colour AND an `aria-invalid` — three carriers, so it survives a
 * colour-vision deficiency and a screen reader (checklist S-02).
 *
 * The schema's message is English by design (it mirrors the backend
 * DTO); `useValidationMessage` renders it in the patient's language.
 */
export interface ControlledInputProps<TValues extends FieldValues> extends Omit<
  InputProps,
  'value' | 'onChangeText' | 'error'
> {
  readonly control: Control<TValues>;
  readonly name: Path<TValues>;
}

export function ControlledInput<TValues extends FieldValues>({
  control,
  name,
  ...inputProps
}: ControlledInputProps<TValues>) {
  const message = useValidationMessage();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Input
          {...inputProps}
          value={typeof field.value === 'string' ? field.value : ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          {...(fieldState.error?.message === undefined
            ? {}
            : { error: message(fieldState.error.message) })}
        />
      )}
    />
  );
}
