/** One file stored in the archive without compression. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of a byte buffer, as ZIP archives store it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;

/** Largest archive this writer supports: 65535 entries and 4 GiB of offsets, the ZIP32 limits. */
const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

/**
 * Builds an uncompressed ZIP archive (method 0). File names are UTF-8 and timestamps
 * are fixed, so identical entries always produce identical bytes.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP 条目过多：${entries.length} 条，上限 ${MAX_ENTRIES} 条`);
  }
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    if (offset + 30 + name.length + entry.data.length > MAX_OFFSET) {
      throw new Error('ZIP 超过 4 GiB，当前写入方式（ZIP32）放不下；请缩小序列范围');
    }
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, VERSION, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, VERSION, true);
    headerView.setUint16(6, VERSION, true);
    headerView.setUint16(8, UTF8_FLAG, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, 0, true);
    headerView.setUint16(14, 0x21, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, entry.data.length, true);
    headerView.setUint32(24, entry.data.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint16(30, 0, true);
    headerView.setUint16(32, 0, true);
    headerView.setUint16(34, 0, true);
    headerView.setUint16(36, 0, true);
    headerView.setUint32(38, 0, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += local.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...central, eocd]) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}
