import { BadRequestException } from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { LeadCsvImportController } from './lead-csv-import.controller';
import { LeadCsvImportDto } from './lead-csv-import.dto';
import { LeadService } from './lead.service';

describe('LeadCsvImportController', () => {
  const actor = { userId: 'operator' } as ActorContext;
  const body = { items: [] } as LeadCsvImportDto;

  it('passes a trimmed key and unchanged batch to the service', async () => {
    const importBatch = jest.fn().mockResolvedValue({ items: [] });
    const controller = new LeadCsvImportController({
      importBatch,
    } as unknown as LeadService);
    await expect(
      controller.importBatch(actor, ' batch-key ', body),
    ).resolves.toEqual({ items: [] });
    expect(importBatch).toHaveBeenCalledWith(actor, 'batch-key', body);
  });

  it.each([undefined, '', ' ', 'x'.repeat(129)])(
    'rejects missing or oversized key %#',
    (key) => {
      const importBatch = jest.fn();
      const controller = new LeadCsvImportController({
        importBatch,
      } as unknown as LeadService);
      expect(() => controller.importBatch(actor, key, body)).toThrow(
        BadRequestException,
      );
      expect(importBatch).not.toHaveBeenCalled();
    },
  );
});
