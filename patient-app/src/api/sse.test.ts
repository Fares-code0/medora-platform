import { readSseFrames, SseParser } from './sse';

async function collect(response: Parameters<typeof readSseFrames>[0]) {
  const frames = [];
  for await (const frame of readSseFrames(response)) frames.push(frame);
  return frames;
}

describe('SseParser', () => {
  it('parses named frames and joins multi-line data', () => {
    const parser = new SseParser();
    expect(parser.push('event: delta\ndata: {"text":"Hi"}\n\ndata: a\ndata: b\n\n')).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'message', data: 'a\nb' },
    ]);
  });

  it('survives a frame split mid-line and mid-terminator, with CRLF', () => {
    const parser = new SseParser();
    const frames = [
      ...parser.push('event: del'),
      ...parser.push('ta\r'),
      ...parser.push('\ndata: x\r\n\r'),
      ...parser.push('\n'),
    ];
    expect(frames).toEqual([{ event: 'delta', data: 'x' }]);
  });

  it('ignores comments and drops a frame that never completed', () => {
    const parser = new SseParser();
    expect(parser.push(': keep-alive\n\nevent: done\ndata: {}')).toEqual([]);
  });
});

describe('readSseFrames', () => {
  it('streams from a readable body', async () => {
    const chunks = [new TextEncoder().encode('event: delta\ndata: 1\n\neve'), new TextEncoder().encode('nt: done\ndata: 2\n\n')];
    let i = 0;
    const cancel = jest.fn(() => Promise.resolve());
    const response = {
      body: {
        getReader: () =>
          ({
            read: () =>
              Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
            cancel,
          }) as unknown as ReadableStreamDefaultReader<Uint8Array>,
      },
      text: () => Promise.reject(new Error('should not be used')),
    };
    expect((await collect(response)).map((f) => f.event)).toEqual(['delta', 'done']);
    expect(cancel).toHaveBeenCalled();
  });

  it('falls back to the whole text when the runtime has no streaming body', async () => {
    const response = { body: null, text: () => Promise.resolve('event: done\ndata: {}\n\n') };
    expect(await collect(response)).toEqual([{ event: 'done', data: '{}' }]);
  });
});
