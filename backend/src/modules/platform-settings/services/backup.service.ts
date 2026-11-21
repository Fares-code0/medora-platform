/**
 * Backups and recovery points — API §19.6, RM M24.5.
 *
 * > ✅ Verify: manual backup produces an **artifact** row; restore
 * > requires the documented confirmation and is audited.
 *
 * ## The catalogue is implemented; taking and restoring a backup is not
 *
 * `GET` reads `backups` and is complete. The other two are **blocked**,
 * and for a reason worth stating plainly rather than routing around.
 *
 * A `backups` row is not a backup. It carries `storage_ref` — a pointer
 * into object storage — and `size_mb`, the size of the artifact it points
 * at. Producing that artifact needs two things this milestone does not
 * own: somewhere to put it (**M25**, whose `FILE_STORAGE` port rejects
 * with 503 today, deliberately, so that an id is never handed back for
 * bytes that do not exist) and something to run a database dump outside
 * a request (**M30.2**, the scheduled-job registry, where the roadmap
 * already lists "backup trigger").
 *
 * Writing the row without the artifact is the one failure mode that
 * matters here. An administrator reads this panel at exactly one moment —
 * after something has gone wrong — and a row claiming a recovery point
 * that does not exist is worse than an empty list, which at least tells
 * the truth. So `POST` answers 501 naming both dependencies.
 *
 * Restore is blocked twice over. Beyond the missing artifact, §19.6 marks
 * it `[DERIVED — restore requires out-of-band confirmation policy]`, and
 * **no source states that policy**: not the contract, not the roadmap,
 * not UX. Whether it is a second administrator, a time delay, a signed
 * token or a support ticket is a product decision, and a `confirm: true`
 * boolean invented here would be an in-band confirmation wearing the
 * name of an out-of-band one. See **RA-M24.2**.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import {
  PlatformSettingsRepository,
  type BackupRow,
} from '../repositories/platform-settings.repository';

/** The panel shows a table of recent recovery points, not all history. */
const BACKUP_PAGE = 50;

@Injectable()
export class BackupService {
  constructor(private readonly settings: PlatformSettingsRepository) {}

  /** §19.6 — the catalogue. Implemented. */
  async list() {
    return (await this.settings.backups(BACKUP_PAGE)).map(toView);
  }

  /** §19.6 — manual backup. Blocked on M25 + M30.2; see the header. */
  create(): never {
    throw new AppException(501, {
      message:
        'Taking a backup needs object storage (M25) and the scheduled-job runner (M30.2). Neither exists yet, and a catalogue row without an artifact behind it would be read as a recovery point that is not there.',
      code: 'not_implemented',
      detail: 'RA-M24.2',
    });
  }

  /** §19.6 — restore. Blocked on the same two, plus an unstated policy. */
  restore(): never {
    throw new AppException(501, {
      message:
        'Restoring needs the artifact pipeline (M25 + M30.2) and the out-of-band confirmation policy API §19.6 requires, which no source states.',
      code: 'not_implemented',
      detail: 'RA-M24.2',
    });
  }
}

function toView(row: BackupRow) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    sizeMb: row.sizeMb.toNumber(),
    kind: row.kind.toLowerCase(),
  };
}
