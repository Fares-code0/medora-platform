import type { Type } from '@nestjs/common';

import { AdministrationModule } from './administration/administration.module';
import { AiModule } from './ai/ai.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ControlledAccessModule } from './controlled-access/controlled-access.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DoctorsModule } from './doctors/doctors.module';
import { FilesModule } from './files/files.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { LabsModule } from './labs/labs.module';
import { MedicalRecordsModule } from './medical-records/medical-records.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PatientsModule } from './patients/patients.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { ReportsModule } from './reports/reports.module';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

/**
 * The domain module registry (RM M2.1).
 *
 * One list, in the roadmap's declaration order, so a reader can check it
 * against M2.1 line by line. `app.module.ts` spreads it into `imports`
 * and `main.ts` logs it at boot — a module that exists on disk but is
 * never registered is invisible, and this is what makes that impossible
 * to miss.
 *
 * `HealthModule` is deliberately absent: it is infrastructure from M1,
 * not a domain module, and `app.module.ts` imports it directly.
 */
export const DOMAIN_MODULES: readonly Type[] = [
  AuthModule,
  UsersModule,
  DoctorsModule,
  PatientsModule,
  AppointmentsModule,
  MedicalRecordsModule,
  LabsModule,
  PharmacyModule,
  MessagingModule,
  NotificationsModule,
  AiModule,
  ReportsModule,
  SettingsModule,
  AdministrationModule,
  PlatformSettingsModule,
  AuditModule,
  FilesModule,
  SearchModule,
  DashboardModule,
  HospitalsModule,
  ControlledAccessModule,
];
