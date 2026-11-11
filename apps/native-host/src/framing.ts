export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

export class NativeMessageDecoder {
  private buffer = Buffer.alloc(0);

  public push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];

    while (this.buffer.length >= 4) {
      const messageLength = this.buffer.readUInt32LE(0);
      if (messageLength === 0 || messageLength > MAX_NATIVE_MESSAGE_BYTES) {
        this.buffer = Buffer.alloc(0);
        throw new Error(`Invalid native message length: ${messageLength}`);
      }
      if (this.buffer.length < messageLength + 4) break;
      messages.push(this.buffer.subarray(4, messageLength + 4).toString('utf8'));
      this.buffer = this.buffer.subarray(messageLength + 4);
    }

    if (this.buffer.length > MAX_NATIVE_MESSAGE_BYTES + 4) {
      this.buffer = Buffer.alloc(0);
      throw new Error('Native message buffer exceeded the 1 MiB limit');
    }
    return messages;
  }

  public get hasPartialMessage(): boolean {
    return this.buffer.length > 0;
  }
}

export function encodeNativeMessage(message: string): Buffer {
  const payload = Buffer.from(message, 'utf8');
  if (payload.length === 0 || payload.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new Error(`Invalid native message payload length: ${payload.length}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
