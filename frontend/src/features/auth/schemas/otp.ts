import { z } from 'zod';

export const OTP_LENGTH = 6;

export const otpSchema = z.object({
  code: z
    .string()
    .length(OTP_LENGTH, `Enter the ${String(OTP_LENGTH)}-digit code`)
    .regex(/^\d+$/, 'Code must be digits only'),
});

export type OtpValues = z.infer<typeof otpSchema>;
