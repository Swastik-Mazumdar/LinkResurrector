/** Chrome Native Messaging framing: uint32 LE byte length followed by UTF-8 JSON. */
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

export function encodeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_NATIVE_MESSAGE_BYTES) throw new Error('Native message exceeds the configured size limit.');
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function createNativeDecoder(onMessage, onError = () => {}) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_NATIVE_MESSAGE_BYTES) {
        onError(new Error('Invalid Native Messaging frame length.'));
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length < length + 4) return;
      const body = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      try { onMessage(JSON.parse(body.toString('utf8'))); }
      catch { onError(new Error('Malformed Native Messaging JSON.')); }
    }
  };
}
