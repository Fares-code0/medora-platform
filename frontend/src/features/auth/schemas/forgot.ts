import { z } from 'zod';

export const forgotSchema = z.object({
  email: z.string().min(1, 'validation.enterEmail').email('validation.email'),
});

export type ForgotValues = z.infer<typeof forgotSchema>;
