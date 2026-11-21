import { describe, expect, it } from 'vitest';

import { dataUrlToBlob } from './data-url';

// jsdom's Blob has no `arrayBuffer()`; FileReader is what it does implement.
function bytesOf(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(new Error('Could not read the blob'));
    reader.readAsArrayBuffer(blob);
  });
}

describe('dataUrlToBlob', () => {
  it('decodes a base64 PNG with its type', async () => {
    // The 8-byte PNG signature.
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(blob.type).toBe('image/png');
    expect(await bytesOf(blob)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('decodes a percent-encoded payload', async () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20there');
    expect(String.fromCharCode(...(await bytesOf(blob)))).toBe('hello there');
  });

  it('refuses a string that is not a data URL', () => {
    expect(() => dataUrlToBlob('https://example.test/photo.png')).toThrow('Not a data URL');
  });
});
