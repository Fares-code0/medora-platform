import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

/** Metadata key holding the multipart field name a route reads its file from. */
export const FILE_UPLOAD_FIELD_METADATA = 'medora:file-upload-field';

/**
 * A single-file multipart upload read from `field`.
 *
 * Exactly `UseInterceptors(FileInterceptor(field))`, plus the field name
 * recorded as metadata. The interceptor keeps the name in a closure, so
 * without this the OpenAPI generator could not see that the route is
 * multipart, or which part carries the bytes, and documented it as JSON.
 */
export function FileUpload(field: string): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(FILE_UPLOAD_FIELD_METADATA, field),
    UseInterceptors(FileInterceptor(field)),
  );
}
