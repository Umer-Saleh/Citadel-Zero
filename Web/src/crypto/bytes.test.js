import { describe, test, expect } from 'vitest';
import { toBase64, fromBase64, toHex, fromHex, utf8, fromUtf8 } from './bytes';

describe('byte helpers', () => {
  test('base64 round-trips', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  test('base64 matches Node output for a known value', () => {
    // Buffer.from('hello').toString('base64') === 'aGVsbG8='
    expect(toBase64(utf8('hello'))).toBe('aGVsbG8=');
  });

  test('hex round-trips', () => {
    const bytes = new Uint8Array([0, 15, 16, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  test('hex matches the expected format', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  test('utf8 round-trips, including non-ASCII', () => {
    const s = 'hello — café 🔐';
    expect(fromUtf8(utf8(s))).toBe(s);
  });

  test('high bytes survive base64', () => {
    // The binary-string workaround breaks if charCodeAt returns
    // values above 255, so verify the full byte range.
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(fromBase64(toBase64(all))).toEqual(all);
  });
});