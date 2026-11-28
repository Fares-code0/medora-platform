import { z } from 'zod';

/** `GET /me/lab-orders` — paging only; the subject is the session. */
export const patientLabStatusQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PatientLabStatusQuery = z.infer<typeof patientLabStatusQuerySchema>;
