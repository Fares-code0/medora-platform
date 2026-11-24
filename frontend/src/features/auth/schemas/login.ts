import { z } from 'zod';

/*
 * Messages are catalogue keys, not English: a module-level schema cannot
 * call `useT()`, so the form translates them where it renders the error
 * (`translateIfKey`). Same in every auth schema.
 */

export const loginSchema = z.object({
  email: z.string().min(1, 'validation.enterEmail').email('validation.email'),
  password: z.string().min(1, 'validation.enterPassword'),
  rememberMe: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;
