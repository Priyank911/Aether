import { describe, expect, it } from 'vitest';
import { encodeNativeMessage, MAX_NATIVE_MESSAGE_BYTES, NativeMessageDecoder } from '../src/framing.js';

describe('native messaging framing', () => {
  it('decodes a frame split across input chunks', () => {
    const decoder = new NativeMessageDecoder();
    const frame = encodeNativeMessage('{"type":"test"}');

    expect(decoder.push(frame.subarray(0, 3))).toEqual([]);
    expect(decoder.hasPartialMessage).toBe(true);
    expect(decoder.push(frame.subarray(3))).toEqual(['{"type":"test"}']);
    expect(decoder.hasPartialMessage).toBe(false);
  });

  it('decodes multiple frames received together', () => {
    const decoder = new NativeMessageDecoder();
    const combined = Buffer.concat([
      encodeNativeMessage('{"id":1}'),
      encodeNativeMessage('{"id":2}'),
    ]);

    expect(decoder.push(combined)).toEqual(['{"id":1}', '{"id":2}']);
  });

  it('rejects zero length and oversized frame headers', () => {
    const decoder = new NativeMessageDecoder();
    const zeroLength = Buffer.alloc(4);
    expect(() => decoder.push(zeroLength)).toThrow('Invalid native message length: 0');

    const oversized = Buffer.alloc(4);
    oversized.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1, 0);
    expect(() => decoder.push(oversized)).toThrow('Invalid native message length');
  });

  it('rejects payloads larger than Chrome native messaging permits', () => {
    expect(() => encodeNativeMessage('x'.repeat(MAX_NATIVE_MESSAGE_BYTES + 1)))
      .toThrow('Invalid native message payload length');
  });
});
