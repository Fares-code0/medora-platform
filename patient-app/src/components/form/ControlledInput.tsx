import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';

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
          {...(fieldState.error?.message === undefined ? {} : { error: fieldState.error.message })}
        />
      )}
    />
  );
}
