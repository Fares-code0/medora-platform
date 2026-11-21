import { Module } from '@nestjs/common';

import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';

import { DoctorDashboardController } from './controllers/doctor-dashboard.controller';
import { ActionQueueRepository } from './repositories/action-queue.repository';
import { CriticalAlertsRepository } from './repositories/critical-alerts.repository';
import { DashboardRepository } from './repositories/dashboard.repository';
import { ActionQueueService } from './services/action-queue.service';
import { CriticalAlertsService } from './services/critical-alerts.service';
import { DashboardService } from './services/dashboard.service';

/**
 * Dashboard & Shell — API §16.2–16.3.
 *
 * The composite endpoints behind the doctor and administrator overviews.
 * **Owns no tables of its own** — every row it serves belongs to another
 * domain, and it reads them through its own repository rather than by
 * importing the module that owns them (M2.2 zone 1; ADR-036 records the
 * same permission for `PatientTabsRepository`).
 *
 * ## What is here, and what is not
 *
 * **M15.4 — the doctor's action queue.** `GET
 * /dashboard/doctor/action-queue`, the Row 2 widget of UX §2.1: pending
 * appointment requests, unreviewed critical labs, unsigned notes and
 * stale message threads, sorted urgency then age. It is a standalone
 * widget endpoint because §16.2 allows one and UX §2.1's loading state
 * requires it — the queue is priority-fetched before the rest of the
 * page.
 *
 * **M27 — the composite** `GET /dashboard/doctor`, the other widgets, and
 * §16.3's critical-alerts banner. The composite composes the action
 * queue; it did not replace it.
 *
 * `CriticalAlertsRepository` is a **separate class from
 * `DashboardRepository`**, and that is not organisation: M27.3 requires
 * that a forced query failure produce a 5xx rather than an empty banner,
 * and a provider a spec can substitute is what makes that testable.
 *
 * `OutboxKernelModule`, `AuditKernelModule` and `ActivityKernelModule`
 * are deliberately absent: this module only reads. A dashboard that
 * wrote an audit entry per widget fetch would bury the log under a
 * polling client, and §14's audit surface is about acts, not glances.
 */
@Module({
  imports: [DatabaseModule, AuthzKernelModule],
  controllers: [DoctorDashboardController],
  providers: [
    ActionQueueService,
    ActionQueueRepository,
    DashboardService,
    DashboardRepository,
    CriticalAlertsService,
    CriticalAlertsRepository,
  ],
})
export class DashboardModule {}
