import * as CFB from 'cfb';
import { unzipSync } from 'fflate';
import { createRequire } from 'node:module';
import { BlobValidationError } from './private-blob-storage';

type XmlTag = {
  local: string;
  uri: string;
  attributes: Record<string, { value: string }>;
};
interface XmlParser {
  on(event: 'doctype', handler: () => void): void;
  on(event: 'opentag', handler: (tag: XmlTag) => void): void;
  on(event: 'closetag', handler: () => void): void;
  write(source: string): XmlParser;
  close(): void;
}
// saxes 6 publishes declarations that fail TS 5.9's generic constraints. Keep
// the runtime parser and type only the three event hooks used here.
const saxesPackage: unknown = createRequire(__filename)('saxes');
const SaxesParser = (
  saxesPackage as { SaxesParser: new (options: { xmlns: true }) => XmlParser }
).SaxesParser;

const signatures = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  {
    mime: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', riff: true },
] as const;

const contentTypesNamespace =
  'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipsNamespace =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const wordNamespace =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const officeDocumentRelationship =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const wordContentType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const requiredParts = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
] as const;
const maxEntryBytes = 50 * 1024 * 1024;
const maxPackageBytes = 100 * 1024 * 1024;
const maxXmlBytes = 2 * 1024 * 1024;

export function detectMimeType(prefix: Buffer, fullBytes?: Buffer): string {
  if (
    prefix.length >= 4 &&
    prefix.readUInt32LE(0) === 0x04034b50 &&
    fullBytes &&
    isWordOpenXml(fullBytes)
  )
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (
    prefix.length >= 8 &&
    prefix
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) &&
    fullBytes &&
    isWordOle(fullBytes)
  )
    return 'application/msword';
  for (const signature of signatures) {
    if ('bytes' in signature) {
      if (
        prefix.length >= signature.bytes.length &&
        signature.bytes.every((value, index) => prefix[index] === value)
      )
        return signature.mime;
      continue;
    }
    if (
      prefix.length >= 12 &&
      prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
      prefix.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      return signature.mime;
  }
  throw new BlobValidationError('Unsupported file signature');
}

function isWordOle(bytes: Buffer): boolean {
  try {
    if (
      bytes.length < 512 ||
      bytes.length > maxEntryBytes ||
      bytes.readUInt16LE(28) !== 0xfffe
    )
      return false;
    const compound = CFB.read(bytes, { type: 'buffer', WTF: true });
    const word = CFB.find(compound, 'WordDocument');
    if (
      !word ||
      word.type !== 2 ||
      !word.content ||
      word.size !== word.content.length ||
      word.size < 32
    )
      return false;
    const stream = Buffer.from(word.content);
    if (stream.readUInt16LE(0) !== 0xa5ec) return false;
    const version = stream.readUInt16LE(2);
    if (version < 0x00c1 || version > 0x0112) return false;
    const flags = stream.readUInt16LE(10);
    if (flags & 0x0100) return false;
    const table = CFB.find(compound, flags & 0x0200 ? '1Table' : '0Table');
    if (
      !table ||
      table.type !== 2 ||
      !table.content ||
      table.size !== table.content.length ||
      table.size < 1
    )
      return false;
    const textStart = stream.readUInt32LE(24);
    const textEnd = stream.readUInt32LE(28);
    return textStart >= 32 && textStart < textEnd && textEnd <= stream.length;
  } catch {
    return false;
  }
}

type ZipEntry = { size: number; crc: number };

function zipDirectory(bytes: Buffer): Map<string, ZipEntry> | null {
  const endStart = Math.max(0, bytes.length - 65557);
  let end = -1;
  for (let at = bytes.length - 22; at >= endStart; at -= 1) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    return null;
  const count = bytes.readUInt16LE(end + 10);
  if (count < 3 || count > 1000 || count !== bytes.readUInt16LE(end + 8))
    return null;
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (directoryStart + directorySize !== end) return null;
  const entries = new Map<string, ZipEntry>();
  let cursor = directoryStart;
  let totalSize = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      return null;
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28);
    const extraSize = bytes.readUInt16LE(cursor + 30);
    const commentSize = bytes.readUInt16LE(cursor + 32);
    const localAt = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressedSize > maxEntryBytes ||
      size > maxEntryBytes ||
      localAt + 30 > directoryStart
    )
      return null;
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameSize)
      .toString('utf8');
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('..') ||
      name.includes('\\') ||
      entries.has(name)
    )
      return null;
    if (
      bytes.readUInt32LE(localAt) !== 0x04034b50 ||
      bytes.readUInt16LE(localAt + 8) !== method
    )
      return null;
    const localNameSize = bytes.readUInt16LE(localAt + 26);
    const localExtraSize = bytes.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + localNameSize + localExtraSize;
    if (
      dataAt + compressedSize > directoryStart ||
      bytes
        .subarray(localAt + 30, localAt + 30 + localNameSize)
        .toString('utf8') !== name
    )
      return null;
    totalSize += size;
    if (
      totalSize > maxPackageBytes ||
      (requiredParts.some((part) => part === name) && size > maxXmlBytes)
    )
      return null;
    entries.set(name, { size, crc });
    cursor = next;
  }
  return cursor === end ? entries : null;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function xmlElements(bytes: Uint8Array): Array<{
  local: string;
  uri: string;
  attributes: Record<string, string>;
  parent: string | null;
}> | null {
  try {
    if (bytes.length > maxXmlBytes) return null;
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parser = new SaxesParser({ xmlns: true });
    const stack: string[] = [];
    const elements: Array<{
      local: string;
      uri: string;
      attributes: Record<string, string>;
      parent: string | null;
    }> = [];
    parser.on('doctype', () => {
      throw new Error('DOCTYPE is forbidden');
    });
    parser.on('opentag', (tag) => {
      const attributes: Record<string, string> = {};
      for (const [name, attribute] of Object.entries(tag.attributes))
        attributes[name] = attribute.value;
      elements.push({
        local: tag.local,
        uri: tag.uri,
        attributes,
        parent: stack.at(-1) ?? null,
      });
      stack.push(tag.local);
    });
    parser.on('closetag', () => {
      stack.pop();
    });
    parser.write(source).close();
    return elements;
  } catch {
    return null;
  }
}

function isWordOpenXml(bytes: Buffer): boolean {
  const entries = zipDirectory(bytes);
  if (!entries || requiredParts.some((part) => !entries.has(part)))
    return false;
  try {
    const unpacked = unzipSync(bytes, {
      filter: (file) => {
        const expected = entries.get(file.name);
        if (!expected || expected.size !== file.originalSize)
          throw new Error('ZIP entry mismatch');
        return true;
      },
    });
    if (Object.keys(unpacked).length !== entries.size) return false;
    for (const [name, expected] of entries) {
      const content = unpacked[name];
      if (
        !content ||
        content.length !== expected.size ||
        crc32(content) !== expected.crc
      )
        return false;
    }
    const types = xmlElements(unpacked['[Content_Types].xml']);
    const relationships = xmlElements(unpacked['_rels/.rels']);
    const document = xmlElements(unpacked['word/document.xml']);
    if (!types || !relationships || !document) return false;
    return (
      types[0]?.local === 'Types' &&
      types[0].uri === contentTypesNamespace &&
      types.some(
        (item) =>
          item.parent === 'Types' &&
          item.local === 'Override' &&
          item.uri === contentTypesNamespace &&
          item.attributes.PartName === '/word/document.xml' &&
          item.attributes.ContentType === wordContentType,
      ) &&
      relationships[0]?.local === 'Relationships' &&
      relationships[0].uri === relationshipsNamespace &&
      relationships.some(
        (item) =>
          item.parent === 'Relationships' &&
          item.local === 'Relationship' &&
          item.uri === relationshipsNamespace &&
          item.attributes.Type === officeDocumentRelationship &&
          item.attributes.Target === 'word/document.xml' &&
          item.attributes.TargetMode !== 'External',
      ) &&
      document[0]?.local === 'document' &&
      document[0].uri === wordNamespace &&
      document.some(
        (item) =>
          item.parent === 'document' &&
          item.local === 'body' &&
          item.uri === wordNamespace,
      )
    );
  } catch {
    return false;
  }
}

export function containsPdfEncryptionToken(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from('/Encrypt', 'ascii'));
}
