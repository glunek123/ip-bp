import { BadRequestException } from '@nestjs/common';
import { unzipSync } from 'fflate';
import { BlobValidationError, detectMimeType } from '../materials';

export type ImportFolder = {
  name: string;
  photos: { filename: string; bytes: Buffer; mimeType: string }[];
};
const invalid = () =>
  new BadRequestException({
    code: 'INVALID_ZIP',
    message: 'ZIP 文件或目录结构无效',
  });

/** Inspect the central directory before fflate allocates expanded buffers. */
export function parseOpeningImportZip(bytes: Buffer): ImportFolder[] {
  if (bytes.length < 22 || bytes.length > 20 * 1024 * 1024) throw invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (
    count < 1 ||
    count > 120 ||
    directorySize === 0xffffffff ||
    offset + directorySize !== end
  )
    throw invalid();
  let total = 0;
  let files = 0;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const expanded = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const external = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      localOffset === 0xffffffff
    )
      throw invalid();
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    const folded = name.normalize('NFC').toLocaleLowerCase('en-US');
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '.' || part === '..') ||
      names.has(folded) ||
      ((external >>> 16) & 0xf000) === 0xa000
    )
      throw invalid();
    names.add(folded);
    if (!name.endsWith('/')) {
      files += 1;
      if (files > 100) throw invalid();
      if (
        expanded < 1 ||
        expanded > 20 * 1024 * 1024 ||
        compressed < 1 ||
        expanded > compressed * 200
      )
        throw invalid();
      total += expanded;
      if (total > 100 * 1024 * 1024) throw invalid();
    }
    if (
      localOffset + 30 > offset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50 ||
      bytes.readUInt16LE(localOffset + 6) !== flags ||
      bytes.readUInt16LE(localOffset + 8) !== method
    )
      throw invalid();
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if (
      localOffset + 30 + localNameLength + localExtraLength + compressed >
        offset ||
      bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .toString('utf8') !== name
    )
      throw invalid();
    offset = next;
  }
  if (offset !== end) throw invalid();
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(new Uint8Array(bytes));
  } catch {
    throw invalid();
  }
  const folders = new Map<string, ImportFolder>();
  let actualTotal = 0;
  for (const [path, content] of Object.entries(extracted)) {
    if (path.endsWith('/')) continue;
    const parts = path.split('/');
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      parts[0].length > 200 ||
      parts[1].length > 200 ||
      !/\.(jpe?g|png|webp)$/i.test(parts[1])
    )
      throw invalid();
    const photo = Buffer.from(content);
    actualTotal += photo.length;
    if (
      photo.length < 1 ||
      photo.length > 20 * 1024 * 1024 ||
      actualTotal > 100 * 1024 * 1024
    )
      throw invalid();
    let mimeType: string;
    try {
      mimeType = detectMimeType(photo.subarray(0, 12));
    } catch (error) {
      if (error instanceof BlobValidationError) throw invalid();
      throw error;
    }
    const extension = parts[1].split('.').pop()?.toLowerCase();
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ||
      (mimeType === 'image/jpeg' &&
        !['jpg', 'jpeg'].includes(extension ?? '')) ||
      (mimeType === 'image/png' && extension !== 'png') ||
      (mimeType === 'image/webp' && extension !== 'webp')
    )
      throw invalid();
    let folder = folders.get(parts[0]);
    if (!folder) {
      folder = { name: parts[0], photos: [] };
      folders.set(parts[0], folder);
    }
    folder.photos.push({ filename: parts[1], bytes: photo, mimeType });
    if (folder.photos.length > 50 || folders.size > 20) throw invalid();
  }
  if (!folders.size) throw invalid();
  return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name));
}
