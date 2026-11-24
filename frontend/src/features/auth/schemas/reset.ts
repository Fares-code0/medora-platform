import { z } from 'zod';

import { strongPassword } from './password';

export const resetSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string().min(1, 'validation.confirmYourPassword'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.passwordMismatch',
    path: ['confirmPassword'],
  });

export type ResetValues = z.infer<typeof resetSchema>;
