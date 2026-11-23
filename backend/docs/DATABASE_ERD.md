# Medora Database ERD

This diagram is generated from the authoritative split Prisma schema in `backend/prisma/schema/`.
It includes every Prisma model and relation. Column types and PK/FK/unique markers come from the schema;
partial indexes, check constraints, triggers and referential actions remain defined in the Prisma files and
SQL migrations. The diagram describes structural ownership only; it does not imply runtime authorization.

Regenerate after schema changes from `backend/` with `npm run db:erd` (after Prisma Client generation).

```mermaid
erDiagram
  AdminInvitation {
    String id PK
    String email
    String tokenHash UK
    String roleId FK
    String_array permissions
    DateTime expiresAt
    DateTime acceptedAt
    DateTime completedAt
    DateTime revokedAt
    String invitedBy FK
    String userId FK
    DateTime createdAt
  }
  %% Prisma index: AdminInvitation @@index([email])
  %% Prisma index: AdminInvitation @@index([expiresAt])
  AdminProfile {
    String id PK
    String userId FK,UK
    String photoUrl
    String fullName
    String title
    String biography
    String contactEmail
    String contactPhone
    String officeLocation
    String emergencyContactName
    String emergencyContactPhone
    String_array education
    String_array certifications
    String_array experience
    String linkedinUrl
    String websiteUrl
    String landingSection
    Boolean weeklyDigest
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: AdminProfile @@index([deletedAt])
  AiConversation {
    String id PK
    String ownerId FK
    String title
    AiContextMode contextMode
    String patientId FK
    String refPublicId
    Boolean favorite
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: AiConversation @@index([ownerId, updatedAt(sort: Desc)])
  %% Prisma index: AiConversation @@index([patientId])
  %% Prisma index: AiConversation @@index([deletedAt])
  %% Prisma index: AiConversation @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "ai_conversations_hospital_scope_idx")
  AiMessage {
    String id PK
    String conversationId FK
    AiChatRole role
    String content
    AiMessageStatus status
    String error
    Int feedback
    DateTime createdAt
  }
  %% Prisma index: AiMessage @@index([conversationId, createdAt])
  AiPromptTemplate {
    String id PK
    String slug UK
    String label
    String description
    String promptText
    AiContextMode contextMode
    Int position
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  AiUserSetting {
    String userId PK,FK
    Decimal temperature
    AiResponseLength responseLength
    AiLanguage language
    Boolean autoContext
    Boolean streaming
    String_array favoritePromptIds
    DateTime createdAt
    DateTime updatedAt
  }
  Announcement {
    String id PK
    String title
    String body
    String authorId FK
    AnnouncementPriority priority
    Boolean pinned
    Boolean archived
    DateTime createdAt
    DateTime updatedAt
    DateTime expiresAt
    DateTime deletedAt
  }
  %% Prisma index: Announcement @@index([pinned, createdAt(sort: Desc)])
  %% Prisma index: Announcement @@index([deletedAt])
  ApiKey {
    String id PK
    String label
    String prefix UK
    String keyHash
    String createdBy FK
    DateTime createdAt
    DateTime lastUsedAt
    DateTime revokedAt
  }
  %% Prisma index: ApiKey @@index([prefix], where: raw("revoked_at IS NULL"), map: "api_keys_live_idx")
  Appointment {
    String id PK
    String publicId UK
    String patientId FK
    String doctorId FK
    String departmentId FK
    String visitTypeId FK
    DateTime startsAt
    Int durationMin
    AppointmentStatus status
    AppointmentPriority priority
    Boolean isNewPatient
    Boolean isFollowUp
    String reason
    String notes
    String cancelledReason
    DateTime endsAt
    DateTime completedAt
    DateTime cancelledAt
    String cancelledBy FK
    DateTime noShowAt
    DateTime checkedInAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy FK
    String updatedBy
    String hospitalId FK
    String hospitalDepartmentId FK
    String hospitalMedicalRecordId FK
    String doctorEmploymentId FK
    String publishedSlotId FK
  }
  %% Prisma constraint: Appointment @@unique([publishedSlotId], where: raw("(published_slot_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::appointment_status, 'rescheduled'::appointment_status, 'completed'::appointment_status, 'no-show'::appointment_status]))"), map: "appointments_one_active_booking_per_slot")
  %% Prisma index: Appointment @@index([doctorId, startsAt])
  %% Prisma index: Appointment @@index([patientId, startsAt(sort: Desc)])
  %% Prisma index: Appointment @@index([status, startsAt])
  %% Prisma index: Appointment @@index([departmentId])
  %% Prisma index: Appointment @@index([deletedAt])
  %% Prisma index: Appointment @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "appointments_hospital_scope_idx")
  %% Prisma index: Appointment @@index([hospitalId, doctorEmploymentId], map: "appointments_hospital_employment_idx")
  %% Prisma index: Appointment @@index([publishedSlotId], map: "appointments_published_slot_idx")
  %% Prisma index: Appointment @@index([startsAt], where: raw("status = 'pending'"), map: "appointments_pending_idx")
  %% Prisma index: Appointment @@index([hospitalId, hospitalDepartmentId], map: "appointments_hospital_department_idx")
  AppointmentEvent {
    String id PK
    String appointmentId FK
    DateTime occurredAt
    AppointmentAction action
    AppointmentStatus fromStatus
    AppointmentStatus toStatus
    String actorId FK
    String actorName
    String reason
    Json detail
  }
  %% Prisma index: AppointmentEvent @@index([appointmentId, occurredAt(sort: Desc)])
  AppointmentRescheduleProposal {
    String id PK
    String appointmentId FK
    String proposedBy FK
    DateTime slot1
    DateTime slot2
    DateTime slot3
    String status
    Int chosenSlot
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: AppointmentRescheduleProposal @@index([appointmentId])
  %% Prisma index: AppointmentRescheduleProposal @@index([status])
  AuditEvent {
    String id PK
    DateTime occurredAt PK
    String actorId
    String actorRole
    AuditCategory category
    String eventType
    AuditSeverity severity
    String summary
    String target
    String ipAddress
    String device
    String sessionId
    Json payload
    String incidentRef
    String hospitalId
  }
  %% Prisma index: AuditEvent @@index([occurredAt(sort: Desc)])
  %% Prisma index: AuditEvent @@index([occurredAt], type: Brin, map: "audit_events_occurred_at_brin_idx")
  %% Prisma index: AuditEvent @@index([actorId, occurredAt(sort: Desc)])
  %% Prisma index: AuditEvent @@index([category, severity, occurredAt(sort: Desc)])
  %% Prisma index: AuditEvent @@index([sessionId])
  %% Prisma index: AuditEvent @@index([ipAddress])
  %% Prisma index: AuditEvent @@index([summary(ops: raw("gin_trgm_ops"))], type: Gin, map: "audit_events_summary_trgm_idx")
  %% Prisma index: AuditEvent @@index([hospitalId, occurredAt(sort: Desc)], map: "audit_events_hospital_occurred_idx")
  Backup {
    String id PK
    String label
    Decimal sizeMb
    BackupKind kind
    String createdBy FK
    String storageRef
    DateTime createdAt
  }
  %% Prisma index: Backup @@index([createdAt(sort: Desc)])
  ChronicCondition {
    String id PK
    String code UK
    String name UK
    String description
    Int position
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  Clinic {
    String id PK
    String publicId UK
    String hospitalId FK
    String name
    String status
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: Clinic @@unique([hospitalId, name], map: "clinics_hospital_id_name_key")
  %% Prisma index: Clinic @@index([hospitalId, status], map: "clinics_hospital_id_status_idx")
  %% Prisma index: Clinic @@index([deletedAt], map: "clinics_deleted_at_idx")
  ClinicOperatingHour {
    String id PK
    String clinicId FK
    Weekday day
    Boolean open
    DateTime startTime
    DateTime endTime
    String breakLabel
    DateTime createdAt
    DateTime updatedAt
    String createdBy FK
    String updatedBy FK
  }
  %% Prisma constraint: ClinicOperatingHour @@unique([clinicId, day], map: "clinic_operating_hours_clinic_day_key")
  %% Prisma index: ClinicOperatingHour @@index([clinicId, open], map: "clinic_operating_hours_clinic_open_idx")
  ClinicWorkingDay {
    Weekday day PK
    Boolean open
    DateTime startTime
    DateTime endTime
    String breakLabel
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  CommunicationAccessRequest {
    String id PK
    String conversationId FK
    String requestedBy FK
    String justificationCategory
    String reason
    String status
    String approvedBy FK
    DateTime grantedAt
    DateTime expiresAt
    String accessRef UK
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: CommunicationAccessRequest @@index([status, createdAt])
  %% Prisma index: CommunicationAccessRequest @@index([conversationId])
  ConventionsReference {
    String id PK
    String label
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: ConventionsReference @@index([deletedAt], map: "conventions_reference_deleted_at_idx")
  %% Prisma index: ConventionsReference @@index([label(ops: raw("gin_trgm_ops"))], type: Gin, map: "conventions_reference_label_trgm_idx")
  Conversation {
    String id PK
    ConversationKind kind
    String topic
    String patientId FK
    Boolean readOnly
    DateTime lastActivityAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: Conversation @@index([lastActivityAt(sort: Desc)])
  %% Prisma index: Conversation @@index([patientId])
  %% Prisma index: Conversation @@index([deletedAt])
  %% Prisma index: Conversation @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "conversations_hospital_scope_idx")
  ConversationParticipant {
    String conversationId PK,FK
    String userId PK,FK
    Int unreadCount
    Boolean pinned
    Boolean starred
    Boolean archived
    Boolean muted
    String draft
    Boolean favorite
    DateTime lastReadAt
    DateTime joinedAt
  }
  %% Prisma index: ConversationParticipant @@index([userId, archived])
  ConversationSharedLink {
    String id PK
    String conversationId FK
    String label
    String url
    String sharedBy FK
    DateTime sharedAt
  }
  %% Prisma index: ConversationSharedLink @@index([conversationId])
  Department {
    String id PK
    String name UK
    String description
    ActiveStatus status
    String headStaffId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: Department @@index([deletedAt])
  Doctor {
    String id PK
    String userId FK,UK
    String photoUrl
    String fullName
    String title
    String specialty
    String licenseNumber UK
    DateTime licenseExpiresOn
    String professionalCategory
    String employeeId UK
    String departmentId FK
    String hospital
    Int yearsOfExperience
    String_array languages
    String biography
    String_array education
    String_array certifications
    String_array skills
    String linkedinUrl
    String websiteUrl
    String emergencyContactName
    String emergencyContactPhone
    String contactEmail
    String contactPhone
    String officeLocation
    String officeHours
    DoctorVerificationStatus verificationStatus
    DateTime verifiedAt
    String verifiedBy FK
    DoctorPracticeStatus practiceStatus
    Decimal ratingAvg
    Int defaultDurationMin
    Int bufferMin
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: Doctor @@index([deletedAt])
  %% Prisma index: Doctor @@index([departmentId])
  %% Prisma index: Doctor @@index([verificationStatus])
  %% Prisma index: Doctor @@index([practiceStatus])
  DoctorAvailability {
    String id PK
    String doctorId FK
    Weekday weekday
    DateTime startTime
    DateTime endTime
    Boolean isBreak
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String doctorEmploymentId FK
  }
  %% Prisma constraint: DoctorAvailability @@unique([doctorId, weekday, startTime], where: raw("doctor_employment_id IS NULL"), map: "doctor_availability_legacy_unique")
  %% Prisma constraint: DoctorAvailability @@unique([doctorEmploymentId, weekday, startTime], where: raw("doctor_employment_id IS NOT NULL"), map: "doctor_availability_employment_unique")
  %% Prisma index: DoctorAvailability @@index([doctorEmploymentId], map: "doctor_availability_employment_idx")
  DoctorEmployment {
    String id PK
    String doctorId FK
    String hospitalId FK
    String hospitalDepartmentId FK
    DateTime startedAt
    DateTime endedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma constraint: DoctorEmployment @@unique([id, hospitalId], map: "doctor_employments_id_hospital_id_key")
  %% Prisma constraint: DoctorEmployment @@unique([id, hospitalId, doctorId], map: "doctor_employments_id_hospital_doctor_key")
  %% Prisma constraint: DoctorEmployment @@unique([doctorId], where: raw("ended_at IS NULL"), map: "doctor_employments_one_active_per_doctor_key")
  %% Prisma index: DoctorEmployment @@index([hospitalId, endedAt], map: "doctor_employments_hospital_ended_idx")
  %% Prisma index: DoctorEmployment @@index([doctorId, startedAt(sort: Desc)], map: "doctor_employments_doctor_started_idx")
  DoctorSpecialty {
    String doctorId PK,FK
    String specialtyId PK,FK
    Boolean isPrimary
    DateTime createdAt
  }
  %% Prisma constraint: DoctorSpecialty @@unique([doctorId], where: raw("is_primary"), map: "doctor_specialties_one_primary")
  %% Prisma index: DoctorSpecialty @@index([specialtyId])
  DoctorTimeOff {
    String id PK
    String doctorId FK
    DateTime startsAt
    DateTime endsAt
    String kind
    String autoBehavior
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String doctorEmploymentId FK
  }
  %% Prisma index: DoctorTimeOff @@index([doctorId, startsAt, endsAt])
  %% Prisma index: DoctorTimeOff @@index([doctorEmploymentId], map: "doctor_time_off_employment_idx")
  DoctorVerificationDocument {
    String id PK
    String doctorId FK
    String kind
    String fileId FK
    DateTime uploadedAt
    DateTime expiresOn
    Boolean checkAuthentic
    Boolean checkCurrent
    Boolean checkIdentityMatch
    String decision
    String decidedBy FK
    DateTime decidedAt
    String rejectReason
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: DoctorVerificationDocument @@index([doctorId])
  %% Prisma index: DoctorVerificationDocument @@index([decision])
  %% Prisma index: DoctorVerificationDocument @@index([deletedAt])
  DocumentTemplate {
    String id PK
    String name
    TemplateKind kind
    String description
    Int usageCount
    Boolean archived
    String title
    String body
    String authorId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: DocumentTemplate @@index([kind, archived])
  %% Prisma index: DocumentTemplate @@index([deletedAt])
  DomainEvent {
    String id PK
    String topic
    Json payload
    String dedupeKey UK
    String correlationId
    String status
    Int attempts
    DateTime deliveredAt
    String lastError
    DateTime createdAt
    String hospitalId FK
  }
  %% Prisma index: DomainEvent @@index([status, createdAt])
  %% Prisma index: DomainEvent @@index([hospitalId, createdAt], map: "domain_events_hospital_created_idx")
  DrugInteraction {
    String id PK
    String medicationAId FK
    String medicationBId FK
    SafetyWarningSeverity severity
    String title
    String detail
    String management
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: DrugInteraction @@unique([medicationAId, medicationBId])
  %% Prisma index: DrugInteraction @@index([medicationBId])
  File {
    String id PK
    String storageKey
    String originalName
    String mimeType
    BigInt sizeBytes
    String checksumSha256
    String kind
    String hospitalId FK
    String uploadedBy FK
    DateTime scannedAt
    String scanResult
    DateTime createdAt
    DateTime deletedAt
  }
  %% Prisma index: File @@index([hospitalId], map: "files_hospital_id_idx")
  %% Prisma index: File @@index([deletedAt])
  Holiday {
    String id PK
    String name
    DateTime date
    HolidayKind kind
    Boolean recurring
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: Holiday @@unique([name, date])
  %% Prisma index: Holiday @@index([date])
  %% Prisma index: Holiday @@index([deletedAt])
  Hospital {
    String id PK
    String publicId UK
    String name
    String legalName
    String status
    String timezone
    String phone
    String email UK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: Hospital @@index([status], map: "hospitals_status_idx")
  %% Prisma index: Hospital @@index([deletedAt], map: "hospitals_deleted_at_idx")
  HospitalDepartment {
    String id PK
    String hospitalId FK
    String name
    String description
    ActiveStatus status
    String catalogueDepartmentId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: HospitalDepartment @@unique([id, hospitalId], map: "hospital_departments_id_hospital_id_key")
  %% Prisma constraint: HospitalDepartment @@unique([hospitalId, name], map: "hospital_departments_hospital_id_name_key")
  %% Prisma index: HospitalDepartment @@index([hospitalId, status], map: "hospital_departments_hospital_status_idx")
  %% Prisma index: HospitalDepartment @@index([catalogueDepartmentId], map: "hospital_departments_catalogue_department_idx")
  %% Prisma index: HospitalDepartment @@index([deletedAt], map: "hospital_departments_deleted_at_idx")
  HospitalInsuranceCoverage {
    String id PK
    String hospitalId FK
    String providerId FK
    String planCode
    String planName
    Boolean active
    DateTime startsOn
    DateTime endsOn
    DateTime createdAt
  }
  %% Prisma constraint: HospitalInsuranceCoverage @@unique([hospitalId, providerId, planCode], map: "hospital_insurance_coverage_plan_key")
  %% Prisma index: HospitalInsuranceCoverage @@index([hospitalId, active], map: "hospital_insurance_coverage_hospital_active_idx")
  HospitalLocation {
    String id PK
    String hospitalId FK
    String name
    String addressLine1
    String addressLine2
    String city
    String region
    String postalCode
    String countryCode
    Decimal latitude
    Decimal longitude
    String status
    String timezone
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: HospitalLocation @@unique([hospitalId, name], map: "hospital_locations_hospital_id_name_key")
  %% Prisma index: HospitalLocation @@index([hospitalId, status], map: "hospital_locations_hospital_id_status_idx")
  %% Prisma index: HospitalLocation @@index([deletedAt], map: "hospital_locations_deleted_at_idx")
  HospitalMedicalRecord {
    String id PK
    String patientId FK
    String hospitalId FK
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma constraint: HospitalMedicalRecord @@unique([patientId, hospitalId], map: "hospital_medical_records_patient_hospital_key")
  %% Prisma constraint: HospitalMedicalRecord @@unique([id, hospitalId, patientId], map: "hospital_medical_records_id_hospital_patient_key")
  %% Prisma index: HospitalMedicalRecord @@index([hospitalId, createdAt(sort: Desc)], map: "hospital_medical_records_hospital_created_idx")
  HospitalMedicalRecordCondition {
    String id PK
    String hospitalMedicalRecordId FK
    String hospitalId FK
    String patientId FK
    String conditionId FK
    DateTime diagnosedOn
    String recordedBy FK
    DateTime createdAt
    DateTime deletedAt
  }
  %% Prisma constraint: HospitalMedicalRecordCondition @@unique([hospitalMedicalRecordId, conditionId], where: raw("deleted_at IS NULL"), map: "hospital_medical_record_conditions_active_key")
  %% Prisma index: HospitalMedicalRecordCondition @@index([conditionId], map: "hospital_medical_record_conditions_condition_idx")
  %% Prisma index: HospitalMedicalRecordCondition @@index([hospitalId, deletedAt], map: "hospital_medical_record_conditions_hospital_deleted_idx")
  HospitalRoleAssignment {
    String id PK
    String userId FK
    String hospitalId FK
    String roleId FK
    String sourceDoctorEmploymentId FK
    String sourceStaffAffiliationId FK
    String grantedBy FK
    DateTime grantedAt
    DateTime revokedAt
  }
  %% Prisma constraint: HospitalRoleAssignment @@unique([userId, hospitalId, roleId], where: raw("revoked_at IS NULL"), map: "hospital_role_assignments_active_key")
  %% Prisma index: HospitalRoleAssignment @@index([hospitalId, userId, revokedAt], map: "hospital_role_assignments_hospital_user_revoked_idx")
  %% Prisma index: HospitalRoleAssignment @@index([roleId], map: "hospital_role_assignments_role_idx")
  %% Prisma index: HospitalRoleAssignment @@index([sourceDoctorEmploymentId], map: "hospital_role_assignments_doctor_source_idx")
  %% Prisma index: HospitalRoleAssignment @@index([sourceStaffAffiliationId], map: "hospital_role_assignments_staff_source_idx")
  HospitalStaffAffiliation {
    String id PK
    String staffId FK
    String hospitalId FK
    String hospitalDepartmentId FK
    DateTime startedAt
    DateTime endedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma constraint: HospitalStaffAffiliation @@unique([id, hospitalId], map: "hospital_staff_affiliations_id_hospital_id_key")
  %% Prisma constraint: HospitalStaffAffiliation @@unique([id, hospitalId, staffId], map: "hospital_staff_affiliations_id_hospital_staff_key")
  %% Prisma constraint: HospitalStaffAffiliation @@unique([staffId, hospitalId], where: raw("ended_at IS NULL"), map: "hospital_staff_affiliations_one_active_per_hospital_key")
  %% Prisma constraint: HospitalStaffAffiliation @@unique([staffId], where: raw("ended_at IS NULL"), map: "hospital_staff_affiliations_one_active_per_staff_key")
  %% Prisma index: HospitalStaffAffiliation @@index([hospitalId, endedAt], map: "hospital_staff_affiliations_hospital_ended_idx")
  %% Prisma index: HospitalStaffAffiliation @@index([staffId, startedAt(sort: Desc)], map: "hospital_staff_affiliations_staff_started_idx")
  IcdCode {
    String id PK
    String code UK
    String label
    String description
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  IdempotencyRecord {
    String id PK
    String userId FK
    String key
    String endpoint
    String fingerprint
    String status
    Json responseBody
    DateTime createdAt
    DateTime completedAt
    DateTime expiresAt
  }
  %% Prisma constraint: IdempotencyRecord @@unique([userId, key])
  %% Prisma index: IdempotencyRecord @@index([expiresAt])
  IncidentBookmark {
    String id PK
    String ownerId FK
    String name
    String description
    String_array eventIds
    String incidentRef
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma constraint: IncidentBookmark @@unique([ownerId, name])
  %% Prisma index: IncidentBookmark @@index([incidentRef])
  InsuranceProvider {
    String id PK
    String code UK
    String name UK
    String phone
    String website
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  LabAnalyteSpec {
    String id PK
    String testId FK
    String analyte
    String unit
    Decimal refLow
    Decimal refHigh
    Int decimals
    Decimal criticalLow
    Decimal criticalHigh
    String_array qualitativeOptions
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: LabAnalyteSpec @@unique([testId, analyte])
  LabAttachment {
    String id PK
    String labOrderId FK
    String name
    LabAttachmentKind kind
    Int sizeKb
    String fileId FK
    String uploadedBy FK
    DateTime uploadedAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: LabAttachment @@index([labOrderId])
  %% Prisma index: LabAttachment @@index([fileId])
  LabOrder {
    String id PK
    String publicId UK
    String patientId FK
    String testId FK
    String departmentId FK
    String orderedBy FK
    String clinicalIndication
    LabStatus status
    LabPriority priority
    DateTime requestedAt
    DateTime collectedAt
    DateTime completedAt
    String interpretation
    Boolean hasCriticalResult
    DateTime reviewedAt
    String reviewedBy FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalDepartmentId FK
    String hospitalMedicalRecordId FK
    String doctorEmploymentId FK
  }
  %% Prisma index: LabOrder @@index([patientId, requestedAt(sort: Desc)])
  %% Prisma index: LabOrder @@index([status, priority])
  %% Prisma index: LabOrder @@index([orderedBy])
  %% Prisma index: LabOrder @@index([deletedAt])
  %% Prisma index: LabOrder @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "lab_orders_hospital_scope_idx")
  %% Prisma index: LabOrder @@index([requestedAt], where: raw("has_critical_result AND reviewed_at IS NULL"), map: "lab_orders_critical_unreviewed_idx")
  %% Prisma index: LabOrder @@index([hospitalId, hospitalDepartmentId], map: "lab_orders_hospital_department_idx")
  LabResult {
    String id PK
    String labOrderId FK
    String analyteSpecId FK
    String analyte
    String valueText
    Decimal valueNumeric
    String unit
    Decimal refLow
    Decimal refHigh
    String refText
    LabResultFlag flag
    DateTime resultedAt
    String verifiedBy FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: LabResult @@unique([labOrderId, analyte])
  %% Prisma index: LabResult @@index([analyte, resultedAt])
  %% Prisma index: LabResult @@index([deletedAt])
  LabSpecimen {
    String labOrderId PK,FK
    LabSpecimenType type
    String container
    String collectionSite
    String collectedBy
    String collectedById FK
    DateTime collectedAt
    DateTime receivedAt
    LabSpecimenCondition condition
    String volume
    DateTime createdAt
    DateTime updatedAt
  }
  LabTestCatalogue {
    String id PK
    String name
    String code UK
    LabTestCategory category
    LabSpecimenType specimenType
    String container
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: LabTestCatalogue @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "lab_test_catalogue_name_trgm_idx")
  LabTimelineEvent {
    String id PK
    String labOrderId FK
    LabTimelineKind kind
    DateTime occurredAt
    String actor
    String actorId FK
    String detail
  }
  %% Prisma index: LabTimelineEvent @@index([labOrderId, occurredAt(sort: Desc)])
  LoginEvent {
    String id PK
    String userId FK
    String attemptedEmail
    DateTime occurredAt
    String device
    String ipAddress
    String location
    LoginResult result
    String failureCode
    String anomalyFlag
  }
  %% Prisma index: LoginEvent @@index([userId, occurredAt(sort: Desc)])
  %% Prisma index: LoginEvent @@index([result, occurredAt(sort: Desc)])
  MedicalRecord {
    String id PK
    String publicId UK
    String patientId FK
    String doctorId FK
    String departmentId FK
    String appointmentId FK
    DateTime visitDate
    String visitType
    RecordStatus status
    RecordPriority priority
    String chiefComplaint
    String historyOfPresentIllness
    String physicalExamination
    DateTime followUpDate
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalDepartmentId FK
    String hospitalMedicalRecordId FK
    String doctorEmploymentId FK
  }
  %% Prisma index: MedicalRecord @@index([patientId, visitDate(sort: Desc)])
  %% Prisma index: MedicalRecord @@index([doctorId, status])
  %% Prisma index: MedicalRecord @@index([status, priority])
  %% Prisma index: MedicalRecord @@index([appointmentId])
  %% Prisma index: MedicalRecord @@index([deletedAt])
  %% Prisma index: MedicalRecord @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "medical_records_hospital_scope_idx")
  %% Prisma index: MedicalRecord @@index([hospitalId, hospitalDepartmentId], map: "medical_records_hospital_department_idx")
  Medication {
    String id PK
    String name
    String genericName
    MedicationCategory category
    MedicationForm form
    MedicationRoute route
    String manufacturer
    Boolean isControlled
    Boolean isHighRisk
    String interactionNote
    String allergyClass
    String_array frequencies
    Int_array durationsDays
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: Medication @@unique([name, genericName])
  %% Prisma index: Medication @@index([name(ops: raw("gin_trgm_ops"))], type: Gin, map: "medications_name_trgm_idx")
  %% Prisma index: Medication @@index([genericName(ops: raw("gin_trgm_ops"))], type: Gin, map: "medications_generic_name_trgm_idx")
  MedicationMonograph {
    String medicationId PK,FK
    String indications
    String contraindications
    String standardDosing
    String pregnancyCategory
    String warnings
    String sideEffects
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  MedicationStrength {
    String id PK
    String medicationId FK
    String strength
    Int position
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: MedicationStrength @@unique([medicationId, strength])
  Message {
    String id PK
    String conversationId FK
    String authorId FK
    MessageKind kind
    String body
    DateTime sentAt
    MessageStatus status
    DateTime editedAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: Message @@index([conversationId, sentAt(sort: Desc)])
  %% Prisma index: Message @@index([deletedAt])
  %% Prisma index: Message @@index([body(ops: raw("gin_trgm_ops"))], type: Gin, map: "messages_body_trgm_idx")
  MessageAttachment {
    String id PK
    String messageId FK
    String fileId FK
    AttachmentKind kind
    String name
    BigInt sizeBytes
    DateTime scannedAt
    DateTime createdAt
  }
  %% Prisma index: MessageAttachment @@index([messageId])
  %% Prisma index: MessageAttachment @@index([fileId])
  MessageFlag {
    String id PK
    String messageId FK
    String category
    String source
    String flaggedBy FK
    String excerpt
    String status
    String resolution
    String resolutionNote
    String resolvedBy FK
    DateTime resolvedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: MessageFlag @@index([status, createdAt])
  %% Prisma index: MessageFlag @@index([messageId])
  Notification {
    String id PK
    String recipientId FK
    String title
    String body
    NotificationCategory category
    NotificationPriority priority
    NotificationKind kind
    String sender
    DateTime readAt
    Boolean archived
    Boolean favorite
    Boolean pinned
    String patientId FK
    String recordId FK
    String labOrderId FK
    String prescriptionId FK
    String appointmentId FK
    DateTime createdAt
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: Notification @@index([recipientId, createdAt(sort: Desc)])
  %% Prisma index: Notification @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "notifications_hospital_scope_idx")
  %% Prisma index: Notification @@index([recipientId, createdAt(sort: Desc)], where: raw("read_at IS NULL AND NOT archived"), map: "notifications_unread_idx")
  NotificationDelivery {
    String id PK
    String notificationId FK
    NotificationChannel channel
    String status
    Int attempts
    DateTime lastAttemptAt
    DateTime deliveredAt
    String error
    String providerRef
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma constraint: NotificationDelivery @@unique([notificationId, channel])
  %% Prisma index: NotificationDelivery @@index([status])
  NotificationPreference {
    String userId PK,FK
    Boolean channelEmail
    Boolean channelSms
    Boolean channelPush
    Boolean channelDesktop
    Boolean channelInApp
    Boolean quietHoursEnabled
    DateTime quietFrom
    DateTime quietTo
    Boolean catAppointments
    Boolean catMedicalRecords
    Boolean catLaboratory
    Boolean catPharmacy
    Boolean catPatients
    Boolean catAi
    Boolean catSystem
    Boolean catSecurity
    DateTime createdAt
    DateTime updatedAt
  }
  OtpCode {
    String id PK
    String userId FK
    String codeHash
    String channel
    DateTime expiresAt
    DateTime consumedAt
    Int attempts
    DateTime createdAt
  }
  %% Prisma index: OtpCode @@index([userId, expiresAt])
  Patient {
    String id PK
    String publicId UK
    String mrn UK
    String fullName
    DateTime dateOfBirth
    Gender gender
    BloodType bloodType
    String phone
    String email
    String address
    String photoUrl
    String userId FK,UK
    PatientStatus status
    RiskLevel riskLevel
    String medicalNotes
    DateTime lastVisitAt
    DateTime registeredAt
    String assignedDoctorId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: Patient @@index([deletedAt])
  %% Prisma index: Patient @@index([status])
  %% Prisma index: Patient @@index([assignedDoctorId])
  %% Prisma index: Patient @@index([fullName(ops: raw("gin_trgm_ops"))], type: Gin, map: "patients_full_name_trgm_idx")
  %% Prisma index: Patient @@index([mrn(ops: raw("gin_trgm_ops"))], type: Gin, map: "patients_mrn_trgm_idx")
  %% Prisma index: Patient @@index([phone(ops: raw("gin_trgm_ops"))], type: Gin, map: "patients_phone_trgm_idx")
  PatientAccessGrant {
    String id PK
    String patientId FK
    String granteeUserId FK
    String granteeRoleId FK
    String scope
    String reason
    String grantedBy FK
    DateTime grantedAt
    DateTime expiresAt
    String revokedBy FK
    DateTime revokedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: PatientAccessGrant @@index([patientId])
  %% Prisma index: PatientAccessGrant @@index([granteeUserId])
  %% Prisma index: PatientAccessGrant @@index([patientId, granteeUserId], where: raw("revoked_at IS NULL"), map: "patient_access_grants_live_idx")
  PatientAllergy {
    String id PK
    String patientId FK
    String allergen
    AllergySeverity severity
    String reaction
    String notes
    DateTime recordedAt
    String recordedBy FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma constraint: PatientAllergy @@unique([patientId, allergen], where: raw("hospital_medical_record_id IS NULL"), map: "patient_allergies_legacy_unique")
  %% Prisma constraint: PatientAllergy @@unique([hospitalMedicalRecordId, allergen], where: raw("hospital_medical_record_id IS NOT NULL"), map: "patient_allergies_hospital_unique")
  %% Prisma index: PatientAllergy @@index([deletedAt])
  %% Prisma index: PatientAllergy @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_allergies_hospital_scope_idx")
  PatientChronicCondition {
    String patientId PK,FK
    String conditionId PK,FK
    DateTime diagnosedOn
    String recordedBy FK
    DateTime createdAt
  }
  %% Prisma index: PatientChronicCondition @@index([conditionId])
  PatientClinicalAlert {
    String id PK
    String patientId FK
    AlertSeverity severity
    String message
    Boolean active
    String resolutionReason
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientClinicalAlert @@index([patientId])
  %% Prisma index: PatientClinicalAlert @@index([deletedAt])
  %% Prisma index: PatientClinicalAlert @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_clinical_alerts_hospital_scope_idx")
  PatientDoctorAssignment {
    String id PK
    String patientId FK
    String doctorId FK
    String role
    DateTime assignedAt
    DateTime revokedAt
    String grantedBy FK
    String hospitalId FK
    String hospitalMedicalRecordId FK
    String doctorEmploymentId FK
  }
  %% Prisma constraint: PatientDoctorAssignment @@unique([patientId], where: raw("((role)::text = 'primary'::text) AND (revoked_at IS NULL)"), map: "patient_doctor_assignments_one_live_primary")
  %% Prisma constraint: PatientDoctorAssignment @@unique([patientId, doctorId], where: raw("revoked_at IS NULL"), map: "patient_doctor_assignments_one_live_per_pair")
  %% Prisma index: PatientDoctorAssignment @@index([doctorId, patientId])
  %% Prisma index: PatientDoctorAssignment @@index([patientId])
  %% Prisma index: PatientDoctorAssignment @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_doctor_assignments_hospital_scope_idx")
  %% Prisma index: PatientDoctorAssignment @@index([doctorId, patientId], where: raw("revoked_at IS NULL"), map: "patient_doctor_assignments_live_idx")
  PatientDocument {
    String id PK
    String patientId FK
    String name
    DocumentCategory category
    Int sizeKb
    String fileId FK
    String uploadedBy FK
    DateTime uploadedAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientDocument @@index([patientId])
  %% Prisma index: PatientDocument @@index([fileId])
  %% Prisma index: PatientDocument @@index([deletedAt])
  %% Prisma index: PatientDocument @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_documents_hospital_scope_idx")
  PatientEmergencyContact {
    String id PK
    String patientId FK
    String name
    String relationship
    String phone
    Boolean isPrimary
    String removalReason
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: PatientEmergencyContact @@unique([patientId], where: raw("is_primary"), map: "patient_emergency_contacts_one_primary")
  %% Prisma index: PatientEmergencyContact @@index([patientId])
  %% Prisma index: PatientEmergencyContact @@index([deletedAt])
  PatientInsurance {
    String id PK
    String patientId FK
    String providerId FK
    String policyNumber
    String plan
    DateTime validUntil
    Boolean isActive
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: PatientInsurance @@unique([patientId, policyNumber])
  %% Prisma constraint: PatientInsurance @@unique([patientId], where: raw("is_active"), map: "patient_insurance_one_active")
  %% Prisma index: PatientInsurance @@index([providerId])
  %% Prisma index: PatientInsurance @@index([deletedAt])
  PatientMedicalHistory {
    String id PK
    String patientId FK
    HistoryEventKind kind
    String title
    DateTime occurredOn
    String detail
    String facility
    String recordedBy FK
    String removalReason
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientMedicalHistory @@index([patientId, occurredOn(sort: Desc)])
  %% Prisma index: PatientMedicalHistory @@index([deletedAt])
  %% Prisma index: PatientMedicalHistory @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_medical_history_hospital_scope_idx")
  PatientMedication {
    String id PK
    String patientId FK
    String prescriptionId FK
    String name
    String dosage
    String frequency
    DateTime startDate
    DateTime endDate
    String prescribedBy FK
    MedicationStatus status
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientMedication @@index([patientId, status])
  %% Prisma index: PatientMedication @@index([prescriptionId])
  %% Prisma index: PatientMedication @@index([deletedAt])
  %% Prisma index: PatientMedication @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_medications_hospital_scope_idx")
  PatientNote {
    String id PK
    String patientId FK
    String authorId FK
    DateTime authoredAt
    String title
    String body
    Boolean signed
    DateTime signedAt
    Boolean aiAssisted
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientNote @@index([patientId, authoredAt(sort: Desc)])
  %% Prisma index: PatientNote @@index([deletedAt])
  %% Prisma index: PatientNote @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_notes_hospital_scope_idx")
  PatientStudy {
    String id PK
    String patientId FK
    String labOrderId FK
    StudyModality modality
    String categoryLabel
    String name
    DateTime performedOn
    StudyStatus status
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientStudy @@index([patientId, performedOn(sort: Desc)])
  %% Prisma index: PatientStudy @@index([labOrderId])
  %% Prisma index: PatientStudy @@index([deletedAt])
  %% Prisma index: PatientStudy @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_studies_hospital_scope_idx")
  PatientVitalSign {
    String id PK
    String patientId FK
    String recordId FK
    DateTime recordedAt
    Int bloodPressureSystolic
    Int bloodPressureDiastolic
    Int heartRateBpm
    Decimal temperatureC
    Int respiratoryRate
    Int oxygenSaturation
    Decimal weightKg
    Decimal heightCm
    Decimal bmi
    String recordedBy FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalMedicalRecordId FK
  }
  %% Prisma index: PatientVitalSign @@index([patientId, recordedAt(sort: Desc)])
  %% Prisma index: PatientVitalSign @@index([recordId])
  %% Prisma index: PatientVitalSign @@index([deletedAt])
  %% Prisma index: PatientVitalSign @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "patient_vital_signs_hospital_scope_idx")
  Permission {
    String id PK
    String code UK
    String domain
    String description
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  PermissionMatrixState {
    Int id PK
    Int revision
    String updatedBy FK
    DateTime updatedAt
  }
  PlatformIntegration {
    String id PK
    String name UK
    String description
    Boolean connected
    DateTime lastSyncAt
    Bytes configEnc
    String updatedBy FK
    DateTime createdAt
    DateTime updatedAt
  }
  PlatformSetting {
    String key PK
    Json value
    String updatedBy FK
    DateTime updatedAt
  }
  Policy {
    String id PK
    String title
    String category
    String summary
    String version
    String body
    DateTime effectiveDate
    String authorId FK
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: Policy @@unique([title, version])
  %% Prisma index: Policy @@index([deletedAt])
  Prescription {
    String id PK
    String publicId UK
    String patientId FK
    String medicationId FK
    String prescribingDoctorId FK
    String departmentId FK
    String recordId FK
    String strength
    String dosage
    String frequency
    MedicationRoute route
    Int durationDays
    Int quantity
    String instructions
    PrescriptionStatus status
    DateTime startDate
    DateTime endDate
    Int refillsAllowed
    Int refillsRemaining
    RefillStatus refillStatus
    DateTime signedAt
    String discontinuedReason
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalDepartmentId FK
    String hospitalMedicalRecordId FK
    String doctorEmploymentId FK
  }
  %% Prisma index: Prescription @@index([patientId, status])
  %% Prisma index: Prescription @@index([prescribingDoctorId, createdAt(sort: Desc)])
  %% Prisma index: Prescription @@index([status, endDate])
  %% Prisma index: Prescription @@index([medicationId])
  %% Prisma index: Prescription @@index([deletedAt])
  %% Prisma index: Prescription @@index([hospitalId, hospitalMedicalRecordId], where: raw("hospital_id IS NOT NULL"), map: "prescriptions_hospital_scope_idx")
  %% Prisma index: Prescription @@index([hospitalId, hospitalDepartmentId], map: "prescriptions_hospital_department_idx")
  PrescriptionHistoryEntry {
    String id PK
    String prescriptionId FK
    DateTime occurredOn
    String event
    String detail
    DateTime createdAt
  }
  %% Prisma index: PrescriptionHistoryEntry @@index([prescriptionId, occurredOn(sort: Desc)])
  PrescriptionNote {
    String id PK
    String prescriptionId FK
    String authorId FK
    DateTime authoredAt
    String body
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: PrescriptionNote @@index([prescriptionId, authoredAt(sort: Desc)])
  PrescriptionSafetyWarning {
    String id PK
    String prescriptionId FK
    SafetyWarningKind kind
    SafetyWarningSeverity severity
    String title
    String detail
    String acknowledgedBy FK
    String acknowledgedReason
    DateTime acknowledgedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: PrescriptionSafetyWarning @@index([prescriptionId])
  PrescriptionTimelineEvent {
    String id PK
    String prescriptionId FK
    PrescriptionTimelineKind kind
    DateTime occurredAt
    String actorId FK
    String actorName
    String detail
  }
  %% Prisma index: PrescriptionTimelineEvent @@index([prescriptionId, occurredAt(sort: Desc)])
  PublishedSlot {
    String id PK
    String hospitalId FK
    String doctorEmploymentId FK
    DateTime startsAt
    Int durationMinutes
    DateTime createdAt
    DateTime withdrawnAt
  }
  %% Prisma constraint: PublishedSlot @@unique([id, hospitalId, doctorEmploymentId], map: "published_slots_id_hospital_employment_key")
  %% Prisma index: PublishedSlot @@index([hospitalId, startsAt], map: "published_slots_hospital_starts_idx")
  %% Prisma index: PublishedSlot @@index([doctorEmploymentId, startsAt], map: "published_slots_employment_starts_idx")
  QueueEntry {
    String id PK
    String ticket
    String patientId FK
    String patientName
    String reason
    QueuePriority priority
    DateTime enqueuedAt
    Int estimatedMinutes
    String roomId FK
    Boolean delayed
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
  }
  %% Prisma index: QueueEntry @@index([enqueuedAt])
  %% Prisma index: QueueEntry @@index([deletedAt])
  %% Prisma index: QueueEntry @@index([hospitalId, enqueuedAt], map: "queue_entries_hospital_enqueued_idx")
  RecordAllergy {
    String id PK
    String recordId FK
    String allergen
    AllergySeverity severity
    String reaction
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: RecordAllergy @@unique([recordId, allergen])
  RecordAttachment {
    String id PK
    String recordId FK
    String name
    RecordAttachmentKind kind
    Int sizeKb
    String fileId FK
    String uploadedBy FK
    DateTime uploadedAt
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: RecordAttachment @@index([recordId])
  %% Prisma index: RecordAttachment @@index([fileId])
  RecordDiagnosis {
    String id PK
    String recordId FK
    String icdCodeId FK
    Boolean isPrimary
    String recordedBy FK
    DateTime recordedAt
  }
  %% Prisma constraint: RecordDiagnosis @@unique([recordId, icdCodeId])
  %% Prisma constraint: RecordDiagnosis @@unique([recordId], where: raw("is_primary"), map: "record_diagnoses_one_primary")
  %% Prisma index: RecordDiagnosis @@index([icdCodeId])
  RecordIssueReport {
    String id PK
    String recordId FK
    String reportedBy FK
    String description
    String status
    String resolvedBy FK
    DateTime resolvedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: RecordIssueReport @@index([status, createdAt])
  %% Prisma index: RecordIssueReport @@index([recordId])
  %% Prisma index: RecordIssueReport @@index([createdAt], where: raw("(status)::text <> 'resolved'::text"), map: "record_issue_reports_open_idx")
  RecordMedication {
    String id PK
    String recordId FK
    String name
    String dosage
    String frequency
    String instructions
    MedicationStatus status
    String prescriptionId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: RecordMedication @@index([recordId])
  %% Prisma index: RecordMedication @@index([prescriptionId])
  RecordNote {
    String id PK
    String recordId FK
    String authorId FK
    DateTime authoredAt
    String title
    String body
    Boolean signed
    DateTime signedAt
    Boolean aiAssisted
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma index: RecordNote @@index([recordId, authoredAt(sort: Desc)])
  RecordTimelineEvent {
    String id PK
    String recordId FK
    RecordTimelineKind kind
    DateTime occurredAt
    String actorId FK
    String actorName
    String detail
  }
  %% Prisma index: RecordTimelineEvent @@index([recordId, occurredAt(sort: Desc)])
  RecordTreatmentPlanItem {
    String id PK
    String recordId FK
    Int position
    String text
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
  }
  %% Prisma constraint: RecordTreatmentPlanItem @@unique([recordId, position])
  RecordVersion {
    String id PK
    String recordId FK
    Int version
    DateTime changedAt
    String changedBy FK
    String actorName
    Json changes
    String summary
    String reason
  }
  %% Prisma constraint: RecordVersion @@unique([recordId, version])
  %% Prisma index: RecordVersion @@index([recordId, changedAt(sort: Desc)])
  ReportExport {
    String id PK
    String requestedBy FK
    ReportCategory category
    ExportFormat format
    String status
    String fileId FK
    String error
    String watermarkRef
    Json filters
    DateTime requestedAt
    DateTime completedAt
    DateTime expiresAt
  }
  %% Prisma index: ReportExport @@index([requestedBy, requestedAt(sort: Desc)])
  %% Prisma index: ReportExport @@index([status])
  Resource {
    String id PK
    String name
    String category
    String location
    Int quantity
    Int reorderLevel
    ResourceStatus status
    String departmentId FK
    String hospitalId FK
    String hospitalDepartmentId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: Resource @@index([hospitalId, hospitalDepartmentId], map: "resources_hospital_department_idx")
  %% Prisma index: Resource @@index([departmentId])
  %% Prisma index: Resource @@index([deletedAt])
  Role {
    String id PK
    String code UK
    String label
    String baseRoleId FK
    Boolean isSystem
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  RolePermission {
    String roleId PK,FK
    String permissionId PK,FK
    String grantedBy FK
    DateTime grantedAt
  }
  %% Prisma index: RolePermission @@index([permissionId])
  Room {
    String id PK
    String name
    RoomKind kind
    RoomStatus status
    Int capacity
    String note
    String departmentId FK
    String hospitalId FK
    String hospitalDepartmentId FK
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma constraint: Room @@unique([name], where: raw("hospital_id IS NULL"), map: "rooms_legacy_name_key")
  %% Prisma constraint: Room @@unique([hospitalId, name], where: raw("hospital_id IS NOT NULL"), map: "rooms_hospital_name_key")
  %% Prisma index: Room @@index([hospitalId, hospitalDepartmentId], map: "rooms_hospital_department_idx")
  %% Prisma index: Room @@index([deletedAt])
  %% Prisma index: Room @@index([departmentId])
  SatisfactionSurvey {
    String id PK
    String appointmentId FK,UK
    String patientId FK
    String doctorId FK
    Int rating
    String comment
    DateTime submittedAt
  }
  %% Prisma index: SatisfactionSurvey @@index([doctorId, submittedAt(sort: Desc)])
  %% Prisma index: SatisfactionSurvey @@index([patientId])
  SavedReport {
    String id PK
    String ownerId FK
    String name
    ReportCategory category
    DateRangeKey dateRange
    Boolean favorite
    Json filters
    DateTime lastViewedAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: SavedReport @@index([ownerId, category])
  ScheduledReport {
    String id PK
    String ownerId FK
    String name
    ReportCategory category
    ScheduleFrequency frequency
    ExportFormat format
    String_array recipients
    ScheduleStatus status
    DateTime nextRunAt
    DateTime createdAt
    DateTime updatedAt
  }
  %% Prisma index: ScheduledReport @@index([status, nextRunAt])
  %% Prisma index: ScheduledReport @@index([ownerId, createdAt(sort: Desc)])
  ScheduledReportRun {
    String id PK
    String scheduledReportId FK
    DateTime ranAt
    RunStatus status
    String error
  }
  %% Prisma index: ScheduledReportRun @@index([scheduledReportId, ranAt(sort: Desc)])
  Session {
    String id PK
    String userId FK
    String refreshTokenHash UK
    String previousTokenHash UK
    DateTime rotatedAt
    Bytes successorTokenCt
    Boolean rememberMe
    DateTime expiresAt
    String device
    String browser
    String ipAddress
    String location
    DateTime startedAt
    DateTime lastActiveAt
    Boolean locked
    DateTime revokedAt
  }
  %% Prisma index: Session @@index([userId])
  %% Prisma index: Session @@index([expiresAt])
  %% Prisma index: Session @@index([userId], where: raw("revoked_at IS NULL"), map: "sessions_user_id_live_idx")
  %% Prisma index: Session @@index([rotatedAt], where: raw("successor_token_ct IS NOT NULL"), map: "sessions_successor_rotated_at_idx")
  Specialty {
    String id PK
    String name UK
    String parentId FK
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  StaffMember {
    String id PK
    String userId FK
    String name
    StaffRole role
    String title
    String departmentId FK
    PresenceStatus status
    String phone
    String email UK
    String workingHours
    String_array permissions
    String avatarUrl
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: StaffMember @@index([deletedAt])
  %% Prisma index: StaffMember @@index([departmentId])
  StaffShiftAssignment {
    String id PK
    String staffId FK
    ShiftKind kind
    Boolean_array days
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
    String hospitalStaffAffiliationId FK
  }
  %% Prisma constraint: StaffShiftAssignment @@unique([staffId, kind], where: raw("hospital_staff_affiliation_id IS NULL"), map: "staff_shift_assignments_legacy_unique")
  %% Prisma constraint: StaffShiftAssignment @@unique([staffId, hospitalId, kind], where: raw("hospital_staff_affiliation_id IS NOT NULL"), map: "staff_shift_assignments_hospital_unique")
  %% Prisma index: StaffShiftAssignment @@index([deletedAt])
  %% Prisma index: StaffShiftAssignment @@index([hospitalStaffAffiliationId], map: "staff_shift_assignments_affiliation_idx")
  TrustedDevice {
    String id PK
    String userId FK
    String name
    DevicePlatform platform
    DateTime addedAt
    DateTime lastSeenAt
    Boolean isCurrent
    DateTime removedAt
    String pushToken
  }
  %% Prisma index: TrustedDevice @@index([userId])
  %% Prisma index: TrustedDevice @@index([pushToken])
  User {
    String id PK
    String publicId UK
    String firstName
    String lastName
    String displayName
    String email UK
    String username UK
    String phone
    String roleId FK
    DateTime emailVerifiedAt
    Boolean twoFactorEnabled
    UserStatus status
    String licenseNumber
    DateTime termsAcceptedAt
    DateTime privacyAcceptedAt
    DateTime lastActiveAt
    String avatarUrl
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
  }
  %% Prisma index: User @@index([deletedAt])
  %% Prisma index: User @@index([status])
  %% Prisma index: User @@index([roleId])
  UserActivityLog {
    String id PK
    String userId FK
    DateTime occurredAt
    ActivityKind kind
    String summary
    String detail
  }
  %% Prisma index: UserActivityLog @@index([userId, occurredAt(sort: Desc)])
  UserCredential {
    String userId PK,FK
    String passwordHash
    DateTime passwordUpdatedAt
    Int failedAttempts
    DateTime lockedUntil
    Bytes totpSecretEnc
    Bytes recoveryCodesEnc
    DateTime createdAt
    DateTime updatedAt
  }
  UserIntegration {
    String userId PK,FK
    IntegrationId integration PK
    Boolean connected
    DateTime connectedAt
    String accountLabel
    Bytes oauthTokensEnc
    DateTime createdAt
    DateTime updatedAt
  }
  UserInterfacePreference {
    String userId PK,FK
    String theme
    String locale
    Boolean sidebarCollapsed
    String density
    Int textScale
    Boolean reduceMotion
    Boolean highContrast
    String focusRings
    Boolean keyboardNav
    DateTime createdAt
    DateTime updatedAt
  }
  UserPermission {
    String userId PK,FK
    String permissionId PK,FK
    Boolean allowed
    String grantedBy FK
    DateTime grantedAt
  }
  %% Prisma index: UserPermission @@index([permissionId])
  UserSetting {
    String userId PK,FK
    Boolean privacyDataSharing
    Boolean privacyAnalytics
    Boolean privacyCookies
    Boolean privacyAiDataUsage
    LandingPage landingPage
    PatientTab defaultPatientTab
    RecordsTab defaultRecordsTab
    Boolean autoSaveDrafts
    String dateFormat
    String timeFormat
    String timezone
    DateTime createdAt
    DateTime updatedAt
  }
  VerificationToken {
    String id PK
    String userId FK
    TokenKind kind
    String tokenHash UK
    DateTime expiresAt
    DateTime usedAt
    DateTime createdAt
  }
  %% Prisma index: VerificationToken @@index([userId, kind])
  %% Prisma index: VerificationToken @@index([expiresAt])
  VisitType {
    String id PK
    String code UK
    String name UK
    String description
    Int defaultDurationMin
    Int position
    Boolean active
    DateTime createdAt
    DateTime updatedAt
    String createdBy
    String updatedBy
  }
  WaitingRoomEntry {
    String id PK
    String patientId FK
    String appointmentId FK
    String patientName
    DateTime appointmentTime
    DateTime checkedInAt
    String area
    WaitingStatus status
    DateTime createdAt
    DateTime updatedAt
    DateTime deletedAt
    String createdBy
    String updatedBy
    String hospitalId FK
  }
  %% Prisma index: WaitingRoomEntry @@index([status, checkedInAt])
  %% Prisma index: WaitingRoomEntry @@index([deletedAt])
  %% Prisma index: WaitingRoomEntry @@index([hospitalId, status, checkedInAt], map: "waiting_room_entries_hospital_status_idx")
  User o|--o{ AdminInvitation : "inviter"
  Role ||--o{ AdminInvitation : "role"
  User o|--o{ AdminInvitation : "user"
  User ||--o| AdminProfile : "user"
  HospitalMedicalRecord o|--o{ AiConversation : "hospital_medical_record"
  User ||--o{ AiConversation : "owner"
  Patient o|--o{ AiConversation : "patient"
  AiConversation ||--o{ AiMessage : "conversation"
  User ||--o| AiUserSetting : "user"
  User o|--o{ Announcement : "author"
  User o|--o{ ApiKey : "creator"
  User o|--o{ Appointment : "canceller"
  User o|--o{ Appointment : "creator"
  Department o|--o{ Appointment : "department"
  Doctor ||--o{ Appointment : "doctor"
  DoctorEmployment o|--o{ Appointment : "doctor_employment"
  HospitalDepartment o|--o{ Appointment : "hospital_department"
  HospitalMedicalRecord o|--o{ Appointment : "hospital_medical_record"
  Patient ||--o{ Appointment : "patient"
  PublishedSlot o|--o{ Appointment : "published_slot"
  VisitType ||--o{ Appointment : "visit_type"
  User o|--o{ AppointmentEvent : "actor"
  Appointment ||--o{ AppointmentEvent : "appointment"
  Appointment ||--o{ AppointmentRescheduleProposal : "appointment"
  User o|--o{ AppointmentRescheduleProposal : "proposer"
  User o|--o{ Backup : "creator"
  Hospital ||--o{ Clinic : "hospital"
  Clinic ||--o{ ClinicOperatingHour : "clinic"
  User o|--o{ ClinicOperatingHour : "creator"
  User o|--o{ ClinicOperatingHour : "updater"
  User o|--o{ CommunicationAccessRequest : "approver"
  Conversation ||--o{ CommunicationAccessRequest : "conversation"
  User ||--o{ CommunicationAccessRequest : "requester"
  HospitalMedicalRecord o|--o{ Conversation : "hospital_medical_record"
  Patient o|--o{ Conversation : "patient"
  Conversation ||--o{ ConversationParticipant : "conversation"
  User ||--o{ ConversationParticipant : "user"
  Conversation ||--o{ ConversationSharedLink : "conversation"
  User o|--o{ ConversationSharedLink : "sharer"
  StaffMember o|--o{ Department : "head_staff"
  Department o|--o{ Doctor : "department"
  User ||--o{ Doctor : "user"
  User o|--o{ Doctor : "verifier"
  Doctor ||--o{ DoctorAvailability : "doctor"
  DoctorEmployment o|--o{ DoctorAvailability : "employment"
  HospitalDepartment o|--o{ DoctorEmployment : "department"
  Doctor ||--o{ DoctorEmployment : "doctor"
  Hospital ||--o{ DoctorEmployment : "hospital"
  Doctor ||--o{ DoctorSpecialty : "doctor"
  Specialty ||--o{ DoctorSpecialty : "specialty"
  Doctor ||--o{ DoctorTimeOff : "doctor"
  DoctorEmployment o|--o{ DoctorTimeOff : "employment"
  User o|--o{ DoctorVerificationDocument : "decider"
  Doctor ||--o{ DoctorVerificationDocument : "doctor"
  File ||--o{ DoctorVerificationDocument : "file"
  User o|--o{ DocumentTemplate : "author"
  Hospital o|--o{ DomainEvent : "hospital"
  Medication ||--o{ DrugInteraction : "medication_a"
  Medication ||--o{ DrugInteraction : "medication_b"
  Hospital o|--o{ File : "hospital"
  User o|--o{ File : "uploaded_by_user"
  Department o|--o{ HospitalDepartment : "catalogue"
  Hospital ||--o{ HospitalDepartment : "hospital"
  Hospital ||--o{ HospitalInsuranceCoverage : "hospital"
  InsuranceProvider ||--o{ HospitalInsuranceCoverage : "provider"
  Hospital ||--o{ HospitalLocation : "hospital"
  Hospital ||--o{ HospitalMedicalRecord : "hospital"
  Patient ||--o{ HospitalMedicalRecord : "patient"
  ChronicCondition ||--o{ HospitalMedicalRecordCondition : "condition"
  HospitalMedicalRecord ||--o{ HospitalMedicalRecordCondition : "medical_record"
  User o|--o{ HospitalMedicalRecordCondition : "recorder"
  DoctorEmployment o|--o{ HospitalRoleAssignment : "doctor_employment"
  User o|--o{ HospitalRoleAssignment : "granter"
  Hospital ||--o{ HospitalRoleAssignment : "hospital"
  Role ||--o{ HospitalRoleAssignment : "role"
  HospitalStaffAffiliation o|--o{ HospitalRoleAssignment : "staff_affiliation"
  User ||--o{ HospitalRoleAssignment : "user"
  HospitalDepartment o|--o{ HospitalStaffAffiliation : "department"
  Hospital ||--o{ HospitalStaffAffiliation : "hospital"
  StaffMember ||--o{ HospitalStaffAffiliation : "staff"
  User ||--o{ IdempotencyRecord : "user"
  User ||--o{ IncidentBookmark : "owner"
  LabTestCatalogue ||--o{ LabAnalyteSpec : "test"
  File ||--o{ LabAttachment : "file"
  LabOrder ||--o{ LabAttachment : "order"
  User o|--o{ LabAttachment : "uploader"
  Department o|--o{ LabOrder : "department"
  DoctorEmployment o|--o{ LabOrder : "doctor_employment"
  HospitalDepartment o|--o{ LabOrder : "hospital_department"
  HospitalMedicalRecord o|--o{ LabOrder : "hospital_medical_record"
  Doctor ||--o{ LabOrder : "orderer"
  Patient ||--o{ LabOrder : "patient"
  User o|--o{ LabOrder : "reviewer"
  LabTestCatalogue ||--o{ LabOrder : "test"
  LabOrder ||--o{ LabResult : "order"
  LabAnalyteSpec o|--o{ LabResult : "spec"
  User o|--o{ LabResult : "verifier"
  User o|--o{ LabSpecimen : "collector"
  LabOrder ||--o| LabSpecimen : "order"
  User o|--o{ LabTimelineEvent : "actor_user"
  LabOrder ||--o{ LabTimelineEvent : "order"
  User o|--o{ LoginEvent : "user"
  Appointment o|--o{ MedicalRecord : "appointment"
  Department o|--o{ MedicalRecord : "department"
  Doctor ||--o{ MedicalRecord : "doctor"
  DoctorEmployment o|--o{ MedicalRecord : "doctor_employment"
  HospitalDepartment o|--o{ MedicalRecord : "hospital_department"
  HospitalMedicalRecord o|--o{ MedicalRecord : "hospital_medical_record"
  Patient ||--o{ MedicalRecord : "patient"
  Medication ||--o| MedicationMonograph : "medication"
  Medication ||--o{ MedicationStrength : "medication"
  User o|--o{ Message : "author"
  Conversation ||--o{ Message : "conversation"
  File ||--o{ MessageAttachment : "file"
  Message ||--o{ MessageAttachment : "message"
  User o|--o{ MessageFlag : "flagger"
  Message ||--o{ MessageFlag : "message"
  User o|--o{ MessageFlag : "resolver"
  Appointment o|--o{ Notification : "appointment"
  HospitalMedicalRecord o|--o{ Notification : "hospital_medical_record"
  LabOrder o|--o{ Notification : "lab_order"
  Patient o|--o{ Notification : "patient"
  Prescription o|--o{ Notification : "prescription"
  User ||--o{ Notification : "recipient"
  MedicalRecord o|--o{ Notification : "record"
  Notification ||--o{ NotificationDelivery : "notification"
  User ||--o| NotificationPreference : "user"
  User ||--o{ OtpCode : "user"
  Doctor o|--o{ Patient : "assigned_doctor"
  User o|--o| Patient : "user"
  Role o|--o{ PatientAccessGrant : "grantee_role"
  User o|--o{ PatientAccessGrant : "grantee_user"
  User ||--o{ PatientAccessGrant : "granter"
  Patient ||--o{ PatientAccessGrant : "patient"
  User o|--o{ PatientAccessGrant : "revoker"
  HospitalMedicalRecord o|--o{ PatientAllergy : "hospital_medical_record"
  Patient ||--o{ PatientAllergy : "patient"
  User o|--o{ PatientAllergy : "recorder"
  ChronicCondition ||--o{ PatientChronicCondition : "condition"
  Patient ||--o{ PatientChronicCondition : "patient"
  User o|--o{ PatientChronicCondition : "recorder"
  HospitalMedicalRecord o|--o{ PatientClinicalAlert : "hospital_medical_record"
  Patient ||--o{ PatientClinicalAlert : "patient"
  Doctor ||--o{ PatientDoctorAssignment : "doctor"
  DoctorEmployment o|--o{ PatientDoctorAssignment : "doctor_employment"
  User o|--o{ PatientDoctorAssignment : "granter"
  HospitalMedicalRecord o|--o{ PatientDoctorAssignment : "hospital_medical_record"
  Patient ||--o{ PatientDoctorAssignment : "patient"
  File ||--o{ PatientDocument : "file"
  HospitalMedicalRecord o|--o{ PatientDocument : "hospital_medical_record"
  Patient ||--o{ PatientDocument : "patient"
  User o|--o{ PatientDocument : "uploader"
  Patient ||--o{ PatientEmergencyContact : "patient"
  Patient ||--o{ PatientInsurance : "patient"
  InsuranceProvider ||--o{ PatientInsurance : "provider"
  HospitalMedicalRecord o|--o{ PatientMedicalHistory : "hospital_medical_record"
  Patient ||--o{ PatientMedicalHistory : "patient"
  User o|--o{ PatientMedicalHistory : "recorder"
  HospitalMedicalRecord o|--o{ PatientMedication : "hospital_medical_record"
  Patient ||--o{ PatientMedication : "patient"
  Doctor o|--o{ PatientMedication : "prescriber"
  Prescription o|--o{ PatientMedication : "prescription"
  User ||--o{ PatientNote : "author"
  HospitalMedicalRecord o|--o{ PatientNote : "hospital_medical_record"
  Patient ||--o{ PatientNote : "patient"
  HospitalMedicalRecord o|--o{ PatientStudy : "hospital_medical_record"
  LabOrder o|--o{ PatientStudy : "lab_order"
  Patient ||--o{ PatientStudy : "patient"
  HospitalMedicalRecord o|--o{ PatientVitalSign : "hospital_medical_record"
  Patient ||--o{ PatientVitalSign : "patient"
  MedicalRecord o|--o{ PatientVitalSign : "record"
  User o|--o{ PatientVitalSign : "recorder"
  User o|--o{ PermissionMatrixState : "updater"
  User o|--o{ PlatformIntegration : "updater"
  User o|--o{ PlatformSetting : "updater"
  User o|--o{ Policy : "author"
  Department o|--o{ Prescription : "department"
  DoctorEmployment o|--o{ Prescription : "doctor_employment"
  HospitalDepartment o|--o{ Prescription : "hospital_department"
  HospitalMedicalRecord o|--o{ Prescription : "hospital_medical_record"
  Medication ||--o{ Prescription : "medication"
  Patient ||--o{ Prescription : "patient"
  Doctor ||--o{ Prescription : "prescriber"
  MedicalRecord o|--o{ Prescription : "record"
  Prescription ||--o{ PrescriptionHistoryEntry : "prescription"
  User ||--o{ PrescriptionNote : "author"
  Prescription ||--o{ PrescriptionNote : "prescription"
  User o|--o{ PrescriptionSafetyWarning : "acknowledger"
  Prescription ||--o{ PrescriptionSafetyWarning : "prescription"
  User o|--o{ PrescriptionTimelineEvent : "actor"
  Prescription ||--o{ PrescriptionTimelineEvent : "prescription"
  DoctorEmployment ||--o{ PublishedSlot : "employment"
  Hospital ||--o{ PublishedSlot : "hospital"
  Hospital o|--o{ QueueEntry : "hospital"
  Patient o|--o{ QueueEntry : "patient"
  Room o|--o{ QueueEntry : "room"
  MedicalRecord ||--o{ RecordAllergy : "record"
  File ||--o{ RecordAttachment : "file"
  MedicalRecord ||--o{ RecordAttachment : "record"
  User o|--o{ RecordAttachment : "uploader"
  IcdCode ||--o{ RecordDiagnosis : "icd_code"
  MedicalRecord ||--o{ RecordDiagnosis : "record"
  User o|--o{ RecordDiagnosis : "recorder"
  MedicalRecord ||--o{ RecordIssueReport : "record"
  User o|--o{ RecordIssueReport : "reporter"
  User o|--o{ RecordIssueReport : "resolver"
  Prescription o|--o{ RecordMedication : "prescription"
  MedicalRecord ||--o{ RecordMedication : "record"
  User ||--o{ RecordNote : "author"
  MedicalRecord ||--o{ RecordNote : "record"
  User o|--o{ RecordTimelineEvent : "actor"
  MedicalRecord ||--o{ RecordTimelineEvent : "record"
  MedicalRecord ||--o{ RecordTreatmentPlanItem : "record"
  User o|--o{ RecordVersion : "actor"
  MedicalRecord ||--o{ RecordVersion : "record"
  File o|--o{ ReportExport : "file"
  User ||--o{ ReportExport : "requester"
  Department o|--o{ Resource : "department"
  Hospital o|--o{ Resource : "hospital"
  HospitalDepartment o|--o{ Resource : "hospital_department"
  Role o|--o{ Role : "base_role"
  User o|--o{ RolePermission : "granted_by_user"
  Permission ||--o{ RolePermission : "permission"
  Role ||--o{ RolePermission : "role"
  Department ||--o{ Room : "department"
  Hospital o|--o{ Room : "hospital"
  HospitalDepartment o|--o{ Room : "hospital_department"
  Appointment ||--o| SatisfactionSurvey : "appointment"
  Doctor ||--o{ SatisfactionSurvey : "doctor"
  Patient ||--o{ SatisfactionSurvey : "patient"
  User ||--o{ SavedReport : "owner"
  User ||--o{ ScheduledReport : "owner"
  ScheduledReport ||--o{ ScheduledReportRun : "scheduled_report"
  User ||--o{ Session : "user"
  Specialty o|--o{ Specialty : "parent"
  Department ||--o{ StaffMember : "department"
  User o|--o{ StaffMember : "user"
  HospitalStaffAffiliation o|--o{ StaffShiftAssignment : "hospital_affiliation"
  StaffMember ||--o{ StaffShiftAssignment : "staff"
  User ||--o{ TrustedDevice : "user"
  Role ||--o{ User : "role"
  User ||--o{ UserActivityLog : "user"
  User ||--o| UserCredential : "user"
  User ||--o{ UserIntegration : "user"
  User ||--o| UserInterfacePreference : "user"
  User o|--o{ UserPermission : "granted_by_user"
  Permission ||--o{ UserPermission : "permission"
  User ||--o{ UserPermission : "user"
  User ||--o| UserSetting : "user"
  User ||--o{ VerificationToken : "user"
  Appointment o|--o{ WaitingRoomEntry : "appointment"
  Hospital o|--o{ WaitingRoomEntry : "hospital"
  Patient o|--o{ WaitingRoomEntry : "patient"
```
