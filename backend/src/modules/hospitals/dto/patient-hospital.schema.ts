import { z } from 'zod';

/** `GET /patient/hospitals`. */
export const patientHospitalQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PatientHospitalQuery = z.infer<typeof patientHospitalQuerySchema>;
