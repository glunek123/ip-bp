import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateExecutionSupplementUploadDto } from './execution-supplement-upload.dto';

const body = {
  expectedRevision: 0,
  originalFilename: '补交.pdf',
  declaredMimeType: 'application/pdf',
};
const errors = (value: unknown) =>
  validateSync(plainToInstance(CreateExecutionSupplementUploadDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('execution supplement upload body', () => {
  it.each([0, 1, 7])(
    'accepts the precise revision %i with file metadata',
    (expectedRevision) => {
      expect(errors({ ...body, expectedRevision })).toHaveLength(0);
    },
  );
  it.each([
    'filingId',
    'supplementId',
    'ownerId',
    'ownerType',
    'category',
    'purpose',
    'actorUserId',
  ])('rejects client-supplied %s outside the route', (field) => {
    expect(errors({ ...body, [field]: 'override' }).length).toBeGreaterThan(0);
  });
  it.each([-1, 0.5, '0', null, undefined])(
    'rejects an invalid revision %s',
    (expectedRevision) => {
      expect(errors({ ...body, expectedRevision }).length).toBeGreaterThan(0);
    },
  );
});
