/**
 * Wire shapes for the doctor employment lifecycle (OD-12, #54).
 *
 * Administrative metadata only: who is employed where, since when, until
 * when. No patient identity crosses this boundary — the end result reports
 * how many care assignments and sessions were revoked as **counts**.
 */

export interface EmploymentHospitalView {
  /** `hospitals.public_id`. */
  readonly id: string;
  readonly name: string;
}

export interface EmploymentDepartmentView {
  /** `hospital_departments.id` (the table has no public id). */
  readonly id: string;
  readonly name: string;
}

export interface DoctorEmploymentView {
  readonly id: string;
  readonly doctorId: string;
  readonly hospital: EmploymentHospitalView;
  readonly hospitalDepartment: EmploymentDepartmentView | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** `endedAt === null` — the one employment that yields hospital context. */
  readonly active: boolean;
}

/** `POST /doctors/{doctorId}/employments/{employmentId}/end`. */
export interface EndEmploymentResult {
  readonly employment: DoctorEmploymentView;
  /** Live care assignments owned by this employment, now revoked. */
  readonly revokedAssignments: number;
  /** Live sessions of the doctor's account, now revoked (OD-12: no grace). */
  readonly revokedSessions: number;
}
