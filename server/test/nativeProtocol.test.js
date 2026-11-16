import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeDecoder, encodeNativeMessage, MAX_NATIVE_MESSAGE_BYTES } from '../src/nativeProtocol.js';

test('native framing decodes messages split across chunks and concatenated frames', () => {
  const seen = [];
  const decode = createNativeDecoder((message) => seen.push(message));
  const frames = Buffer.concat([encodeNativeMessage({ a: 1 }), encodeNativeMessage({ b: 'two' })]);
  decode(frames.subarray(0, 3));
  decode(frames.subarray(3, 8));
  decode(frames.subarray(8));
  assert.deepEqual(seen, [{ a: 1 }, { b: 'two' }]);
});

test('native decoder rejects zero and oversized frames', () => {
  const errors = [];
  const decode = createNativeDecoder(() => {}, (error) => errors.push(error));
  const zero = Buffer.alloc(4);
  decode(zero);
  const tooLarge = Buffer.alloc(4);
  tooLarge.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1);
  decode(tooLarge);
  assert.equal(errors.length, 2);
});

test('native encoder enforces frame-size cap', () => {
  assert.throws(() => encodeNativeMessage({ payload: 'x'.repeat(MAX_NATIVE_MESSAGE_BYTES) }), /size limit/);
});
