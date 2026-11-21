import { z } from 'zod';

export const forgotSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
});

export type ForgotValues = z.infer<typeof forgotSchema>;
