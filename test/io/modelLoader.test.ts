import { describe, expect, it } from 'vitest';
import { detectFormat } from '@/io/importers/modelLoader';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('detectFormat', () => {
  it('uses the file extension when present', () => {
    expect(detectFormat('avatar.glb')).toBe('glb');
    expect(detectFormat('pattern.gltf')).toBe('gltf');
    expect(detectFormat('reference.obj')).toBe('obj');
  });

  it('reads the mime type of a data URL', () => {
    expect(detectFormat('data:model/gltf-binary;base64,AAAA')).toBe('glb');
    expect(detectFormat('data:model/gltf+json;base64,e30=')).toBe('gltf');
  });

  it('sniffs content when the name has no extension', () => {
    expect(detectFormat('data:application/octet-stream;base64,AAAA', new Uint8Array([0x67, 0x6c, 0x54, 0x46]))).toBe('glb');
    expect(detectFormat('embedded', bytes('{"asset":{"version":"2.0"}}'))).toBe('gltf');
    expect(detectFormat('embedded', bytes('v 0 0 0\nf 1 2 3\n'))).toBe('obj');
  });

  it('rejects unknown content', () => {
    expect(() => detectFormat('mystery', bytes('hello'))).toThrow(/Unknown model format/);
  });
});
