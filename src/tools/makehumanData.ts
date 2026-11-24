import { installMakehumanData, parseMakehumanBodyData, type MakehumanManifest } from '@/avatar/makehuman/data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readBuffer(dir: string, name: string): ArrayBuffer {
  const buffer = readFileSync(resolve(dir, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export function installMakehumanDataFromDisk(dir: string): void {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as MakehumanManifest;
  installMakehumanData(parseMakehumanBodyData(readBuffer(dir, 'body.bin'), readBuffer(dir, 'targets.bin'), manifest));
}
