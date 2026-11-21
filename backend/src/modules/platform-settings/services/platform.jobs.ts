/**
 * The backup schedule (RM M30.2) — registered, blocked.
 *
 * > API §19.6, and M30.2's "backup trigger".
 *
 * `BackupService` already refuses a *manual* backup for this reason, in
 * its own words: "Taking a backup needs object storage (M25) and the
 * scheduled-job runner (M30.2). Neither exists yet, and a catalogue row
 * without an artifact behind it would be read as a recovery point that
 * is not there."
 *
 * Half of that is now false — the runner is this milestone — and the
 * other half is not. Object storage is bound, but **there is no code
 * that produces a backup artefact**: no dump is taken, nothing is
 * uploaded, and `backups` has no row-writing path behind it. A scheduled
 * job that ran would therefore do one of two things, and both are worse
 * than not running: write a catalogue row for an artefact that does not
 * exist, which is a recovery point an administrator would rely on in an
 * incident; or dead-letter nightly, which trains everyone to ignore the
 * dead-letter list.
 *
 * Registering it blocked keeps the third option honest: the schedule is
 * on the operator's screen with the reason beside it.
 *
 * 01:00 UTC is the slot it will take — before the expiry sweep at 02:00,
 * so a backup is a snapshot of the day that ended rather than of a day
 * the sweeps have already started editing.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, JobRegistry } from '../../../shared/jobs';

@Injectable()
export class PlatformJobs implements OnModuleInit {
  constructor(private readonly registry: JobRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'platform-settings.backup-run',
      summary: 'Takes the scheduled platform backup (API §19.6).',
      schedule: dailyAtUtc(1, 0),
      blocked: {
        reason:
          'Nothing produces a backup artefact: no dump is taken and nothing is uploaded, so a run could only write a `backups` row for a recovery point that does not exist.',
        unblockedBy: 'The backup artefact pipeline behind `BackupService`',
      },
    });
  }
}
