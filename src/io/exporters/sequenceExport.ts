import type { CachedFrame } from '@/io/frames';

import { downloadBlob } from '@/base/platform';
import { buildZip, type ZipEntry } from '@/io/zip';

export function frameObjText(positions: Float32Array, indices: Uint32Array, label: string): string {
  const lines: string[] = [`# ${label}`, `# vertices ${positions.length / 3}`, `# faces ${indices.length / 3}`];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i]!.toFixed(4)} ${positions[i + 1]!.toFixed(4)} ${positions[i + 2]!.toFixed(4)}`);
  }

  for (let i = 0; i < indices.length; i += 3) {
    lines.push(`f ${indices[i]! + 1} ${indices[i + 1]! + 1} ${indices[i + 2]! + 1}`);
  }

  return lines.join('\n') + '\n';
}

export function sequenceArchive(frames: readonly CachedFrame[], indices: Uint32Array): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = frames.map(frame => ({
    name: `frames/frame_${String(frame.index).padStart(4, '0')}.obj`,
    data: encoder.encode(frameObjText(frame.positions, indices, `OpenCloth frame ${frame.index}`)),
  }));
  const meta = {
    frameCount: frames.length,
    vertexCount: frames.length > 0 ? frames[0]!.positions.length / 3 : 0,
    faceCount: indices.length / 3,
    frames: frames.map(frame => ({ index: frame.index, timeSeconds: frame.timeSeconds })),
  };
  entries.push({ name: 'meta.json', data: encoder.encode(JSON.stringify(meta, null, 2)) });
  return buildZip(entries);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  downloadBlob(new Blob([copy.buffer], { type }), filename);
}
