import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';

import type { FileStoragePort, FileUpload, StoredFile } from './file-storage.types';

/**
 * The M2 stub: every operation answers 503 `service_unavailable`.
 *
 * The other two kernels stub with a logger because dropping a log line
 * is harmless. Storage is not: a `put()` that resolves without writing
 * anything would hand the caller a file id for bytes that do not exist,
 * and the failure would surface later as a broken download rather than
 * a failed upload. Failing loudly at the point of the call is the honest
 * behaviour until M25 wires MinIO.
 *
 * 503 is also what the health endpoint already reports for storage
 * (`unconfigured`, API §20.1) — the two agree.
 */
@Injectable()
export class UnconfiguredFileStorage implements FileStoragePort {
  put(_upload: FileUpload): Promise<StoredFile> {
    return Promise.reject(unconfigured());
  }

  signedDownloadUrl(_key: string, _ttlSeconds: number): Promise<string> {
    return Promise.reject(unconfigured());
  }

  get(_key: string): Promise<Buffer> {
    return Promise.reject(unconfigured());
  }

  remove(_key: string): Promise<void> {
    return Promise.reject(unconfigured());
  }
}

function unconfigured(): AppException {
  return new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
    message: 'File storage is not configured',
    code: 'service_unavailable',
    detail: 'Object storage lands at M25',
  });
}
