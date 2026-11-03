import { zipSync } from 'fflate';
import { parseOpeningImportZip } from './notary-opening-import-zip';
import { NotaryOpeningRecognition } from './notary-opening-recognition';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1]);
const archive = (entries: Record<string, Uint8Array>) =>
  Buffer.from(zipSync(entries, { level: 0 }));
describe('opening import ZIP boundary', () => {
  it('accepts only photos in parcel folders', () => {
    const folders = parseOpeningImportZip(
      archive({ 'parcel/MOCK20261103001.png': png }),
    );
    expect(folders).toMatchObject([
      {
        name: 'parcel',
        photos: [{ filename: 'MOCK20261103001.png', mimeType: 'image/png' }],
      },
    ]);
  });
  it('rejects traversal, nested files and disguised MIME', () => {
    expect(() =>
      parseOpeningImportZip(archive({ '../escape.png': png })),
    ).toThrow();
    expect(() =>
      parseOpeningImportZip(archive({ 'parcel/nested/a.png': png })),
    ).toThrow();
    expect(() =>
      parseOpeningImportZip(archive({ 'parcel/a.jpg': png })),
    ).toThrow();
    try {
      parseOpeningImportZip(
        archive({ 'parcel/bad.png': Uint8Array.from([1, 2, 3, 4]) }),
      );
      throw new Error('Expected bad signature rejection');
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        response: { code: 'INVALID_ZIP' },
      });
    }
    expect(() =>
      parseOpeningImportZip(
        archive({ 'parcel/é.png': png, 'parcel/e\u0301.png': png }),
      ),
    ).toThrow();
  });
  it('rejects more than 100 actual files before inflation', () => {
    const files = Object.fromEntries(
      Array.from({ length: 101 }, (_, n) => [`parcel/${n}.png`, png]),
    );
    expect(() => parseOpeningImportZip(archive(files))).toThrow();
  });
});
describe('local recognition adapter', () => {
  it('keeps disabled mode free of candidate claims', async () => {
    const prior = process.env.NOTARY_OPENING_RECOGNITION_MODE;
    delete process.env.NOTARY_OPENING_RECOGNITION_MODE;
    try {
      await expect(
        new NotaryOpeningRecognition().recognize({
          photos: [
            {
              filename: 'MOCK20261103001.png',
              mimeType: 'image/png',
              bytes: png,
            },
          ],
        }),
      ).resolves.toEqual({
        status: 'DISABLED',
        trackingCandidate: null,
        senderCandidate: null,
      });
    } finally {
      if (prior === undefined)
        delete process.env.NOTARY_OPENING_RECOGNITION_MODE;
      else process.env.NOTARY_OPENING_RECOGNITION_MODE = prior;
    }
  });
  it('uses an explicit synthetic filename in MOCK mode', async () => {
    const prior = process.env.NOTARY_OPENING_RECOGNITION_MODE;
    process.env.NOTARY_OPENING_RECOGNITION_MODE = 'mock';
    try {
      await expect(
        new NotaryOpeningRecognition().recognize({
          photos: [
            {
              filename: 'MOCK20261103001.png',
              mimeType: 'image/png',
              bytes: png,
            },
          ],
        }),
      ).resolves.toMatchObject({
        status: 'SUCCEEDED',
        trackingCandidate: 'MOCK20261103001',
      });
    } finally {
      if (prior === undefined)
        delete process.env.NOTARY_OPENING_RECOGNITION_MODE;
      else process.env.NOTARY_OPENING_RECOGNITION_MODE = prior;
    }
  });
});
