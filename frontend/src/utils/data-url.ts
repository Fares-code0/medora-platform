/**
 * A `data:` URL as the `Blob` it encodes — what a canvas hands back as a
 * string, ready for a multipart upload.
 *
 * Decoded by hand rather than through `fetch(dataUrl)`: a data URL is not a
 * network request, and routing it through `fetch` would put it in front of
 * every interceptor and test stub that watches the API.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (match === null) throw new Error('Not a data URL');
  const [, mimeType = 'application/octet-stream', base64, payload = ''] = match;
  if (base64 === undefined) {
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}
