import { detectMimeType } from './file-signature';
import * as CFB from 'cfb';
import { zipSync } from 'fflate';

function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(entries)) {
    const fileName = Buffer.from(name);
    const payload = Buffer.from(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + payload.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('Office file signatures', () => {
  const contentTypes =
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const relationships =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const document =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>';
  const realDocx = Buffer.from(
    zipSync(
      {
        '[Content_Types].xml': Buffer.from(contentTypes),
        '_rels/.rels': Buffer.from(relationships),
        'word/document.xml': Buffer.from(document),
      },
      { level: 0 },
    ),
  );
  const compound = CFB.utils.cfb_new();
  const wordStream = Buffer.alloc(4096);
  wordStream.writeUInt16LE(0xa5ec, 0);
  wordStream.writeUInt16LE(0x00d9, 2);
  wordStream.writeUInt32LE(512, 24);
  wordStream.writeUInt32LE(1024, 28);
  CFB.utils.cfb_add(compound, 'WordDocument', wordStream);
  CFB.utils.cfb_add(compound, '0Table', Buffer.alloc(4096, 1));
  const realDoc = Buffer.from(CFB.write(compound, { type: 'buffer' }));
  const ole = Buffer.alloc(512 * 5);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole);
  ole.writeUInt16LE(3, 26);
  ole.writeUInt16LE(0xfffe, 28);
  ole.writeUInt16LE(9, 30);
  ole.writeUInt16LE(6, 32);
  ole.writeUInt32LE(1, 44);
  ole.writeUInt32LE(1, 48);
  ole.writeUInt32LE(4096, 56);
  ole.writeUInt32LE(0xfffffffe, 60);
  ole.writeUInt32LE(0xfffffffe, 68);
  ole.writeUInt32LE(0, 76);
  for (let i = 1; i < 109; i += 1) ole.writeUInt32LE(0xffffffff, 76 + i * 4);
  [0xfffffffd, 0xfffffffe, 0xfffffffe, 0xfffffffe].forEach((value, i) =>
    ole.writeUInt32LE(value, 512 + i * 4),
  );
  function directory(
    index: number,
    name: string,
    type: number,
    sector: number,
  ) {
    const at = 1024 + index * 128;
    Buffer.from(`${name}\0`, 'utf16le').copy(ole, at);
    ole.writeUInt16LE((name.length + 1) * 2, at + 64);
    ole.writeUInt8(type, at + 66);
    ole.writeUInt32LE(sector, at + 116);
    ole.writeUInt32LE(type === 2 ? 512 : 0, at + 120);
  }
  directory(0, 'Root Entry', 5, 0xfffffffe);
  directory(1, 'WordDocument', 2, 2);
  directory(2, '0Table', 2, 3);
  ole.writeUInt16LE(0xa5ec, 1536);
  ole.writeUInt16LE(0x00c1, 1538);
  const valid = zip({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  });
  it('rejects an OOXML-looking ZIP with invalid CRC fields', () => {
    expect(() => detectMimeType(valid.subarray(0, 12), valid)).toThrow(
      'Unsupported',
    );
  });
  it('recognizes a structurally valid generated OOXML package and rejects a CRC mismatch', () => {
    expect(detectMimeType(realDocx.subarray(0, 12), realDocx)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const corrupted = Buffer.from(realDocx);
    corrupted[corrupted.indexOf(Buffer.from('<w:body>')) + 3] ^= 1;
    expect(() => detectMimeType(corrupted.subarray(0, 12), corrupted)).toThrow(
      'Unsupported',
    );
  });
  it('recognizes a generated OLE compound Word document and rejects a missing table stream', () => {
    expect(detectMimeType(realDoc.subarray(0, 12), realDoc)).toBe(
      'application/msword',
    );
    const withoutTable = CFB.utils.cfb_new();
    CFB.utils.cfb_add(withoutTable, 'WordDocument', wordStream);
    const invalid = Buffer.from(CFB.write(withoutTable, { type: 'buffer' }));
    expect(() => detectMimeType(invalid.subarray(0, 12), invalid)).toThrow(
      'Unsupported',
    );
  });
  it('rejects arbitrary ZIP archives even with a DOCX filename supplied by the caller', () => {
    const bytes = zip({ 'readme.txt': 'not a Word document' });
    expect(() => detectMimeType(bytes.subarray(0, 12), bytes)).toThrow(
      'Unsupported',
    );
  });
  it('rejects an invalid OLE mini-stream even when WordDocument and table names exist', () => {
    expect(() => detectMimeType(ole.subarray(0, 12), ole)).toThrow(
      'Unsupported',
    );
    const spoof = Buffer.from(ole);
    spoof.writeUInt16LE(0, 1536);
    expect(() => detectMimeType(spoof.subarray(0, 12), spoof)).toThrow(
      'Unsupported',
    );
  });
  it('rejects malformed OOXML even when its text includes the expected tag names', () => {
    const broken = zip({
      '[Content_Types].xml':
        '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':
        '<Relationships><Relationship Type="officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': '<w:document><w:body></w:document>',
    });
    expect(() => detectMimeType(broken.subarray(0, 12), broken)).toThrow(
      'Unsupported',
    );
  });
});
