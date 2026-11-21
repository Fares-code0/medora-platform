/**
 * Request validation for files (API §17, RM M25.1).
 *
 * The upload's only field is the kind — the payload is bytes, and Zod
 * has nothing to say about them. The kind is a closed enum of API
 * §17.1's seven values, which is also `FILE_KINDS` in the storage port,
 * imported rather than re-listed: the `files_kind_check` constraint has
 * an eighth value (`backup_artifact`) that no client may send, and two
 * hand-kept lists would eventually disagree about which.
 */

import { z } from 'zod';

import { FILE_KINDS } from '../../../shared/files';

export const uploadFileSchema = z.object({
  kind: z.enum(FILE_KINDS),
});

export type UploadFileBody = z.infer<typeof uploadFileSchema>;
