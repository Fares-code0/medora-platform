import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

/**
 * Response compression (RM M32.3) — `compression` 1.8, the Express
 * project's own middleware.
 *
 * ## What is compressed
 *
 * Negotiated per request from `Accept-Encoding`: brotli (quality 4, the
 * library's default — fast enough for an API, unlike brotli's maximum of
 * 11), then gzip (zlib's default level 6). A client that offers neither
 * gets the identity body, unchanged. `Vary: Accept-Encoding` is set on
 * every response the middleware considers, so a shared cache never serves
 * one client another's encoding.
 *
 * Only bodies of at least {@link COMPRESSION_THRESHOLD_BYTES}, and only
 * compressible types (the library's `compressible` list: JSON, CSV, text).
 * Below a kilobyte the CPU spent outweighs the bytes saved — the badge
 * poll, the hottest request, is ~60 bytes and is never touched.
 *
 * ## What is never compressed, and why
 *
 * - **Server-Sent Events** (`text/event-stream`, the AI assistant's token
 *   stream, M16.4). Compression buffers to fill a block, which would hold
 *   back the deltas the stream exists to deliver one by one.
 * - **`/api/v1/auth/*`.** Those bodies carry access and refresh tokens.
 *   Compressing a secret beside attacker-influenced bytes is the BREACH
 *   precondition; the other routes authenticate by bearer header, which a
 *   cross-site page cannot make a browser send, but the refresh route is
 *   cookie-authenticated. The bodies are a few hundred bytes, so nothing
 *   is lost by leaving them alone.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

const AUTH_PREFIX = '/api/v1/auth/';

/** The filter `compression` asks before it encodes a response. Exported for its tests. */
export function shouldCompress(request: Request, response: Response): boolean {
  const type = response.getHeader('Content-Type');
  if (typeof type === 'string' && type.toLowerCase().startsWith('text/event-stream')) return false;
  if (request.originalUrl.startsWith(AUTH_PREFIX)) return false;

  return compression.filter(request, response);
}

/**
 * Registered after the HTTP metrics (so a request is still counted with
 * its full duration) and before the body parsers and routes (so every
 * route's body passes through it).
 */
export function applyCompression(app: NestExpressApplication): void {
  app.use(compression({ threshold: COMPRESSION_THRESHOLD_BYTES, filter: shouldCompress }));
}
