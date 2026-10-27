import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { LeadImageImportService } from './lead-image-import.service';
import { LeadService } from './lead.service';

const task = {
  id: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
  leadId: '44444444-4444-4444-8444-444444444444',
  productId: '55555555-5555-4555-8555-555555555555',
  rowNumber: 8,
  productNumber: 3,
  url: 'https://example.com/a.png',
  urlSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  contentVersionId: '66666666-6666-4666-8666-666666666666',
  status: 'LEASED',
  attemptCount: 1,
};

describe('LeadImageImportService', () => {
  it('attaches a stored version to only the selected product and records completion', async () => {
    const database = {
      userAccount: {
        findFirst: jest.fn().mockResolvedValue({ authorizationRevision: 7 }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          version: 2,
          status: 'WAITING_PUSH',
          products: [
            {
              screenshots: [
                { contentVersionId: '77777777-7777-4777-8777-777777777777' },
              ],
            },
          ],
        }),
      },
      leadImageImportTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseService;
    const leads = {
      updateProductScreenshots: jest.fn().mockResolvedValue({}),
    } as unknown as LeadService;
    const service = new LeadImageImportService(
      database,
      {} as AccessControlService,
      {} as MaterialService,
      leads,
      jest.fn(),
    );
    await service['process'](task as never);
    expect(leads.updateProductScreenshots).toHaveBeenCalledWith(
      {
        userId: task.actorUserId,
        departmentId: task.departmentId,
        authorizationRevision: 7,
      },
      task.leadId,
      task.productId,
      {
        expectedVersion: 2,
        screenshotContentVersionIds: [
          '77777777-7777-4777-8777-777777777777',
          task.contentVersionId,
        ],
      },
    );
    expect(database.leadImageImportTask.updateMany).toHaveBeenLastCalledWith({
      where: { id: task.id, status: 'LEASED' },
      data: { status: 'ATTACHED', leaseUntil: null, failureCode: null },
    });
  });

  it('does not attach the same version twice after a crash', async () => {
    const database = {
      userAccount: {
        findFirst: jest.fn().mockResolvedValue({ authorizationRevision: 7 }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          version: 3,
          status: 'WAITING_PUSH',
          products: [
            { screenshots: [{ contentVersionId: task.contentVersionId }] },
          ],
        }),
      },
      leadImageImportTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseService;
    const leads = {
      updateProductScreenshots: jest.fn(),
    } as unknown as LeadService;
    const service = new LeadImageImportService(
      database,
      {} as AccessControlService,
      {} as MaterialService,
      leads,
      jest.fn(),
    );
    await service['process'](task as never);
    expect(leads.updateProductScreenshots).not.toHaveBeenCalled();
  });
});
