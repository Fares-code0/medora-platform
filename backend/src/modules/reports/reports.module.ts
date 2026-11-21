import { Module } from '@nestjs/common';

import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';

import { AnalyticsController } from './controllers/analytics.controller';
import { ReportsController } from './controllers/reports.controller';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { SavedReportRepository } from './repositories/saved-report.repository';
import { SnapshotRepository } from './repositories/snapshot.repository';
import { AnalyticsService } from './services/analytics.service';
import { InsightService } from './services/insight.service';
import { ReportDocumentService } from './services/report-document.service';
import { ReportExportService } from './services/report-export.service';
import { ReportsJobs } from './services/reports.jobs';
import { SnapshotService } from './services/snapshot.service';

/**
 * Reports & Analytics — API §12.
 *
 * Aggregate reporting and exports. Reads across modules through queries
 * it owns, never by importing another module.
 *
 * ## What is here: the revenue slot, and only that (M17.2)
 *
 * M17 is a **deferral** milestone. Its exit gate is "nothing built ahead
 * of product need; contract slot reserved", so what this module holds is
 * the one answer billing being off actually requires: `GET
 * /reports/analytics?category=revenue` returns the flag-off alternate
 * payload rather than a 404 or a 500 (ADR-018 §2, ADR-037). The other
 * eight categories answer 501 — the route exists, the category is real,
 * and the server has not implemented it.
 *
 * **M21 owns the rest of §12**: the full `AnalyticsSnapshot`, insights,
 * saved and scheduled reports, and exports. It replaces the 501s and
 * keeps this alternate for `revenue` while the flag is off.
 */
@Module({
  imports: [DatabaseModule, AuthzKernelModule],
  controllers: [AnalyticsController, ReportsController],
  providers: [
    AnalyticsService,
    AnalyticsRepository,
    SnapshotService,
    SnapshotRepository,
    InsightService,
    ReportDocumentService,
    ReportExportService,
    SavedReportRepository,
    ReportsJobs,
  ],
})
export class ReportsModule {}
