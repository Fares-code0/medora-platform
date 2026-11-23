/**
 * Request validation for the doctor employment lifecycle
 * (OD-12, gap G3, stage S6 — GitHub #54).
 */

import { z } from 'zod';

/**
 * `POST /doctors/{doctorId}/employments` — start an employment.
 *
 * `hospitalId` is the hospital's **public id** (`hospitals.public_id`), the
 * identifier the platform exposes for a hospital; the internal uuid never
 * crosses the boundary as input. `hospitalDepartmentId` is the
 * `hospital_departments.id` uuid (that table has no public id) and must
 * belong to the same hospital, which the service checks before the
 * composite foreign key would.
 */
export const startEmploymentSchema = z.object({
  hospitalId: z.string().trim().min(1).max(40),
  hospitalDepartmentId: z.string().uuid().optional(),
});

export type StartEmploymentInput = z.infer<typeof startEmploymentSchema>;
