import { BadRequestException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { CustomerCaseEntrySourceService } from '../customers';
import { CreateCaseExternalEntryDto } from './case-external-entry.dto';
import { CaseExternalEntryService } from './case-external-entry.service';

const id = '11111111-1111-4111-8111-111111111111';

function validInput(): CreateCaseExternalEntryDto {
  return {
    idempotencyKey: ' raw key ',
    entryKind: 'EXTERNAL_TRANSFER',
    initialStage: 'PENDING_MATCH',
    stageReachedOn: '2026-01-01',
    source: 'Prior firm records',
    reason: 'External transfer',
    customerId: id,
    rightsHolderId: id,
    defendants: [],
    lawyerAccountId: null,
    lawyerProfileId: null,
    known: {
      courtId: null,
      courtCaseNo: null,
      acceptedOn: null,
      secondInstanceAcceptedOn: null,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
  };
}

describe('CaseExternalEntryService input boundary', () => {
  const service = new CaseExternalEntryService(
    {} as DatabaseService,
    {} as AccessControlService,
    {} as CustomerCaseEntrySourceService,
  );

  it('keeps the idempotency key byte-for-byte, including edge spaces', () => {
    expect(service['normalize'](validInput()).idempotencyKey).toBe(' raw key ');
  });

  it.each([
    { known: { courtCaseNo: 42 } },
    { known: { shopName: { fake: true } } },
    { known: { courtId: 42 } },
  ])('rejects malformed known text before string operations', ({ known }) => {
    const input = validInput();
    Object.assign(input.known, known);
    expect(() => service['normalize'](input)).toThrow(BadRequestException);
  });

  it('does not allow a matched party or lawyer in PENDING_MATCH', () => {
    const input = validInput();
    input.defendants = [{ kind: 'PERSON', name: 'Actual party' }];
    expect(() => service['normalize'](input)).toThrow(BadRequestException);
  });
});
