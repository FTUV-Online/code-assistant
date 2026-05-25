export type SSEEvent = { event: string; data: string };

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  let data = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const rawLine = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const line = rawLine.replace(/\r$/, '');

        if (line === '') {
          if (data) yield { event, data };
          event = 'message';
          data = '';
          continue;
        }
        if (line.startsWith(':')) continue;

        const sep = line.indexOf(':');
        const field = sep === -1 ? line : line.slice(0, sep);
        let val = sep === -1 ? '' : line.slice(sep + 1);
        if (val.startsWith(' ')) val = val.slice(1);

        if (field === 'event') event = val;
        else if (field === 'data') data = data ? data + '\n' + val : val;
      }
    }
    if (data) yield { event, data };
  } finally {
    reader.releaseLock();
  }
}
