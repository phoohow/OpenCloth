import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/base/bytes';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('crc32', () => {
  it('matches the standard check vector', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
  });

  it('returns zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('stays unsigned for high-bit results', () => {
    const value = crc32(encode('opencloth'));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});
