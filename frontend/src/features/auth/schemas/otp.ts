import { z } from 'zod';

export const OTP_LENGTH = 6;

export const otpSchema = z.object({
  code: z
    .string()
    .length(OTP_LENGTH, 'validation.codeLength')
    .regex(/^\d+$/, 'validation.digitsOnly'),
});

export type OtpValues = z.infer<typeof otpSchema>;
