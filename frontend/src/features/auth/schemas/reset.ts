import { z } from 'zod';

import { strongPassword } from './password';

export const resetSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetValues = z.infer<typeof resetSchema>;
