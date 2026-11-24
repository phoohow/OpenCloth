import { crc32 } from '@/base/bytes';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export function writePng(filePath: string, width: number, height: number, rgb: Uint8Array): void {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }

  const chunks: Uint8Array[] = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk('IHDR', ihdr(width, height)));
  chunks.push(chunk('IDAT', deflateSync(raw)));
  chunks.push(chunk('IEND', new Uint8Array(0)));
  writeFileSync(filePath, Buffer.concat(chunks));
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8;
  data[9] = 2;
  return data;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
