import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import {
  Prisma,
  type LeadBatchPushReceipt,
  type LeadCsvImportReceipt,
  type LeadNoEvidenceBatchReceipt,
} from '../../generated/prisma/client';
import { isUUID } from 'class-validator';
import { NotaryMatterStage } from '../../generated/prisma/enums';
import {
  MaterialService,
  type MaterialTransactionClient,
  type ValidatedMaterialVersionFact,
} from '../materials';
import {
  allocateCustomerDailyNumber,
  resolveHistoricalNumber,
} from '../business-numbering';
import {
  CASE_TYPE_OPTIONS,
  CASE_TYPES,
  INFRINGEMENT_TYPE_OPTIONS,
  INFRINGEMENT_TYPES,
  LEAD_STATUSES,
  LeadPlatform,
  LeadSource,
  LeadStatus,
  PLATFORM_OPTIONS,
  PLATFORMS,
  SOURCE_OPTIONS,
  SOURCES,
} from './lead.constants';
import {
  ApplyLeadWithdrawalDto,
  DecideLeadEvidenceDto,
  CreateLeadCommand,
  PushLeadDto,
  UpdateLeadDto,
  UpdateLeadProductScreenshotsDto,
} from './lead.dto';
import { LeadBatchPushDto } from './lead-batch-push.dto';
import {
  LeadNoEvidenceBatchDto,
  LeadNoEvidenceBatchItemDto,
} from './lead-no-evidence-batch.dto';
import { LeadNoEvidenceBatchResponseDto } from './lead-no-evidence-batch-response.dto';
import { LeadCsvImportDto, LeadCsvImportInputDto } from './lead-csv-import.dto';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const leadInclude = {
  products: {
    orderBy: { position: 'asc' as const },
    include: {
      screenshots: { orderBy: { createdAt: 'asc' as const } },
      notarySelections: true,
    },
  },
  infringements: { orderBy: { type: 'asc' as const } },
  pushedBy: { select: { displayName: true } },
  reviewDecision: {
    select: {
      result: true,
      reason: true,
      archiveType: true,
      archivedAt: true,
      reviewerDisplayNameSnapshot: true,
      decidedAt: true,
    },
  },
  evidenceDecision: {
    select: {
      id: true,
      result: true,
      reason: true,
      actorDisplayNameSnapshot: true,
      decidedAt: true,
      archiveType: true,
      archivedAt: true,
      fromVersion: true,
      toVersion: true,
    },
  },
} satisfies Prisma.LeadInclude;

const leadReadInclude = {
  ...leadInclude,
  customer: { select: { name: true } },
  rightsHolder: { select: { name: true } },
  responsibleMembership: {
    select: { user: { select: { displayName: true } } },
  },
} satisfies Prisma.LeadInclude;

const leadDetailInclude = {
  ...leadReadInclude,
  notaryMatters: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      businessNo: true,
      stage: true,
      batchPurpose: true,
      createdAt: true,
      notaryOffice: { select: { name: true } },
    },
  },
  reviewDecisions: {
    select: {
      id: true,
      result: true,
      reason: true,
      archiveType: true,
      archivedAt: true,
      reviewerDisplayNameSnapshot: true,
      decidedAt: true,
      fromVersion: true,
      toVersion: true,
    },
  },
  withdrawalApplications: {
    select: {
      id: true,
      originalDecisionId: true,
      reason: true,
      appliedAt: true,
      fromVersion: true,
      toVersion: true,
      resultSnapshot: true,
      confirmation: {
        select: {
          id: true,
          confirmedAt: true,
          fromVersion: true,
          toVersion: true,
        },
      },
    },
  },
} satisfies Prisma.LeadInclude;

type LeadRecord = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;
type LeadReadRecord = Prisma.LeadGetPayload<{
  include: typeof leadReadInclude;
}>;
type LeadDetailRecord = Prisma.LeadGetPayload<{
  include: typeof leadDetailInclude;
}>;
type LeadProductResponse = {
  id: string;
  position: number;
  url: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string;
  commentCount: number;
  estimatedAmount: string;
  screenshotContentVersionIds: string[];
};
type LeadResponse = {
  id: string;
  businessNo: string;
  departmentId: string;
  customerId: string;
  rightsHolderId: string;
  responsibleUserId: string;
  teamId: string | null;
  status: LeadRecord['status'];
  caseType: LeadRecord['caseType'];
  infringementTypes: LeadRecord['infringements'][number]['type'][];
  source: LeadRecord['source'];
  platform: LeadRecord['platform'];
  foundAt: string;
  shopName: string;
  shopExternalId: string | null;
  needDisclose: boolean;
  remark: string | null;
  creationChannel: LeadRecord['creationChannel'];
  externalSourceRef: string | null;
  products: LeadProductResponse[];
  leadScreenshotContentVersionIds: string[];
  version: number;
  pushedAt: string | null;
  pushedByUserId: string | null;
  pushedByDisplayName: string | null;
  reviewDecision:
    | { result: 'INFRINGEMENT'; reviewerDisplayName: string; decidedAt: string }
    | {
        result: 'NO_INFRINGEMENT';
        reason: string;
        reviewerDisplayName: string;
        decidedAt: string;
        archiveType: 'NO_INFRINGEMENT';
        archivedAt: string;
      }
    | null;
  evidenceDecision: {
    result: 'NO_EVIDENCE';
    reason: string;
    decidedByDisplayName: string;
    decidedAt: string;
    archiveType: 'NO_EVIDENCE';
    archivedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type ProductInput = CreateLeadCommand['products'][number];
type NormalizedBusiness = Omit<
  CreateLeadCommand,
  'reservedLeadId' | 'customerId' | 'rightsHolderId' | 'products'
> & {
  products: Array<
    ProductInput & {
      url: string | null;
      title: string | null;
      estimatedAmount: Prisma.Decimal;
    }
  >;
  shopExternalId: string | null;
  remark: string | null;
  foundAtDate: Date;
};

type Receipt = {
  requestFingerprint: string;
  resultLeadId: string;
  resultLeadVersion: number;
  resultSnapshot: unknown;
};

type LeadPushResponse = {
  id: string;
  businessNo: string;
  status: 'WAITING_REVIEW';
  version: number;
  pushedAt: string;
  pushedByUserId: string;
  pushedByDisplayName: string;
};
type LeadBatchPushResponse = { items: LeadPushResponse[] };
type LeadBatchFailure = { index: number; code: string };
type LeadCsvImportResponse = {
  items: Array<{ rowNumber: number; lead: LeadResponse }>;
};
type LeadCsvFailure = { index: number; rowNumber: number; code: string };
const csvRequiredInputKeys = [
  'customerId',
  'rightsHolderId',
  'caseType',
  'infringementTypes',
  'source',
  'platform',
  'foundAt',
  'shopName',
  'needDisclose',
  'products',
  'leadScreenshotContentVersionIds',
] as const;
const csvInputKeys = new Set<string>([
  ...csvRequiredInputKeys,
  'shopExternalId',
  'remark',
]);
const csvProductKeys = new Set([
  'url',
  'title',
  'quantity',
  'unitPrice',
  'commentCount',
]);

type LeadWithdrawalApplicationResponse = {
  id: string;
  leadId: string;
  status: 'ARCHIVED';
  version: number;
  reason: string;
  applicantDisplayName: string;
  appliedAt: string;
};

type LeadEvidenceDecisionResponse = {
  id: string;
  leadId: string;
  status: 'ARCHIVED';
  version: number;
  result: 'NO_EVIDENCE';
  reason: string;
  decidedByDisplayName: string;
  decidedAt: string;
  archiveType: 'NO_EVIDENCE';
  archivedAt: string;
};

type EvidenceDecisionLead = {
  id: string;
  departmentId: string;
  customerId: string;
  responsibleUserId: string;
  teamId: string | null;
  status: string;
  version: number;
  activeReviewDecisionId: string | null;
  reviewDecision: { id: string; result: string } | null;
};

@Injectable()
export class LeadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: MaterialService,
  ) {}

  async formContext(actor: ActorContext) {
    try {
      if (!(await this.access.canAuthorizeNewLead(actor)))
        throw this.actionForbidden();
      const customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
      );
      const customers = await this.database.customer.findMany({
        where: {
          ...customerScope,
          profileStatus: 'ADMITTED',
          cooperationStatus: 'COOPERATING',
          deletedAt: null,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          rightsHolderLinks: {
            orderBy: { id: 'asc' },
            select: { rightsHolder: { select: { id: true, name: true } } },
          },
        },
      });
      return {
        customers: customers.map((customer) => ({
          id: customer.id,
          name: customer.name,
          rightsHolders: customer.rightsHolderLinks.map(
            (link) => link.rightsHolder,
          ),
        })),
        dictionaries: {
          caseTypes: CASE_TYPE_OPTIONS,
          infringementTypes: INFRINGEMENT_TYPE_OPTIONS,
          sources: SOURCE_OPTIONS,
          platforms: PLATFORM_OPTIONS,
        },
      };
    } catch (error) {
      throw this.mapAuthorization(error);
    }
  }

  async filterOptions(
    actor: ActorContext,
    kind: 'customer' | 'rightsHolder',
    q: string,
    view?: 'LIBRARY',
    status?: LeadStatus,
    context?: 'NOTARY',
    notaryStage?: string,
  ) {
    if (context === 'NOTARY') {
      if (
        actor.clientCustomerId !== undefined ||
        actor.notaryOfficeId !== undefined ||
        actor.lawyerAccountId !== undefined
      )
        throw this.actionForbidden();
      const account = await this.database.userAccount.findUnique({
        where: { id: actor.userId },
        select: { accountType: true, active: true },
      });
      if (account?.accountType !== 'INTERNAL' || account.active !== true)
        throw this.actionForbidden();
    }
    let scope: Prisma.LeadWhereInput;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const leadWhere: Prisma.LeadWhereInput = {
      AND: [
        scope,
        ...(view === 'LIBRARY'
          ? [{ status: { not: 'TRANSFERRED_TO_NOTARY' as const } }]
          : []),
        ...(status ? [{ status }] : []),
        ...(context === 'NOTARY'
          ? [
              {
                notaryMatters: {
                  some: {
                    departmentId: actor.departmentId,
                    ...(notaryStage
                      ? { stage: notaryStage as NotaryMatterStage }
                      : {}),
                  },
                },
              },
            ]
          : []),
      ],
    };
    const name = q.trim()
      ? {
          contains: q.trim().replace(/[\\%_]/g, '\\$&'),
          mode: 'insensitive' as const,
        }
      : undefined;
    const where = {
      departmentId: actor.departmentId,
      leads: { some: leadWhere },
      ...(name ? { name } : {}),
    };
    const rows =
      kind === 'customer'
        ? await this.database.customer.findMany({
            where,
            select: { id: true, name: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: 20,
          })
        : await this.database.rightsHolder.findMany({
            where,
            select: { id: true, name: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: 20,
          });
    return { items: rows };
  }

  async list(
    actor: ActorContext,
    page: number,
    pageSize: number,
    status?: LeadStatus,
    view?: 'LIBRARY',
    q?: string,
    filters: {
      customerId?: string;
      rightsHolderId?: string;
      shopName?: string;
    } = {},
  ) {
    if (view === 'LIBRARY' && status === 'TRANSFERRED_TO_NOTARY')
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '已移交线索不属于线索库',
      });
    let scope;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const viewScope =
      view === 'LIBRARY'
        ? { ...scope, status: { not: 'TRANSFERRED_TO_NOTARY' as const } }
        : scope;
    const keyword = q?.trim();
    const match = keyword
      ? {
          contains: keyword.replace(/[\\%_]/g, '\\$&'),
          mode: 'insensitive' as const,
        }
      : undefined;
    const shopName = filters.shopName?.trim();
    const visibleScope: Prisma.LeadWhereInput = {
      AND: [
        viewScope,
        ...(match
          ? [
              {
                OR: [
                  { businessNo: match },
                  { shopName: match },
                  { products: { some: { title: match } } },
                ],
              },
            ]
          : []),
        ...(filters.customerId ? [{ customerId: filters.customerId }] : []),
        ...(filters.rightsHolderId
          ? [{ rightsHolderId: filters.rightsHolderId }]
          : []),
        ...(shopName
          ? [
              {
                shopName: {
                  contains: shopName.replace(/[\\%_]/g, '\\$&'),
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
      ],
    };
    const itemScope =
      status === undefined ? visibleScope : { ...visibleScope, status };
    const [items, total, groups, create] = await Promise.all([
      this.database.lead.findMany({
        where: itemScope,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: leadReadInclude,
      }),
      this.database.lead.count({ where: itemScope }),
      this.database.lead.groupBy({
        by: ['status'],
        where: visibleScope,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.access.canAuthorizeNewLead(actor),
    ]);
    const counts = Object.fromEntries(
      LEAD_STATUSES.map((status) => [status, 0]),
    ) as Record<(typeof LEAD_STATUSES)[number], number>;
    for (const group of groups) counts[group.status] = group._count._all;
    const screenshotIds = await this.currentScreenshotIds(
      actor,
      items.map((item) => item.id),
    );
    return {
      items: items.map((item) =>
        this.readView(item, screenshotIds.get(item.id) ?? []),
      ),
      total,
      page,
      pageSize,
      counts,
      capabilities: { create },
    };
  }

  async editContext(actor: ActorContext, id: string) {
    let leadScope;
    try {
      leadScope = await this.access.buildLeadScope(actor, 'lead.edit');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const lead = await this.database.lead.findFirst({
      where: { id, ...leadScope },
      select: {
        id: true,
        status: true,
        customerId: true,
        rightsHolderId: true,
      },
    });
    if (lead === null) throw this.notFound();
    if (lead.status !== 'WAITING_PUSH') throw this.invalidState();

    let customerScope;
    try {
      customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
      );
    } catch {
      throw this.notFound();
    }
    const customer = await this.database.customer.findFirst({
      where: {
        id: lead.customerId,
        ...customerScope,
        profileStatus: 'ADMITTED',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        rightsHolderLinks: {
          where: { rightsHolderId: lead.rightsHolderId },
          select: { rightsHolder: { select: { id: true, name: true } } },
        },
      },
    });
    const holder = customer?.rightsHolderLinks[0]?.rightsHolder;
    if (customer === null || holder === undefined) throw this.notFound();
    return {
      customers: [
        {
          id: customer.id,
          name: customer.name,
          rightsHolders: [holder],
        },
      ],
      dictionaries: {
        caseTypes: CASE_TYPE_OPTIONS,
        infringementTypes: INFRINGEMENT_TYPE_OPTIONS,
        sources: SOURCE_OPTIONS,
        platforms: PLATFORM_OPTIONS,
      },
    };
  }

  async get(actor: ActorContext, id: string) {
    let scope;
    try {
      scope = await this.access.buildLeadScope(actor, 'lead.read');
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const lead = await this.database.lead.findFirst({
      where: { id, ...scope },
      include: leadDetailInclude,
    });
    if (lead === null) throw this.notFound();
    const [
      screenshotIds,
      edit,
      push,
      withdrawApply,
      evidenceDecide,
      createEvidenceBatch,
      proxyReview,
    ] = await Promise.all([
      this.currentScreenshotIds(actor, [lead.id]),
      this.canEdit(actor, lead),
      this.canPush(actor, lead),
      this.canApplyWithdrawal(actor, lead),
      this.canDecideEvidence(actor, lead),
      this.canCreateEvidenceBatch(actor, lead),
      lead.status === 'WAITING_REVIEW' && lead.activeReviewDecisionId === null
        ? this.canProxyAction(actor, lead, 'lead.review.proxy')
        : Promise.resolve(false),
    ]);
    const productScreenshotsEdit =
      lead.status === 'WAITING_PUSH'
        ? edit
        : await this.canEditProductScreenshots(actor, lead);
    const applications = lead.withdrawalApplications ?? [];
    const pending = applications.find(
      (application) =>
        application.originalDecisionId === lead.activeReviewDecisionId &&
        application.confirmation === null,
    );
    const proxyConfirmWithdrawal = pending !== undefined &&
      await this.canProxyAction(actor, lead, 'lead.withdraw.confirm.proxy');
    const history = [
      ...(lead.evidenceDecision === null || lead.evidenceDecision === undefined
        ? []
        : [
            {
              kind: 'EVIDENCE_DECISION' as const,
              id: lead.evidenceDecision.id,
              fromVersion: lead.evidenceDecision.fromVersion,
              toVersion: lead.evidenceDecision.toVersion,
              result: lead.evidenceDecision.result,
              reason: lead.evidenceDecision.reason,
              archiveType: lead.evidenceDecision.archiveType,
              archivedAt: lead.evidenceDecision.archivedAt.toISOString(),
              decidedByDisplayName:
                lead.evidenceDecision.actorDisplayNameSnapshot,
              occurredAt: lead.evidenceDecision.decidedAt.toISOString(),
            },
          ]),
      ...(lead.reviewDecisions ?? []).map((decision) => ({
        kind: 'REVIEW_DECISION' as const,
        id: decision.id,
        fromVersion: decision.fromVersion,
        toVersion: decision.toVersion,
        result: decision.result,
        reason: decision.reason,
        archiveType: decision.archiveType,
        archivedAt: decision.archivedAt?.toISOString() ?? null,
        reviewerDisplayName: decision.reviewerDisplayNameSnapshot,
        occurredAt: decision.decidedAt.toISOString(),
      })),
      ...applications.flatMap((application) => [
        {
          kind: 'WITHDRAWAL_APPLICATION' as const,
          id: application.id,
          fromVersion: application.fromVersion,
          toVersion: application.toVersion,
          reason: application.reason,
          applicantDisplayName: this.applicationDisplayName(
            application.resultSnapshot,
          ),
          occurredAt: application.appliedAt.toISOString(),
        },
        ...(application.confirmation === null
          ? []
          : [
              {
                kind: 'WITHDRAWAL_CONFIRMATION' as const,
                id: application.confirmation.id,
                applicationId: application.id,
                fromVersion: application.confirmation.fromVersion,
                toVersion: application.confirmation.toVersion,
                occurredAt: application.confirmation.confirmedAt.toISOString(),
              },
            ]),
      ]),
    ].sort(
      (left, right) =>
        left.fromVersion - right.fromVersion || left.id.localeCompare(right.id),
    );
    return {
      ...this.readView(lead, screenshotIds.get(lead.id) ?? []),
      capabilities: {
        edit,
        productScreenshotsEdit,
        push,
        withdrawApply,
        evidenceDecide,
        transferToNotary: evidenceDecide,
        createEvidenceBatch,
        proxyReview,
        proxyConfirmWithdrawal,
      },
      notaryMatters: lead.notaryMatters.map((matter) => ({
        id: matter.id,
        businessNo: matter.businessNo,
        stage: matter.stage,
        notaryOfficeName: matter.notaryOffice.name,
        batchPurpose: matter.batchPurpose,
        createdAt: matter.createdAt.toISOString(),
      })),
      pendingWithdrawalApplication:
        pending === undefined
          ? null
          : {
              id: pending.id,
              reason: pending.reason,
              applicantDisplayName: this.applicationDisplayName(
                pending.resultSnapshot,
              ),
              appliedAt: pending.appliedAt.toISOString(),
            },
      history,
    };
  }

  private applicationDisplayName(snapshot: unknown): string {
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !('applicantDisplayName' in snapshot) ||
      typeof snapshot.applicantDisplayName !== 'string'
    )
      throw this.corruptReceipt();
    return snapshot.applicantDisplayName;
  }

  private async canApplyWithdrawal(
    actor: ActorContext,
    lead: LeadDetailRecord,
  ): Promise<boolean> {
    if (
      lead.status !== 'ARCHIVED' ||
      typeof lead.activeReviewDecisionId !== 'string' ||
      lead.reviewDecision?.result !== 'NO_INFRINGEMENT' ||
      lead.reviewDecision.archiveType !== 'NO_INFRINGEMENT' ||
      (lead.withdrawalApplications ?? []).some(
        (application) =>
          application.originalDecisionId === lead.activeReviewDecisionId,
      )
    )
      return false;
    try {
      await this.access.authorizeLead(actor, 'lead.withdraw.apply', {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async canProxyAction(
    actor: ActorContext,
    lead: LeadDetailRecord,
    action: 'lead.review.proxy' | 'lead.withdraw.confirm.proxy',
  ): Promise<boolean> {
    if (actor.clientCustomerId !== undefined || actor.notaryOfficeId !== undefined || actor.lawyerAccountId !== undefined)
      return false;
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId }, select: { accountType: true, active: true },
    });
    if (account?.accountType !== 'INTERNAL' || !account.active) return false;
    try {
      await this.access.authorizeLead(actor, action, {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async canDecideEvidence(
    actor: ActorContext,
    lead: LeadDetailRecord,
  ): Promise<boolean> {
    if (
      lead.status !== 'WAITING_EVIDENCE_DECISION' ||
      lead.activeReviewDecisionId === null ||
      lead.reviewDecision?.result !== 'INFRINGEMENT' ||
      lead.evidenceDecision !== null
    )
      return false;
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true },
    });
    if (account?.accountType !== 'INTERNAL') return false;
    try {
      await this.access.authorizeLead(actor, 'lead.evidence.decide', {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async canCreateEvidenceBatch(
    actor: ActorContext,
    lead: LeadDetailRecord,
  ): Promise<boolean> {
    if (
      lead.status !== 'TRANSFERRED_TO_NOTARY' ||
      lead.activeReviewDecisionId === null ||
      lead.reviewDecision?.result !== 'INFRINGEMENT' ||
      lead.evidenceDecision !== null ||
      lead.notaryMatters.length === 0
    )
      return false;
    const account = await this.database.userAccount.findUnique({
      where: { id: actor.userId },
      select: { accountType: true },
    });
    if (account?.accountType !== 'INTERNAL') return false;
    try {
      await this.access.authorizeLead(actor, 'lead.evidence.decide', {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async create(
    actor: ActorContext,
    idempotencyKey: string,
    input: CreateLeadCommand,
  ) {
    try {
      if (!(await this.access.canAuthorizeNewLead(actor)))
        throw this.actionForbidden();
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    const normalized = this.normalizeBusiness(input);
    const productScreenshotIds = normalized.products.flatMap(
      (product) => product.screenshotContentVersionIds ?? [],
    );
    const allScreenshotIds = [
      ...input.leadScreenshotContentVersionIds,
      ...productScreenshotIds,
    ];
    if (new Set(allScreenshotIds).size !== allScreenshotIds.length)
      throw this.validation();
    if (allScreenshotIds.length > 0 && input.reservedLeadId === undefined)
      throw this.validation();
    const leadId = input.reservedLeadId ?? randomUUID();
    const fingerprint = this.fingerprint({
      ...input,
      ...this.fingerprintBusiness(normalized),
      reservedLeadId: input.reservedLeadId ?? null,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            if (!(await this.access.canAuthorizeNewLead(actor, transaction)))
              throw this.actionForbidden();
            const receipt = await transaction.leadCommandReceipt.findUnique({
              where: this.receiptWhere(actor, 'create', idempotencyKey),
            });
            if (receipt !== null)
              return this.receiptResult(
                transaction,
                actor,
                receipt,
                fingerprint,
              );

            const membership = await transaction.departmentMembership.findFirst(
              {
                where: {
                  userId: actor.userId,
                  departmentId: actor.departmentId,
                  active: true,
                },
                select: { teamId: true, team: { select: { status: true } } },
              },
            );
            if (
              membership === null ||
              (membership.teamId !== null &&
                membership.team?.status !== 'ACTIVE')
            )
              throw this.actionForbidden();
            const facts = {
              departmentId: actor.departmentId,
              responsibleUserId: actor.userId,
              ...(membership.teamId === null
                ? {}
                : { teamId: membership.teamId }),
            };
            try {
              await this.access.authorizeLead(
                actor,
                'lead.create',
                facts,
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const businessId = await this.assertCustomerAndHolder(
              transaction,
              actor,
              input.customerId,
              input.rightsHolderId,
              true,
            );

            const materialFacts =
              input.reservedLeadId === undefined
                ? []
                : await this.materials.assertAvailableVersions(
                    transaction,
                    actor,
                    {
                      ownerType: 'LEAD_DRAFT',
                      ownerId: input.reservedLeadId,
                      category: 'LEAD_SCREENSHOT',
                      contentVersionIds: allScreenshotIds,
                      minCount: 0,
                      maxCount: 20,
                    },
                  );
            const businessNo = await allocateCustomerDailyNumber(transaction, {
              customerId: input.customerId,
              businessId,
            });
            const created = await transaction.lead.create({
              data: this.leadCreateData(
                actor,
                input,
                normalized,
                membership.teamId,
                leadId,
                businessNo,
                'MANUAL',
              ),
              include: leadInclude,
            });
            if (input.reservedLeadId !== undefined) {
              await this.materials.adoptLeadDraftVersions(transaction, {
                reservedLeadId: input.reservedLeadId,
                targetLeadId: leadId,
                versions: materialFacts,
              });
            }
            await this.replaceProductScreenshots(
              transaction,
              actor.departmentId,
              leadId,
              created.products,
              normalized.products,
              materialFacts,
            );
            if (materialFacts.length > 0) {
              await this.materials.freezeReferences(transaction, {
                departmentId: actor.departmentId,
                resourceType: 'lead',
                resourceId: leadId,
                facts: materialFacts,
              });
            }
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: leadId,
                action: 'lead.created',
                details: {
                  businessNo,
                  version: 1,
                  fromVersion: 0,
                  toVersion: 1,
                  productCount: normalized.products.length,
                  infringementCount: normalized.infringementTypes.length,
                  screenshotCount: materialFacts.length,
                  productScreenshots: {
                    before: [],
                    after: created.products.map((product, index) => ({
                      productId: product.id,
                      contentVersionIds: [
                        ...(normalized.products[index]
                          ?.screenshotContentVersionIds ?? []),
                      ],
                    })),
                  },
                },
              },
            });
            const createdWithScreenshots = await transaction.lead.findUnique({
              where: { id: leadId },
              include: leadInclude,
            });
            if (createdWithScreenshots === null) throw this.notFound();
            const result = this.view(createdWithScreenshots, [
              ...input.leadScreenshotContentVersionIds,
            ]);
            await transaction.leadCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'create',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: leadId,
                resultLeadVersion: 1,
                resultSnapshot: this.responseSnapshot(result),
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadCommandReceipt.findUnique({
            where: this.receiptWhere(actor, 'create', idempotencyKey),
          });
          if (receipt !== null)
            return this.receiptResult(
              this.database,
              actor,
              receipt,
              fingerprint,
            );
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async importBatch(
    actor: ActorContext,
    idempotencyKey: string,
    input: LeadCsvImportDto,
  ): Promise<LeadCsvImportResponse> {
    if (!idempotencyKey || idempotencyKey.length > 128) throw this.validation();
    const items = this.csvItems(input);
    const originalRequest = {
      items: items.map(({ rowNumber, input: item }) => ({
        rowNumber,
        input: {
          ...item,
          infringementTypes: [...item.infringementTypes],
          products: item.products.map((product) => ({ ...product })),
          leadScreenshotContentVersionIds: [],
        },
      })),
    };
    if (Buffer.byteLength(JSON.stringify(originalRequest), 'utf8') > 92_160)
      throw this.validation();
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 92_160)
      throw this.validation();
    const fingerprint = this.csvFingerprint(originalRequest);
    const remoteRequest = items.map((item) => ({
      screenshots: item.remoteScreenshots ?? [],
      operatorText: item.operatorText ?? null,
    }));
    const remoteFingerprint = remoteRequest.some(
      (entry) => entry.screenshots.length || entry.operatorText,
    )
      ? this.csvFingerprint(remoteRequest)
      : null;
    try {
      if (!(await this.access.canAuthorizeNewLead(actor)))
        throw this.actionForbidden();
    } catch (error) {
      throw this.mapAuthorization(error);
    }
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            if (!(await this.access.canAuthorizeNewLead(actor, tx)))
              throw this.actionForbidden();
            const receipt = await tx.leadCsvImportReceipt.findUnique({
              where: this.csvReceiptWhere(actor, idempotencyKey),
            });
            if (receipt)
              return this.replayCsvReceipt(
                tx,
                actor,
                receipt,
                idempotencyKey,
                fingerprint,
                remoteFingerprint,
              );

            const membership = await tx.departmentMembership.findFirst({
              where: {
                userId: actor.userId,
                departmentId: actor.departmentId,
                active: true,
              },
              select: { teamId: true, team: { select: { status: true } } },
            });
            if (
              !membership ||
              (membership.teamId !== null &&
                membership.team?.status !== 'ACTIVE')
            )
              throw this.actionForbidden();
            try {
              await this.access.authorizeLead(
                actor,
                'lead.create',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: actor.userId,
                  ...(membership.teamId === null
                    ? {}
                    : { teamId: membership.teamId }),
                },
                tx,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const normalized: NormalizedBusiness[] = [];
            const customerBusinessIds: Array<string | null> = [];
            const failures: LeadCsvFailure[] = [];
            for (const [index, item] of items.entries()) {
              try {
                if (item.operatorText !== undefined) {
                  const operator = await tx.userAccount.findFirst({
                    where: {
                      id: actor.userId,
                      active: true,
                      accountType: 'INTERNAL',
                    },
                    select: { displayName: true },
                  });
                  const count = await tx.departmentMembership.count({
                    where: {
                      departmentId: actor.departmentId,
                      active: true,
                      user: {
                        displayName: item.operatorText,
                        active: true,
                        accountType: 'INTERNAL',
                      },
                    },
                  });
                  if (
                    !operator ||
                    operator.displayName !== item.operatorText ||
                    count !== 1
                  )
                    throw this.validation();
                }
                normalized.push(this.normalizeBusiness(item.input));
                customerBusinessIds.push(
                  await this.assertCustomerAndHolder(
                    tx,
                    actor,
                    item.input.customerId,
                    item.input.rightsHolderId,
                    true,
                  ),
                );
              } catch (error) {
                if (error instanceof NotFoundException) {
                  failures.push({
                    index,
                    rowNumber: item.rowNumber,
                    code: 'NOT_AVAILABLE',
                  });
                } else if (error instanceof BadRequestException) {
                  failures.push({
                    index,
                    rowNumber: item.rowNumber,
                    code: 'VALIDATION_ERROR',
                  });
                } else if (
                  error instanceof ConflictException &&
                  (error.getResponse() as { code?: unknown }).code ===
                    'LEAD_CUSTOMER_NOT_COOPERATING'
                ) {
                  failures.push({
                    index,
                    rowNumber: item.rowNumber,
                    code: 'CUSTOMER_NOT_COOPERATING',
                  });
                } else {
                  throw error;
                }
              }
            }
            if (failures.length) throw this.csvRejected(failures);
            const result: LeadCsvImportResponse = { items: [] };
            for (const [index, item] of items.entries()) {
              const businessNo = await allocateCustomerDailyNumber(tx, {
                customerId: item.input.customerId,
                businessId: customerBusinessIds[index] ?? null,
              });
              const leadId = randomUUID();
              const created = await tx.lead.create({
                data: this.leadCreateData(
                  actor,
                  item.input,
                  normalized[index]!,
                  membership.teamId,
                  leadId,
                  businessNo,
                  'CSV',
                ),
                include: leadInclude,
              });
              await tx.auditEvent.create({
                data: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  resourceType: 'lead',
                  resourceId: leadId,
                  action: 'lead.created',
                  details: {
                    businessNo,
                    version: 1,
                    productCount: normalized[index]!.products.length,
                    infringementCount:
                      normalized[index]!.infringementTypes.length,
                    screenshotCount: 0,
                  },
                },
              });
              result.items.push({
                rowNumber: item.rowNumber,
                lead: this.view(created, []),
              });
              for (const group of item.remoteScreenshots ?? []) {
                const product = created.products.find(
                  (entry) => entry.position === group.productNumber,
                );
                if (!product) throw this.validation();
                for (const url of group.urls) {
                  await tx.leadImageImportTask.create({
                    data: {
                      departmentId: actor.departmentId,
                      actorUserId: actor.userId,
                      leadId,
                      productId: product.id,
                      rowNumber: item.rowNumber,
                      productNumber: group.sourceGroupNumber,
                      url,
                      urlSha256: createHash('sha256').update(url).digest('hex'),
                    },
                  });
                }
              }
            }
            await tx.leadCsvImportReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                remoteFingerprint,
                originalRequest,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadCsvImportReceipt.findUnique({
            where: this.csvReceiptWhere(actor, idempotencyKey),
          });
          if (receipt)
            return this.replayCsvReceipt(
              this.database,
              actor,
              receipt,
              idempotencyKey,
              fingerprint,
              remoteFingerprint,
            );
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  private csvItems(input: LeadCsvImportDto): LeadCsvImportDto['items'] {
    if (
      !input ||
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 20 ||
      input.items.some(
        (item) =>
          !item ||
          !Number.isInteger(item.rowNumber) ||
          item.rowNumber < 2 ||
          item.rowNumber > 2097153 ||
          Object.keys(item).some(
            (key) =>
              ![
                'rowNumber',
                'input',
                'remoteScreenshots',
                'operatorText',
              ].includes(key),
          ) ||
          (item.operatorText !== undefined &&
            (typeof item.operatorText !== 'string' ||
              !item.operatorText.trim() ||
              item.operatorText.length > 200)) ||
          !item.input ||
          typeof item.input !== 'object' ||
          csvRequiredInputKeys.some((key) => !Object.hasOwn(item.input, key)) ||
          Object.keys(item.input).some((key) => !csvInputKeys.has(key)) ||
          typeof item.input.customerId !== 'string' ||
          typeof item.input.rightsHolderId !== 'string' ||
          !isUUID(item.input.customerId, '4') ||
          !isUUID(item.input.rightsHolderId, '4') ||
          !Array.isArray(item.input.leadScreenshotContentVersionIds) ||
          item.input.leadScreenshotContentVersionIds.length !== 0 ||
          !Array.isArray(item.input.products) ||
          item.input.products.some(
            (product) =>
              !product ||
              typeof product !== 'object' ||
              Object.keys(product).some((key) => !csvProductKeys.has(key)),
          ) ||
          (item.remoteScreenshots !== undefined &&
            (!Array.isArray(item.remoteScreenshots) ||
              item.remoteScreenshots.length > item.input.products.length ||
              new Set(
                item.remoteScreenshots.map((group) => group?.productNumber),
              ).size !== item.remoteScreenshots.length ||
              item.remoteScreenshots.reduce(
                (count, group) =>
                  count + (Array.isArray(group?.urls) ? group.urls.length : 21),
                0,
              ) > 20 ||
              item.remoteScreenshots.some(
                (group) =>
                  !group ||
                  !Number.isInteger(group.sourceGroupNumber) ||
                  group.sourceGroupNumber < 1 ||
                  group.sourceGroupNumber > 100 ||
                  !Number.isInteger(group.productNumber) ||
                  group.productNumber < 1 ||
                  group.productNumber > item.input.products.length ||
                  !Array.isArray(group.urls) ||
                  group.urls.length < 1 ||
                  group.urls.length > 20 ||
                  new Set(group.urls).size !== group.urls.length ||
                  group.urls.some(
                    (url) =>
                      typeof url !== 'string' ||
                      url.length > 2048 ||
                      !/^https?:\/\//iu.test(url),
                  ),
              ))) ||
          Object.hasOwn(item.input, 'reservedLeadId'),
      ) ||
      new Set(input.items.map((item) => item.rowNumber)).size !==
        input.items.length
    )
      throw this.validation();
    return input.items;
  }

  private csvReceiptWhere(actor: ActorContext, idempotencyKey: string) {
    return {
      departmentId_actorUserId_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        idempotencyKey,
      },
    };
  }

  private csvFingerprint(value: unknown): string {
    const canonical = (part: unknown): unknown =>
      Array.isArray(part)
        ? part.map(canonical)
        : part && typeof part === 'object'
          ? Object.fromEntries(
              Object.entries(part)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => [key, canonical(value)]),
            )
          : part;
    return this.fingerprint({
      action: 'lead.csv-import',
      request: canonical(value),
    });
  }

  private csvRejected(failures: LeadCsvFailure[]) {
    return new ConflictException({
      code: 'CSV_IMPORT_REJECTED',
      message: 'CSV 导入未执行',
      details: { failures },
    });
  }

  private async replayCsvReceipt(
    tx: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    receipt: LeadCsvImportReceipt,
    idempotencyKey: string,
    fingerprint: string,
    remoteFingerprint: string | null = null,
  ): Promise<LeadCsvImportResponse> {
    if (
      receipt.departmentId !== actor.departmentId ||
      receipt.actorUserId !== actor.userId ||
      receipt.idempotencyKey !== idempotencyKey ||
      !(receipt.createdAt instanceof Date) ||
      Number.isNaN(receipt.createdAt.getTime()) ||
      !/^[0-9a-f]{64}$/u.test(receipt.requestFingerprint) ||
      !receipt.originalRequest ||
      typeof receipt.originalRequest !== 'object' ||
      Array.isArray(receipt.originalRequest) ||
      Object.keys(receipt.originalRequest).length !== 1 ||
      !Object.hasOwn(receipt.originalRequest, 'items')
    )
      throw this.corruptReceipt();
    let originalItems: LeadCsvImportDto['items'];
    try {
      originalItems = this.csvItems(
        receipt.originalRequest as unknown as LeadCsvImportDto,
      );
      originalItems.forEach((item) => this.normalizeBusiness(item.input));
    } catch {
      throw this.corruptReceipt();
    }
    if (
      this.csvFingerprint(receipt.originalRequest) !==
      receipt.requestFingerprint
    )
      throw this.corruptReceipt();
    const snapshot = receipt.resultSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).length !== 1 ||
      !Object.hasOwn(snapshot, 'items')
    )
      throw this.corruptReceipt();
    const result = snapshot as LeadCsvImportResponse;
    if (
      !Array.isArray(result.items) ||
      result.items.length !== originalItems.length ||
      result.items.some(
        (entry, index) =>
          !entry ||
          typeof entry !== 'object' ||
          Object.keys(entry).length !== 2 ||
          entry.rowNumber !== originalItems[index]!.rowNumber ||
          !this.isLeadResponse(entry.lead) ||
          !isUUID(entry.lead.id, '4') ||
          entry.lead.departmentId !== actor.departmentId ||
          entry.lead.responsibleUserId !== actor.userId ||
          entry.lead.customerId !== originalItems[index]!.input.customerId ||
          entry.lead.rightsHolderId !==
            originalItems[index]!.input.rightsHolderId ||
          entry.lead.creationChannel !== 'CSV' ||
          entry.lead.externalSourceRef !== null ||
          entry.lead.status !== 'WAITING_PUSH' ||
          entry.lead.version !== 1 ||
          entry.lead.pushedAt !== null ||
          entry.lead.pushedByUserId !== null ||
          entry.lead.reviewDecision !== null ||
          entry.lead.evidenceDecision !== null ||
          !this.csvBusinessSnapshotMatches(
            originalItems[index]!.input,
            entry.lead,
          ) ||
          entry.lead.leadScreenshotContentVersionIds.length !== 0,
      ) ||
      new Set(result.items.map((entry) => entry.lead.id)).size !==
        result.items.length
    )
      throw this.corruptReceipt();
    const ids = result.items.map((entry) => entry.lead.id);
    const leads = await tx.lead.findMany({
      where: { departmentId: actor.departmentId, id: { in: ids } },
      select: {
        id: true,
        businessNo: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
      },
    });
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    const failures: LeadCsvFailure[] = [];
    for (const [index, entry] of result.items.entries()) {
      const lead = byId.get(entry.lead.id);
      if (
        !lead ||
        lead.departmentId !== actor.departmentId ||
        lead.responsibleUserId !== entry.lead.responsibleUserId ||
        lead.teamId !== entry.lead.teamId
      ) {
        failures.push({
          index,
          rowNumber: entry.rowNumber,
          code: 'NOT_AVAILABLE',
        });
        continue;
      }
      try {
        await this.access.authorizeLead(
          actor,
          'lead.create',
          {
            departmentId: lead.departmentId,
            responsibleUserId: lead.responsibleUserId,
            ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
          },
          tx,
        );
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        failures.push({
          index,
          rowNumber: entry.rowNumber,
          code: 'NOT_AVAILABLE',
        });
      }
    }
    if (failures.length) throw this.csvRejected(failures);
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.remoteFingerprint !== remoteFingerprint
    )
      throw this.idempotencyConflict();
    const currentNumbers = new Map(
      leads.map((lead) => [lead.id, lead.businessNo]),
    );
    const refreshedItems = [];
    for (const entry of result.items) {
      const currentNumber = currentNumbers.get(entry.lead.id);
      if (
        !currentNumber ||
        !(await resolveHistoricalNumber(tx, {
          entityType: 'LEAD',
          entityId: entry.lead.id,
          receiptNumber: entry.lead.businessNo,
          currentNumber,
        }))
      )
        throw this.corruptReceipt();
      refreshedItems.push({
        ...entry,
        lead: { ...entry.lead, businessNo: currentNumber },
      });
    }
    return { items: refreshedItems };
  }

  private csvBusinessSnapshotMatches(
    input: LeadCsvImportInputDto,
    lead: LeadResponse,
  ): boolean {
    const normalized = this.normalizeBusiness(input);
    return (
      lead.caseType === normalized.caseType &&
      lead.source === normalized.source &&
      lead.platform === normalized.platform &&
      lead.foundAt === normalized.foundAtDate.toISOString() &&
      lead.shopName === normalized.shopName &&
      lead.shopExternalId === normalized.shopExternalId &&
      lead.needDisclose === normalized.needDisclose &&
      lead.remark === normalized.remark &&
      JSON.stringify([...lead.infringementTypes].sort()) ===
        JSON.stringify([...normalized.infringementTypes].sort()) &&
      lead.products.length === normalized.products.length &&
      lead.products.every((product, index) => {
        const source = normalized.products[index]!;
        return (
          isUUID(product.id, '4') &&
          product.position === index + 1 &&
          product.url === source.url &&
          product.title === source.title &&
          product.quantity === source.quantity &&
          product.unitPrice ===
            new Prisma.Decimal(source.unitPrice).toFixed(2) &&
          product.commentCount === source.commentCount &&
          product.estimatedAmount === source.estimatedAmount.toFixed(2)
        );
      })
    );
  }

  async update(actor: ActorContext, id: string, input: UpdateLeadDto) {
    const normalized = this.normalizeBusiness(input);
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            let scope;
            try {
              scope = await this.access.buildLeadScope(
                actor,
                'lead.edit',
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, ...scope },
              include: leadInclude,
            });
            if (current === null) throw this.notFound();
            if (current.status !== 'WAITING_PUSH') throw this.invalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            const legacyNoIds = normalized.products.every(
              (product) => product.id === undefined,
            );
            if (legacyNoIds) {
              if (
                normalized.products.length !== current.products.length ||
                current.products.some(
                  (product) =>
                    (product.screenshots?.length ?? 0) > 0 ||
                    (product.notarySelections?.length ?? 0) > 0,
                ) ||
                normalized.products.some(
                  (product) =>
                    (product.screenshotContentVersionIds ?? []).length > 0,
                )
              )
                throw this.versionConflict();
              normalized.products.forEach((product, index) => {
                product.id = current.products[index]!.id;
              });
            } else if (normalized.products.some((product) => !product.id)) {
              throw this.versionConflict();
            }
            const oldById = new Map(
              current.products.map((product) => [product.id, product]),
            );
            if (
              normalized.products.some(
                (product) =>
                  product.screenshotContentVersionIds === undefined &&
                  (oldById.get(product.id!)?.screenshots.length ?? 0) > 0,
              )
            )
              throw this.versionConflict();
            const nextIds = new Set(
              normalized.products.map((product) => product.id!),
            );
            const newIds = [...nextIds].filter(
              (productId) => !oldById.has(productId),
            );
            if (newIds.length > 0) {
              const ownedElsewhere = await transaction.leadProduct.findMany({
                where: { id: { in: newIds } },
                select: { id: true },
              });
              if (ownedElsewhere.length > 0) throw this.versionConflict();
            }
            if (
              current.products.some(
                (product) =>
                  !nextIds.has(product.id) &&
                  ((product.screenshots?.length ?? 0) > 0 ||
                    (product.notarySelections?.length ?? 0) > 0),
              )
            )
              throw this.versionConflict();
            await this.assertCustomerAndHolder(
              transaction,
              actor,
              current.customerId,
              current.rightsHolderId,
            );
            const allScreenshotIds = [
              ...input.leadScreenshotContentVersionIds,
              ...normalized.products.flatMap(
                (product) => product.screenshotContentVersionIds ?? [],
              ),
            ];
            if (new Set(allScreenshotIds).size !== allScreenshotIds.length)
              throw this.validation();
            const materialFacts =
              allScreenshotIds.length === 0
                ? []
                : await this.materials.assertAvailableVersions(
                    transaction,
                    actor,
                    {
                      ownerType: 'LEAD',
                      ownerId: id,
                      category: 'LEAD_SCREENSHOT',
                      contentVersionIds: allScreenshotIds,
                      minCount: 0,
                      maxCount: 20,
                      leadAction: 'lead.edit',
                    },
                  );
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: 'WAITING_PUSH',
              },
              data: {
                caseType: normalized.caseType,
                source: normalized.source,
                platform: normalized.platform,
                foundAt: normalized.foundAtDate,
                shopName: normalized.shopName,
                shopExternalId: normalized.shopExternalId,
                needDisclose: normalized.needDisclose,
                remark: normalized.remark,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.leadProductScreenshot.deleteMany({
              where: { leadId: id, departmentId: actor.departmentId },
            });
            await transaction.leadProduct.deleteMany({
              where: { leadId: id, id: { notIn: [...nextIds] } },
            });
            for (const [index, product] of current.products.entries()) {
              if (!nextIds.has(product.id)) continue;
              await transaction.leadProduct.update({
                where: { id: product.id },
                data: { position: -(index + 1) },
              });
            }
            await transaction.leadInfringement.deleteMany({
              where: { leadId: id },
            });
            for (const [index, product] of normalized.products.entries()) {
              const data = {
                position: index + 1,
                url: product.url,
                title: product.title,
                quantity: product.quantity,
                unitPrice: product.unitPrice,
                commentCount: product.commentCount,
                estimatedAmount: product.estimatedAmount,
              };
              if (oldById.has(product.id!)) {
                await transaction.leadProduct.update({
                  where: { id: product.id! },
                  data,
                });
              } else {
                await transaction.leadProduct.create({
                  data: { id: product.id!, leadId: id, ...data },
                });
              }
            }
            const updatedProducts = await transaction.leadProduct.findMany({
              where: { leadId: id },
              orderBy: { position: 'asc' },
              select: { id: true },
            });
            await this.replaceProductScreenshots(
              transaction,
              actor.departmentId,
              id,
              updatedProducts,
              normalized.products,
              materialFacts,
            );
            await transaction.leadInfringement.createMany({
              data: normalized.infringementTypes.map((type) => ({
                leadId: id,
                type,
              })),
            });
            const referenceResult =
              await this.materials.replaceCurrentReferences(
                transaction,
                actor,
                {
                  resourceType: 'lead',
                  resourceId: id,
                  purpose: 'LEAD_SCREENSHOT',
                  versions: materialFacts,
                },
              );
            const changedFields = this.changedFields(
              current,
              normalized,
              referenceResult.changed,
            );
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.updated',
                details: {
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  changedFields,
                  productScreenshots: {
                    before: current.products.map((product) => ({
                      productId: product.id,
                      contentVersionIds: product.screenshots.map(
                        (screenshot) => screenshot.contentVersionId,
                      ),
                    })),
                    after: normalized.products.map((product) => ({
                      productId: product.id!,
                      contentVersionIds: [
                        ...(product.screenshotContentVersionIds ?? []),
                      ],
                    })),
                  },
                },
              },
            });
            const updated = await transaction.lead.findUnique({
              where: { id },
              include: leadInclude,
            });
            if (updated === null) throw this.notFound();
            return this.view(updated, referenceResult.afterVersionIds);
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async updateProductScreenshots(
    actor: ActorContext,
    id: string,
    productId: string,
    input: UpdateLeadProductScreenshotsDto,
  ) {
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Array.isArray(input.screenshotContentVersionIds) ||
      input.screenshotContentVersionIds.length > 20 ||
      new Set(input.screenshotContentVersionIds).size !==
        input.screenshotContentVersionIds.length ||
      input.screenshotContentVersionIds.some(
        (versionId) => typeof versionId !== 'string' || !isUUID(versionId, '4'),
      )
    )
      throw this.validation();
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            let scope;
            try {
              scope = await this.access.buildLeadScope(
                actor,
                'lead.edit',
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, ...scope },
              include: leadInclude,
            });
            if (current === null) throw this.notFound();
            if (current.status === 'ARCHIVED') throw this.invalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            const product = current.products.find(
              (item) => item.id === productId,
            );
            if (product === undefined) throw this.notFound();
            const currentRefs =
              await this.materials.listCurrentReferenceVersionIds(
                transaction,
                actor,
                {
                  resourceType: 'lead',
                  resourceId: id,
                  purpose: 'LEAD_SCREENSHOT',
                },
              );
            const previousTargetIds = new Set(
              product.screenshots.map((item) => item.contentVersionId),
            );
            const retainedIds = currentRefs.filter(
              (versionId) => !previousTargetIds.has(versionId),
            );
            const nextIds = [
              ...retainedIds,
              ...input.screenshotContentVersionIds,
            ];
            if (nextIds.length > 20 || new Set(nextIds).size !== nextIds.length)
              throw this.validation();
            const facts = await this.materials.assertAvailableVersions(
              transaction,
              actor,
              {
                ownerType: 'LEAD',
                ownerId: id,
                category: 'LEAD_SCREENSHOT',
                contentVersionIds: nextIds,
                minCount: 0,
                maxCount: 20,
                leadAction: 'lead.edit',
              },
            );
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: { not: 'ARCHIVED' },
              },
              data: { version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.leadProductScreenshot.deleteMany({
              where: {
                leadId: id,
                departmentId: actor.departmentId,
                productId,
              },
            });
            const factById = new Map(
              facts.map((fact) => [fact.contentVersionId, fact]),
            );
            const rows = input.screenshotContentVersionIds.map(
              (contentVersionId) => {
                const fact = factById.get(contentVersionId);
                if (fact === undefined) throw this.validation();
                return {
                  leadId: id,
                  departmentId: actor.departmentId,
                  productId,
                  materialId: fact.materialId,
                  contentVersionId,
                };
              },
            );
            if (rows.length > 0)
              await transaction.leadProductScreenshot.createMany({
                data: rows,
              });
            const references = await this.materials.replaceCurrentReferences(
              transaction,
              actor,
              {
                resourceType: 'lead',
                resourceId: id,
                purpose: 'LEAD_SCREENSHOT',
                versions: facts,
              },
            );
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.product-screenshots.updated',
                details: {
                  productId,
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  beforeVersionIds: [...previousTargetIds],
                  afterVersionIds: [...input.screenshotContentVersionIds],
                  productScreenshots: {
                    before: [
                      { productId, contentVersionIds: [...previousTargetIds] },
                    ],
                    after: [
                      {
                        productId,
                        contentVersionIds: [
                          ...input.screenshotContentVersionIds,
                        ],
                      },
                    ],
                  },
                },
              },
            });
            const updated = await transaction.lead.findUnique({
              where: { id },
              include: leadInclude,
            });
            if (updated === null) throw this.notFound();
            return this.view(updated, references.afterVersionIds);
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async push(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: PushLeadDto,
  ): Promise<LeadPushResponse> {
    const fingerprint = this.fingerprint({ leadId: id, ...input });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, departmentId: actor.departmentId },
              include: {
                products: { orderBy: { position: 'asc' } },
                infringements: { orderBy: { type: 'asc' } },
                customer: {
                  select: {
                    profileStatus: true,
                    clientAccountBindings: {
                      where: { active: true, user: { active: true } },
                      select: { id: true },
                      take: 1,
                    },
                  },
                },
              },
            });
            if (current === null) throw this.notFound();
            try {
              await this.access.authorizeLead(
                actor,
                'lead.push',
                {
                  departmentId: current.departmentId,
                  responsibleUserId: current.responsibleUserId,
                  ...(current.teamId === null
                    ? {}
                    : { teamId: current.teamId }),
                },
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const pusher = await transaction.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (pusher === null)
              throw new InternalServerErrorException(
                '推送操作人账号不可用，请稍后重试',
              );
            const receipt = await transaction.leadCommandReceipt.findUnique({
              where: this.receiptWhere(actor, 'push', idempotencyKey),
            });
            if (receipt !== null)
              return this.pushReceiptResult(
                transaction,
                actor,
                receipt,
                fingerprint,
                id,
                pusher.displayName,
              );
            if (current.status !== 'WAITING_PUSH')
              throw this.pushInvalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            if (current.customer.profileStatus !== 'ADMITTED')
              throw this.customerNotAdmitted();
            if (current.products.length === 0) throw this.productsRequired();
            if (current.customer.clientAccountBindings.length === 0)
              throw this.clientAccountUnavailable();
            const pushedAt = new Date();
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: 'WAITING_PUSH',
              },
              data: {
                status: 'WAITING_REVIEW',
                pushedAt,
                pushedByUserId: actor.userId,
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.pushed',
                details: {
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                },
              },
            });
            const result: LeadPushResponse = {
              id,
              businessNo: current.businessNo,
              status: 'WAITING_REVIEW',
              version: input.expectedVersion + 1,
              pushedAt: pushedAt.toISOString(),
              pushedByUserId: actor.userId,
              pushedByDisplayName: pusher.displayName,
            };
            await transaction.leadCommandReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                action: 'push',
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultLeadId: id,
                resultLeadVersion: result.version,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadCommandReceipt.findUnique({
            where: this.receiptWhere(actor, 'push', idempotencyKey),
          });
          if (receipt !== null) {
            const pusher = await this.database.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (pusher !== null)
              return this.pushReceiptResult(
                this.database,
                actor,
                receipt,
                fingerprint,
                id,
                pusher.displayName,
              );
          }
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async pushBatch(
    actor: ActorContext,
    idempotencyKey: string,
    input: LeadBatchPushDto,
  ): Promise<LeadBatchPushResponse> {
    if (!input || typeof input !== 'object' || !Array.isArray(input.items))
      throw this.validation();
    const items = input.items;
    if (
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 20 ||
      items.some(
        (item) =>
          !item ||
          typeof item.leadId !== 'string' ||
          !Number.isInteger(item.expectedVersion) ||
          item.expectedVersion < 1 ||
          !isUUID(item.leadId),
      ) ||
      new Set(items.map((item) => item.leadId.toLowerCase())).size !==
        items.length
    )
      throw this.validation();
    const originalRequest = { items: items.map((item) => ({ ...item })) };
    const fingerprint = this.fingerprint({
      action: 'lead.batch-push',
      ...originalRequest,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const receipt = await tx.leadBatchPushReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey,
                },
              },
            });
            if (receipt)
              return this.replayBatchReceipt(
                tx,
                actor,
                receipt,
                idempotencyKey,
                fingerprint,
              );
            const indexes = new Map(
              items.map((item, index) => [item.leadId.toLowerCase(), index]),
            );
            const ids = [...items]
              .map((item) => item.leadId)
              .sort((a, b) => {
                const left = a.toLowerCase();
                const right = b.toLowerCase();
                return left < right ? -1 : left > right ? 1 : 0;
              });
            await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "leads" WHERE "department_id" = $1::uuid AND "id" = ANY($2::uuid[]) ORDER BY "id"::text FOR UPDATE',
              actor.departmentId,
              ids,
            );
            const loaded = await tx.lead.findMany({
              where: { departmentId: actor.departmentId, id: { in: ids } },
              include: {
                products: { orderBy: { position: 'asc' } },
                customer: {
                  select: {
                    profileStatus: true,
                    clientAccountBindings: {
                      where: { active: true, user: { active: true } },
                      select: { id: true },
                      take: 1,
                    },
                  },
                },
              },
            });
            const byId = new Map(
              loaded.map((lead) => [lead.id.toLowerCase(), lead]),
            );
            const failures: LeadBatchFailure[] = [];
            for (const item of items) {
              const index = indexes.get(item.leadId.toLowerCase())!;
              const current = byId.get(item.leadId.toLowerCase());
              if (!current) {
                failures.push({ index, code: 'NOT_AVAILABLE' });
                continue;
              }
              try {
                await this.access.authorizeLead(
                  actor,
                  'lead.push',
                  {
                    departmentId: current.departmentId,
                    responsibleUserId: current.responsibleUserId,
                    ...(current.teamId === null
                      ? {}
                      : { teamId: current.teamId }),
                  },
                  tx,
                );
              } catch (error) {
                if (!(error instanceof ForbiddenException)) throw error;
                failures.push({ index, code: 'NOT_AVAILABLE' });
                continue;
              }
              if (current.status !== 'WAITING_PUSH')
                failures.push({ index, code: 'INVALID_STATE' });
              else if (current.version !== item.expectedVersion)
                failures.push({ index, code: 'VERSION_CONFLICT' });
              else if (current.customer.profileStatus !== 'ADMITTED')
                failures.push({ index, code: 'CUSTOMER_NOT_ADMITTED' });
              else if (current.products.length === 0)
                failures.push({ index, code: 'LEAD_PRODUCTS_REQUIRED' });
              else if (current.customer.clientAccountBindings.length === 0)
                failures.push({ index, code: 'CLIENT_ACCOUNT_UNAVAILABLE' });
            }
            if (failures.length)
              throw new ConflictException({
                code: 'BATCH_PUSH_REJECTED',
                message: '批量推送未执行',
                details: { failures },
              });
            const pusher = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (!pusher)
              throw new InternalServerErrorException('批量推送操作者不可用');
            const pushedAt = new Date();
            const resultItems: LeadPushResponse[] = [];
            for (let index = 0; index < items.length; index += 1) {
              const item = items[index]!;
              const current = byId.get(item.leadId.toLowerCase())!;
              const changed = await tx.lead.updateMany({
                where: {
                  id: current.id,
                  departmentId: actor.departmentId,
                  version: item.expectedVersion,
                  status: 'WAITING_PUSH',
                },
                data: {
                  status: 'WAITING_REVIEW',
                  pushedAt,
                  pushedByUserId: actor.userId,
                  version: { increment: 1 },
                },
              });
              if (changed.count !== 1) throw this.versionConflict();
              await tx.auditEvent.create({
                data: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  resourceType: 'lead',
                  resourceId: current.id,
                  action: 'lead.pushed',
                  details: {
                    fromVersion: item.expectedVersion,
                    toVersion: item.expectedVersion + 1,
                  },
                },
              });
              resultItems.push({
                id: current.id,
                businessNo: current.businessNo,
                status: 'WAITING_REVIEW',
                version: item.expectedVersion + 1,
                pushedAt: pushedAt.toISOString(),
                pushedByUserId: actor.userId,
                pushedByDisplayName: pusher.displayName,
              });
            }
            const result: LeadBatchPushResponse = { items: resultItems };
            await tx.leadBatchPushReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                originalRequest,
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          const receipt = await this.database.leadBatchPushReceipt.findUnique({
            where: {
              departmentId_actorUserId_idempotencyKey: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey,
              },
            },
          });
          if (receipt)
            return this.replayBatchReceipt(
              this.database,
              actor,
              receipt,
              idempotencyKey,
              fingerprint,
            );
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private async replayBatchReceipt(
    tx: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    receipt: LeadBatchPushReceipt,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<LeadBatchPushResponse> {
    if (
      receipt.departmentId !== actor.departmentId ||
      receipt.actorUserId !== actor.userId ||
      receipt.idempotencyKey !== idempotencyKey ||
      !(receipt.createdAt instanceof Date) ||
      Number.isNaN(receipt.createdAt.getTime()) ||
      !/^[0-9a-f]{64}$/u.test(receipt.requestFingerprint) ||
      !receipt.originalRequest ||
      typeof receipt.originalRequest !== 'object' ||
      Array.isArray(receipt.originalRequest)
    )
      throw this.corruptReceipt();
    const snapshot = receipt.originalRequest as {
      items?: unknown;
      [key: string]: unknown;
    };
    if (
      Object.keys(snapshot).length !== 1 ||
      !Object.hasOwn(snapshot, 'items') ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.length < 1 ||
      snapshot.items.length > 20 ||
      snapshot.items.some((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          return true;
        const item = entry as Record<string, unknown>;
        return (
          Object.keys(item).length !== 2 ||
          typeof item.leadId !== 'string' ||
          !isUUID(item.leadId) ||
          !Number.isInteger(item.expectedVersion) ||
          (item.expectedVersion as number) < 1 ||
          (item.expectedVersion as number) > 2147483647
        );
      }) ||
      new Set(
        (snapshot.items as Array<{ leadId: string }>).map((item) =>
          item.leadId.toLowerCase(),
        ),
      ).size !== snapshot.items.length
    )
      throw this.corruptReceipt();
    const originalItems = snapshot.items as Array<{
      leadId: string;
      expectedVersion: number;
    }>;
    const ids = originalItems.map((item) => item.leadId);
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "leads" WHERE "department_id" = $1::uuid AND "id" = ANY($2::uuid[]) ORDER BY "id"::text FOR UPDATE',
      actor.departmentId,
      ids,
    );
    const leads = await tx.lead.findMany({
      where: { departmentId: actor.departmentId, id: { in: ids } },
      select: {
        id: true,
        businessNo: true,
        departmentId: true,
        responsibleUserId: true,
        teamId: true,
      },
    });
    const byId = new Map<
      string,
      {
        id: string;
        businessNo: string;
        departmentId: string;
        responsibleUserId: string;
        teamId: string | null;
      }
    >(leads.map((lead) => [lead.id.toLowerCase(), lead]));
    const failures: LeadBatchFailure[] = [];
    for (const [index, item] of originalItems.entries()) {
      const lead = byId.get(item.leadId.toLowerCase());
      if (!lead) {
        failures.push({ index, code: 'NOT_AVAILABLE' });
        continue;
      }
      try {
        await this.access.authorizeLead(
          actor,
          'lead.push',
          {
            departmentId: lead.departmentId,
            responsibleUserId: lead.responsibleUserId,
            ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
          },
          tx,
        );
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        failures.push({ index, code: 'NOT_AVAILABLE' });
      }
    }
    if (failures.length)
      throw new ConflictException({
        code: 'BATCH_PUSH_REJECTED',
        message: '当前权限不足，无法确认原批量请求结果；请恢复权限后原样重试',
        details: { failures },
      });
    const originalFingerprint = this.fingerprint({
      action: 'lead.batch-push',
      items: originalItems.map(({ leadId, expectedVersion }) => ({
        leadId,
        expectedVersion,
      })),
    });
    if (receipt.requestFingerprint !== originalFingerprint)
      throw this.corruptReceipt();
    if (
      !receipt.resultSnapshot ||
      typeof receipt.resultSnapshot !== 'object' ||
      Array.isArray(receipt.resultSnapshot)
    )
      throw this.corruptReceipt();
    const resultSnapshot = receipt.resultSnapshot as {
      items?: unknown;
      [key: string]: unknown;
    };
    if (
      Object.keys(resultSnapshot).length !== 1 ||
      !Object.hasOwn(resultSnapshot, 'items') ||
      !Array.isArray(resultSnapshot.items)
    )
      throw this.corruptReceipt();
    const result = receipt.resultSnapshot as LeadBatchPushResponse;
    if (
      result.items.length !== originalItems.length ||
      result.items.some((entry, index) => {
        if (
          !entry ||
          typeof entry !== 'object' ||
          Object.keys(entry).length !== 7
        )
          return true;
        const expected = originalItems[index]!;
        return (
          typeof entry.id !== 'string' ||
          !isUUID(entry.id) ||
          entry.id.toLowerCase() !== expected.leadId.toLowerCase() ||
          typeof entry.businessNo !== 'string' ||
          entry.status !== 'WAITING_REVIEW' ||
          entry.version !== expected.expectedVersion + 1 ||
          typeof entry.pushedAt !== 'string' ||
          Number.isNaN(Date.parse(entry.pushedAt)) ||
          new Date(entry.pushedAt).toISOString() !== entry.pushedAt ||
          typeof entry.pushedByUserId !== 'string' ||
          entry.pushedByUserId !== actor.userId ||
          typeof entry.pushedByDisplayName !== 'string'
        );
      })
    )
      throw this.corruptReceipt();
    if (new Set(result.items.map((entry) => entry.pushedAt)).size !== 1)
      throw this.corruptReceipt();
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const refreshedItems = [];
    for (const entry of result.items) {
      const currentNumber = byId.get(entry.id.toLowerCase())?.businessNo;
      if (
        !currentNumber ||
        !(await resolveHistoricalNumber(tx, {
          entityType: 'LEAD',
          entityId: entry.id,
          receiptNumber: entry.businessNo,
          currentNumber,
        }))
      )
        throw this.corruptReceipt();
      refreshedItems.push({ ...entry, businessNo: currentNumber });
    }
    return { items: refreshedItems };
  }

  async applyWithdrawal(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: ApplyLeadWithdrawalDto,
  ): Promise<LeadWithdrawalApplicationResponse> {
    if (typeof input.reason !== 'string') throw this.validation();
    const reason = input.reason.trim();
    const reasonLength = Array.from(reason).length;
    if (reasonLength < 1 || reasonLength > 5000) throw this.validation();
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw this.validation();
    const fingerprint = this.fingerprint({
      leadId: id,
      reason,
      expectedVersion: input.expectedVersion,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, departmentId: actor.departmentId },
              include: {
                reviewDecision: { select: { result: true, archiveType: true } },
                withdrawalApplications: {
                  select: { originalDecisionId: true },
                },
              },
            });
            if (current === null) throw this.notFound();
            try {
              await this.access.authorizeLead(
                actor,
                'lead.withdraw.apply',
                {
                  departmentId: current.departmentId,
                  responsibleUserId: current.responsibleUserId,
                  ...(current.teamId === null
                    ? {}
                    : { teamId: current.teamId }),
                },
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const prior =
              await transaction.leadWithdrawalApplication.findUnique({
                where: {
                  departmentId_applicantUserId_idempotencyKey: {
                    departmentId: actor.departmentId,
                    applicantUserId: actor.userId,
                    idempotencyKey,
                  },
                },
              });
            if (prior !== null)
              return this.withdrawalApplicationSnapshot(prior, fingerprint, id);
            if (
              current.status !== 'ARCHIVED' ||
              current.activeReviewDecisionId === null ||
              current.reviewDecision?.result !== 'NO_INFRINGEMENT' ||
              current.reviewDecision.archiveType !== 'NO_INFRINGEMENT' ||
              current.withdrawalApplications.some(
                (application) =>
                  application.originalDecisionId ===
                  current.activeReviewDecisionId,
              )
            )
              throw this.withdrawalInvalidState();
            if (current.version !== input.expectedVersion)
              throw this.versionConflict();
            const applicant = await transaction.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true },
            });
            if (applicant === null) throw this.actionForbidden();
            const changed = await transaction.lead.updateMany({
              where: {
                id,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                status: 'ARCHIVED',
                activeReviewDecisionId: current.activeReviewDecisionId,
              },
              data: { version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const applicationId = randomUUID();
            const appliedAt = new Date();
            const result: LeadWithdrawalApplicationResponse = {
              id: applicationId,
              leadId: id,
              status: 'ARCHIVED',
              version: input.expectedVersion + 1,
              reason,
              applicantDisplayName: applicant.displayName,
              appliedAt: appliedAt.toISOString(),
            };
            await transaction.leadWithdrawalApplication.create({
              data: {
                id: applicationId,
                originalDecisionId: current.activeReviewDecisionId,
                leadId: id,
                customerId: current.customerId,
                departmentId: current.departmentId,
                applicantUserId: actor.userId,
                reason,
                appliedAt,
                fromVersion: input.expectedVersion,
                toVersion: result.version,
                idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: result,
              },
            });
            await transaction.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'lead',
                resourceId: id,
                action: 'lead.withdrawal_applied',
                details: {
                  applicationId,
                  originalDecisionId: current.activeReviewDecisionId,
                  fromVersion: input.expectedVersion,
                  toVersion: result.version,
                },
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.withdrawalInvalidState();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  async decideNoEvidenceBatch(
    actor: ActorContext,
    idempotencyKey: string,
    input: LeadNoEvidenceBatchDto,
  ): Promise<LeadNoEvidenceBatchResponseDto> {
    if (
      !idempotencyKey ||
      idempotencyKey !== idempotencyKey.trim() ||
      idempotencyKey.length > 128
    )
      throw this.validation();
    const items = this.noEvidenceBatchItems(input);
    const fingerprint = this.fingerprint({
      action: 'lead.batch-no-evidence',
      items,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const actorAccount = await tx.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true, accountType: true },
            });
            if (actorAccount?.accountType !== 'INTERNAL')
              throw this.actionForbidden();
            const prior = await tx.leadNoEvidenceBatchReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey,
                },
              },
            });
            if (
              prior &&
              (prior.departmentId !== actor.departmentId ||
                prior.actorUserId !== actor.userId ||
                prior.idempotencyKey !== idempotencyKey)
            )
              throw this.actionForbidden();
            let targets = items;
            if (prior) {
              try {
                targets = this.noEvidenceBatchItems(prior.originalRequest);
              } catch {
                throw this.corruptReceipt();
              }
            }
            const ids = targets.map(({ leadId }) => leadId).sort();
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT "id" FROM "leads" WHERE "department_id" = $1::uuid AND "id" = ANY($2::uuid[]) ORDER BY "id"::text FOR UPDATE',
              actor.departmentId,
              ids,
            );
            if (locked.length !== ids.length) throw this.notFound();
            const loaded = await tx.lead.findMany({
              where: { departmentId: actor.departmentId, id: { in: ids } },
              include: {
                reviewDecision: { select: { id: true, result: true } },
              },
            });
            const byId = new Map(
              loaded.map((lead) => [lead.id.toLowerCase(), lead]),
            );
            for (const item of targets) {
              const current = byId.get(item.leadId);
              if (!current || current.departmentId !== actor.departmentId)
                throw this.notFound();
              await this.access.authorizeLead(
                actor,
                'lead.evidence.decide',
                {
                  departmentId: current.departmentId,
                  responsibleUserId: current.responsibleUserId,
                  ...(current.teamId === null
                    ? {}
                    : { teamId: current.teamId }),
                },
                tx,
              );
            }
            if (prior)
              return this.noEvidenceBatchSnapshot(
                tx,
                actor,
                prior,
                targets,
                fingerprint,
              );
            for (const item of items)
              this.assertEvidenceDecisionState(
                byId.get(item.leadId)!,
                item.expectedVersion,
              );
            const batchId = randomUUID();
            const results: LeadEvidenceDecisionResponse[] = [];
            for (const [index, item] of items.entries()) {
              const itemKey = this.noEvidenceBatchItemKey(batchId, index);
              results.push(
                await this.writeEvidenceDecision(
                  tx,
                  actor,
                  byId.get(item.leadId)!,
                  item.leadId,
                  itemKey,
                  item.expectedVersion,
                  item.reason,
                  actorAccount.displayName,
                ),
              );
            }
            const result = { items: results };
            await tx.leadNoEvidenceBatchReceipt.create({
              data: {
                id: batchId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey,
                requestFingerprint: fingerprint,
                originalRequest: { items: items.map((item) => ({ ...item })) },
                resultSnapshot: result,
              },
            });
            return result;
          },
          { isolationLevel: 'Serializable', timeout: 15_000 },
        );
      } catch (error) {
        if (this.isSerializationConflict(error) || this.isUnique(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  private noEvidenceBatchItems(input: unknown): LeadNoEvidenceBatchItemDto[] {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !('items' in input) ||
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 20
    )
      throw this.validation();
    const items = input.items.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw this.validation();
      const item = value as Record<string, unknown>;
      if (
        Object.keys(item).length !== 3 ||
        typeof item.leadId !== 'string' ||
        !isUUID(item.leadId) ||
        typeof item.expectedVersion !== 'number' ||
        !Number.isInteger(item.expectedVersion) ||
        item.expectedVersion < 1 ||
        item.expectedVersion > 2147483646 ||
        typeof item.reason !== 'string'
      )
        throw this.validation();
      const reason = item.reason.trim();
      if (Array.from(reason).length < 1 || Array.from(reason).length > 5000)
        throw this.validation();
      return {
        leadId: item.leadId.toLowerCase(),
        expectedVersion: item.expectedVersion,
        reason,
      };
    });
    if (new Set(items.map(({ leadId }) => leadId)).size !== items.length)
      throw this.validation();
    return items;
  }

  private noEvidenceBatchItemKey(batchId: string, index: number): string {
    return `batch-no-evidence:${batchId}:${index}`;
  }

  private async noEvidenceBatchSnapshot(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    receipt: LeadNoEvidenceBatchReceipt,
    items: LeadNoEvidenceBatchItemDto[],
    fingerprint: string,
  ): Promise<LeadNoEvidenceBatchResponseDto> {
    if (
      !isUUID(receipt.id) ||
      !(receipt.createdAt instanceof Date) ||
      Number.isNaN(receipt.createdAt.getTime()) ||
      receipt.requestFingerprint !==
        this.fingerprint({ action: 'lead.batch-no-evidence', items })
    )
      throw this.corruptReceipt();
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).length !== 1 ||
      !('items' in snapshot) ||
      !Array.isArray(snapshot.items) ||
      snapshot.items.length !== items.length
    )
      throw this.corruptReceipt();
    const results: LeadEvidenceDecisionResponse[] = [];
    for (const [index, item] of items.entries()) {
      const typed = await tx.leadCommandReceipt.findUnique({
        where: this.receiptWhere(
          actor,
          'evidence_decide',
          this.noEvidenceBatchItemKey(receipt.id, index),
        ),
      });
      if (!typed) throw this.corruptReceipt();
      const itemFingerprint = this.fingerprint({
        leadId: item.leadId,
        result: 'NO_EVIDENCE',
        reason: item.reason,
        expectedVersion: item.expectedVersion,
      });
      if (
        typed.requestFingerprint !== itemFingerprint ||
        typed.resultLeadId !== item.leadId
      )
        throw this.corruptReceipt();
      const original = this.evidenceDecisionSnapshot(
        typed,
        itemFingerprint,
        item.leadId,
      );
      const saved = snapshot.items[index];
      const resultKeys = [
        'id',
        'leadId',
        'status',
        'version',
        'result',
        'reason',
        'decidedByDisplayName',
        'decidedAt',
        'archiveType',
        'archivedAt',
      ] as const;
      if (
        Object.keys(original).length !== 10 ||
        !isUUID(original.id) ||
        original.reason !== item.reason ||
        original.version !== item.expectedVersion + 1 ||
        Number.isNaN(Date.parse(original.decidedAt)) ||
        new Date(original.decidedAt).toISOString() !== original.decidedAt ||
        !saved ||
        typeof saved !== 'object' ||
        Array.isArray(saved) ||
        Object.keys(saved).length !== resultKeys.length ||
        resultKeys.some(
          (key) => !(key in saved) || saved[key] !== original[key],
        )
      )
        throw this.corruptReceipt();
      results.push(original);
    }
    return { items: results };
  }

  private assertEvidenceDecisionState(
    current: EvidenceDecisionLead,
    expectedVersion: number,
  ): void {
    if (
      current.status !== 'WAITING_EVIDENCE_DECISION' ||
      current.activeReviewDecisionId === null ||
      current.reviewDecision?.id !== current.activeReviewDecisionId ||
      current.reviewDecision.result !== 'INFRINGEMENT'
    )
      throw this.evidenceInvalidState();
    if (current.version !== expectedVersion) throw this.versionConflict();
  }

  private async writeEvidenceDecision(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
    current: EvidenceDecisionLead,
    id: string,
    idempotencyKey: string,
    expectedVersion: number,
    reason: string,
    displayName: string,
  ): Promise<LeadEvidenceDecisionResponse> {
    this.assertEvidenceDecisionState(current, expectedVersion);
    const changed = await transaction.lead.updateMany({
      where: {
        id,
        departmentId: actor.departmentId,
        version: expectedVersion,
        status: 'WAITING_EVIDENCE_DECISION',
        activeReviewDecisionId: current.activeReviewDecisionId,
      },
      data: { status: 'ARCHIVED', version: { increment: 1 } },
    });
    if (changed.count !== 1) throw this.versionConflict();
    const evidenceDecisionId = randomUUID();
    const decidedAt = new Date();
    const result: LeadEvidenceDecisionResponse = {
      id: evidenceDecisionId,
      leadId: id,
      status: 'ARCHIVED',
      version: expectedVersion + 1,
      result: 'NO_EVIDENCE',
      reason,
      decidedByDisplayName: displayName,
      decidedAt: decidedAt.toISOString(),
      archiveType: 'NO_EVIDENCE',
      archivedAt: decidedAt.toISOString(),
    };
    await transaction.leadEvidenceDecision.create({
      data: {
        id: evidenceDecisionId,
        originalReviewDecisionId: current.activeReviewDecisionId!,
        originalReviewResult: 'INFRINGEMENT',
        leadId: id,
        customerId: current.customerId,
        departmentId: current.departmentId,
        actorUserId: actor.userId,
        actorDisplayNameSnapshot: displayName,
        result: 'NO_EVIDENCE',
        reason,
        archiveType: 'NO_EVIDENCE',
        decidedAt,
        archivedAt: decidedAt,
        fromVersion: expectedVersion,
        toVersion: result.version,
      },
    });
    await transaction.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        resourceType: 'lead',
        resourceId: id,
        action: 'lead.evidence_decided',
        details: {
          evidenceDecisionId,
          originalReviewDecisionId: current.activeReviewDecisionId,
          result: 'NO_EVIDENCE',
          fromVersion: expectedVersion,
          toVersion: result.version,
        },
      },
    });
    await transaction.leadCommandReceipt.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        action: 'evidence_decide',
        idempotencyKey,
        requestFingerprint: this.fingerprint({
          leadId: id,
          result: 'NO_EVIDENCE',
          reason,
          expectedVersion,
        }),
        resultLeadId: id,
        resultLeadVersion: result.version,
        resultSnapshot: result,
      },
    });
    return result;
  }

  async decideEvidence(
    actor: ActorContext,
    id: string,
    idempotencyKey: string,
    input: DecideLeadEvidenceDto,
  ): Promise<LeadEvidenceDecisionResponse> {
    if (input.result !== 'NO_EVIDENCE' || typeof input.reason !== 'string')
      throw this.validation();
    const reason = input.reason.trim();
    if (Array.from(reason).length < 1 || Array.from(reason).length > 5000)
      throw this.validation();
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw this.validation();
    const fingerprint = this.fingerprint({
      leadId: id,
      result: input.result,
      reason,
      expectedVersion: input.expectedVersion,
    });
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const locked = await transaction.$queryRawUnsafe<
              Array<{ id: string }>
            >(
              'SELECT "id" FROM "leads" WHERE "id" = $1::uuid AND "department_id" = $2::uuid FOR UPDATE',
              id,
              actor.departmentId,
            );
            if (locked.length !== 1) throw this.notFound();
            const current = await transaction.lead.findFirst({
              where: { id, departmentId: actor.departmentId },
              include: {
                reviewDecision: { select: { id: true, result: true } },
              },
            });
            if (current === null) throw this.notFound();
            const actorAccount = await transaction.userAccount.findUnique({
              where: { id: actor.userId },
              select: { displayName: true, accountType: true },
            });
            if (actorAccount?.accountType !== 'INTERNAL')
              throw this.actionForbidden();
            try {
              await this.access.authorizeLead(
                actor,
                'lead.evidence.decide',
                {
                  departmentId: current.departmentId,
                  responsibleUserId: current.responsibleUserId,
                  ...(current.teamId === null
                    ? {}
                    : { teamId: current.teamId }),
                },
                transaction,
              );
            } catch (error) {
              throw this.mapAuthorization(error);
            }
            const prior = await transaction.leadCommandReceipt.findUnique({
              where: this.receiptWhere(
                actor,
                'evidence_decide',
                idempotencyKey,
              ),
            });
            if (prior !== null)
              return this.evidenceDecisionSnapshot(prior, fingerprint, id);
            return this.writeEvidenceDecision(
              transaction,
              actor,
              current,
              id,
              idempotencyKey,
              input.expectedVersion,
              reason,
              actorAccount.displayName,
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isSerializationConflict(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.versionConflict();
        }
        if (this.isUnique(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS) continue;
          throw this.evidenceInvalidState();
        }
        throw this.mapAuthorization(error);
      }
    }
    throw this.versionConflict();
  }

  private evidenceDecisionSnapshot(
    receipt: Receipt,
    fingerprint: string,
    leadId: string,
  ): LeadEvidenceDecisionResponse {
    if (
      receipt.requestFingerprint !== fingerprint ||
      receipt.resultLeadId !== leadId
    )
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const result = snapshot as Record<string, unknown>;
    if (
      typeof result.id !== 'string' ||
      result.leadId !== leadId ||
      result.status !== 'ARCHIVED' ||
      result.version !== receipt.resultLeadVersion ||
      result.result !== 'NO_EVIDENCE' ||
      typeof result.reason !== 'string' ||
      typeof result.decidedByDisplayName !== 'string' ||
      typeof result.decidedAt !== 'string' ||
      result.archiveType !== 'NO_EVIDENCE' ||
      result.archivedAt !== result.decidedAt
    )
      throw this.corruptReceipt();
    return result as LeadEvidenceDecisionResponse;
  }

  private withdrawalApplicationSnapshot(
    application: {
      requestFingerprint: string;
      resultSnapshot: unknown;
      leadId: string;
      id: string;
      toVersion: number;
      reason: string;
      appliedAt: Date;
    },
    fingerprint: string,
    leadId: string,
  ): LeadWithdrawalApplicationResponse {
    if (
      application.requestFingerprint !== fingerprint ||
      application.leadId !== leadId
    )
      throw this.idempotencyConflict();
    const snapshot = application.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const result = snapshot as Record<string, unknown>;
    if (
      result.id !== application.id ||
      result.leadId !== leadId ||
      result.status !== 'ARCHIVED' ||
      result.version !== application.toVersion ||
      result.reason !== application.reason ||
      typeof result.applicantDisplayName !== 'string' ||
      result.appliedAt !== application.appliedAt.toISOString()
    )
      throw this.corruptReceipt();
    return result as LeadWithdrawalApplicationResponse;
  }

  private async assertCustomerAndHolder(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
    customerId: string,
    rightsHolderId: string,
    newLead = false,
  ) {
    let customerScope;
    try {
      customerScope = await this.access.buildCustomerScope(
        actor,
        'customer.read',
        transaction,
      );
    } catch {
      throw this.notFound();
    }
    const customerWhere = {
      id: customerId,
      ...customerScope,
      departmentId: actor.departmentId,
      profileStatus: 'ADMITTED' as const,
      deletedAt: null,
    };
    const visibleCustomer = await transaction.customer.findFirst({
      where: customerWhere,
      select: { id: true, businessId: true },
    });
    if (visibleCustomer === null) throw this.notFound();
    const locked = await transaction.$queryRawUnsafe<
      Array<{
        customer_id: string;
        cooperation_status: 'COOPERATING' | 'PAUSED' | 'TERMINATED';
      }>
    >(
      `SELECT customer."id" AS "customer_id", customer."cooperation_status"
       FROM "customers" customer
       JOIN "customer_rights_holder_links" link
         ON link."customer_id" = customer."id" AND link."department_id" = customer."department_id"
       WHERE customer."id" = $1::uuid AND customer."department_id" = $2::uuid
         AND customer."profile_status" = 'ADMITTED' AND link."rights_holder_id" = $3::uuid
       FOR SHARE OF customer, link`,
      customerId,
      actor.departmentId,
      rightsHolderId,
    );
    if (locked.length !== 1) throw this.notFound();
    if (newLead && locked[0]?.cooperation_status !== 'COOPERATING') {
      throw new ConflictException({
        code: 'LEAD_CUSTOMER_NOT_COOPERATING',
        message: '客户当前未合作，不能新建线索',
      });
    }
    const customer = await transaction.customer.findFirst({
      where: customerWhere,
      select: { id: true, businessId: true },
    });
    if (customer === null) throw this.notFound();
    const link = await transaction.customerRightsHolderLink.findFirst({
      where: { customerId, rightsHolderId, departmentId: actor.departmentId },
      select: { id: true },
    });
    if (link === null) throw this.notFound();
    return customer.businessId;
  }

  private leadCreateData(
    actor: ActorContext,
    input: Pick<CreateLeadCommand, 'customerId' | 'rightsHolderId'>,
    normalized: NormalizedBusiness,
    teamId: string | null,
    leadId: string,
    businessNo: string,
    creationChannel: 'MANUAL' | 'CSV',
  ): Prisma.LeadUncheckedCreateInput {
    return {
      id: leadId,
      departmentId: actor.departmentId,
      businessNo,
      customerId: input.customerId,
      rightsHolderId: input.rightsHolderId,
      responsibleUserId: actor.userId,
      teamId,
      status: 'WAITING_PUSH',
      caseType: normalized.caseType,
      source: normalized.source,
      platform: normalized.platform,
      foundAt: normalized.foundAtDate,
      shopName: normalized.shopName,
      shopExternalId: normalized.shopExternalId,
      needDisclose: normalized.needDisclose,
      remark: normalized.remark,
      creationChannel,
      externalSourceRef: null,
      products: {
        create: normalized.products.map((product, index) => ({
          id: product.id ?? randomUUID(),
          position: index + 1,
          url: product.url,
          title: product.title,
          quantity: product.quantity,
          unitPrice: product.unitPrice,
          commentCount: product.commentCount,
          estimatedAmount: product.estimatedAmount,
        })),
      },
      infringements: {
        create: normalized.infringementTypes.map((type) => ({ type })),
      },
    };
  }

  private normalizeBusiness(
    input: CreateLeadCommand | UpdateLeadDto,
  ): NormalizedBusiness {
    if (
      !CASE_TYPES.includes(input.caseType) ||
      !SOURCES.includes(input.source) ||
      !PLATFORMS.includes(input.platform) ||
      !Array.isArray(input.infringementTypes) ||
      input.infringementTypes.length < 1 ||
      input.infringementTypes.length > 12 ||
      new Set(input.infringementTypes).size !==
        input.infringementTypes.length ||
      input.infringementTypes.some(
        (type) => !INFRINGEMENT_TYPES.includes(type),
      ) ||
      !this.platformMatches(input.source, input.platform) ||
      !Array.isArray(input.products) ||
      input.products.length < 1 ||
      input.products.length > 100 ||
      !Array.isArray(input.leadScreenshotContentVersionIds) ||
      input.leadScreenshotContentVersionIds.length > 20 ||
      new Set(input.leadScreenshotContentVersionIds).size !==
        input.leadScreenshotContentVersionIds.length
    )
      throw this.validation();
    const shopName = this.required(input.shopName, 200);
    const foundAtDate = new Date(input.foundAt);
    if (Number.isNaN(foundAtDate.getTime())) throw this.validation();
    const products = input.products.map((product) => this.product(product));
    const productIds = products.map((product) => product.id).filter(Boolean);
    const screenshotIds = products.flatMap(
      (product) => product.screenshotContentVersionIds ?? [],
    );
    if (
      productIds.length !== new Set(productIds).size ||
      screenshotIds.length !== new Set(screenshotIds).size ||
      screenshotIds.length + input.leadScreenshotContentVersionIds.length > 20
    )
      throw this.validation();
    return {
      ...input,
      shopName,
      foundAtDate,
      shopExternalId: this.optional(input.shopExternalId, 100),
      remark: this.optional(input.remark, 5000),
      products,
    } as NormalizedBusiness;
  }

  private product(product: ProductInput) {
    if (product.id !== undefined && !isUUID(product.id, '4'))
      throw this.validation();
    if (
      product.screenshotContentVersionIds !== undefined &&
      (!Array.isArray(product.screenshotContentVersionIds) ||
        product.screenshotContentVersionIds.length > 20 ||
        product.screenshotContentVersionIds.some(
          (id) => typeof id !== 'string' || !isUUID(id, '4'),
        ) ||
        new Set(product.screenshotContentVersionIds).size !==
          product.screenshotContentVersionIds.length)
    )
      throw this.validation();
    const url = this.optional(product.url, 2048);
    const title = this.optional(product.title, 200);
    if (url === null && title === null) throw this.validation();
    if (url !== null) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
          throw this.validation();
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw this.validation();
      }
    }
    if (
      !Number.isInteger(product.quantity) ||
      product.quantity < 0 ||
      product.quantity > 2_147_483_647 ||
      !Number.isInteger(product.commentCount) ||
      product.commentCount < 0 ||
      product.commentCount > 2_147_483_647 ||
      typeof product.unitPrice !== 'string' ||
      !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/u.test(product.unitPrice)
    )
      throw this.validation();
    const basis =
      product.quantity > 0 ? product.quantity : product.commentCount;
    const estimatedAmount = new Prisma.Decimal(product.unitPrice)
      .mul(basis)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (estimatedAmount.greaterThan('9999999999999999.99'))
      throw this.validation();
    return { ...product, url, title, estimatedAmount };
  }

  private platformMatches(source: LeadSource, platform: LeadPlatform) {
    return PLATFORM_OPTIONS[source].some((option) => option.value === platform);
  }

  private readView(
    record: LeadReadRecord,
    leadScreenshotContentVersionIds: readonly string[],
  ) {
    const customerName = record.customer?.name;
    const rightsHolderName = record.rightsHolder?.name;
    const responsibleUserName = record.responsibleMembership?.user?.displayName;
    if (
      !customerName?.trim() ||
      !rightsHolderName?.trim() ||
      !responsibleUserName?.trim()
    ) {
      throw new InternalServerErrorException({
        code: 'INVALID_SOURCE',
        message: '线索关联信息不完整，请联系管理员核实',
      });
    }
    return {
      ...this.view(record, leadScreenshotContentVersionIds),
      displayNames: { customerName, rightsHolderName, responsibleUserName },
    };
  }

  private view(
    record: LeadRecord,
    leadScreenshotContentVersionIds: readonly string[],
  ): LeadResponse {
    return {
      id: record.id,
      businessNo: record.businessNo,
      departmentId: record.departmentId,
      customerId: record.customerId,
      rightsHolderId: record.rightsHolderId,
      responsibleUserId: record.responsibleUserId,
      teamId: record.teamId ?? null,
      status: record.status,
      caseType: record.caseType,
      infringementTypes: record.infringements.map(({ type }) => type),
      source: record.source,
      platform: record.platform,
      foundAt: record.foundAt.toISOString(),
      shopName: record.shopName,
      shopExternalId: record.shopExternalId ?? null,
      needDisclose: record.needDisclose,
      remark: record.remark ?? null,
      creationChannel: record.creationChannel,
      externalSourceRef: record.externalSourceRef ?? null,
      products: record.products.map((product) => ({
        id: product.id,
        position: product.position,
        url: product.url ?? null,
        title: product.title ?? null,
        quantity: product.quantity,
        unitPrice: this.decimal(product.unitPrice),
        commentCount: product.commentCount,
        estimatedAmount: this.decimal(product.estimatedAmount),
        screenshotContentVersionIds: (product.screenshots ?? []).map(
          (screenshot) => screenshot.contentVersionId,
        ),
      })),
      leadScreenshotContentVersionIds: leadScreenshotContentVersionIds.filter(
        (versionId) =>
          !record.products.some((product) =>
            (product.screenshots ?? []).some(
              (screenshot) => screenshot.contentVersionId === versionId,
            ),
          ),
      ),
      version: record.version,
      pushedAt: record.pushedAt?.toISOString() ?? null,
      pushedByUserId: record.pushedByUserId ?? null,
      pushedByDisplayName: record.pushedBy?.displayName ?? null,
      reviewDecision: record.reviewDecision
        ? record.reviewDecision.result === 'NO_INFRINGEMENT'
          ? {
              result: 'NO_INFRINGEMENT',
              reason: record.reviewDecision.reason!,
              reviewerDisplayName:
                record.reviewDecision.reviewerDisplayNameSnapshot,
              decidedAt: record.reviewDecision.decidedAt.toISOString(),
              archiveType: 'NO_INFRINGEMENT',
              archivedAt: record.reviewDecision.archivedAt!.toISOString(),
            }
          : {
              result: 'INFRINGEMENT',
              reviewerDisplayName:
                record.reviewDecision.reviewerDisplayNameSnapshot,
              decidedAt: record.reviewDecision.decidedAt.toISOString(),
            }
        : null,
      evidenceDecision: record.evidenceDecision
        ? {
            result: record.evidenceDecision.result,
            reason: record.evidenceDecision.reason,
            decidedByDisplayName:
              record.evidenceDecision.actorDisplayNameSnapshot,
            decidedAt: record.evidenceDecision.decidedAt.toISOString(),
            archiveType: 'NO_EVIDENCE',
            archivedAt: record.evidenceDecision.archivedAt.toISOString(),
          }
        : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private decimal(value: Prisma.Decimal) {
    return value.toFixed(2);
  }

  private async replaceProductScreenshots(
    transaction: MaterialTransactionClient,
    departmentId: string,
    leadId: string,
    products: readonly Pick<LeadRecord['products'][number], 'id'>[],
    inputs: readonly NormalizedBusiness['products'][number][],
    facts: readonly ValidatedMaterialVersionFact[],
  ) {
    const factsById = new Map(
      facts.map((fact) => [fact.contentVersionId, fact]),
    );
    const associations = inputs.flatMap((input, index) =>
      (input.screenshotContentVersionIds ?? []).map((contentVersionId) => {
        const fact = factsById.get(contentVersionId);
        const product = products[index];
        if (fact === undefined || product === undefined)
          throw this.validation();
        return {
          leadId,
          departmentId,
          productId: product.id,
          materialId: fact.materialId,
          contentVersionId,
        };
      }),
    );
    if (associations.length > 0)
      await transaction.leadProductScreenshot.createMany({
        data: associations,
      });
  }
  private async currentScreenshotIds(
    actor: ActorContext,
    leadIds: readonly string[],
  ) {
    const result = new Map<string, string[]>();
    if (leadIds.length === 0) return result;
    const versionIds = await Promise.all(
      leadIds.map((leadId) =>
        this.materials.listCurrentReferenceVersionIds(this.database, actor, {
          resourceType: 'lead',
          resourceId: leadId,
          purpose: 'LEAD_SCREENSHOT',
        }),
      ),
    );
    for (const [index, leadId] of leadIds.entries()) {
      result.set(leadId, [...(versionIds[index] ?? [])]);
    }
    return result;
  }
  private async canEdit(actor: ActorContext, lead: LeadRecord) {
    if (lead.status !== 'WAITING_PUSH') return false;
    try {
      const scope = await this.access.buildLeadScope(actor, 'lead.edit');
      return (
        (await this.database.lead.findFirst({
          where: { id: lead.id, ...scope },
          select: { id: true },
        })) !== null
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  private async canEditProductScreenshots(
    actor: ActorContext,
    lead: LeadRecord,
  ) {
    if (lead.status === 'ARCHIVED') return false;
    try {
      const scope = await this.access.buildLeadScope(actor, 'lead.edit');
      return (
        (await this.database.lead.findFirst({
          where: { id: lead.id, ...scope },
          select: { id: true },
        })) !== null
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  private async canPush(actor: ActorContext, lead: LeadRecord) {
    if (lead.status !== 'WAITING_PUSH') return false;
    try {
      await this.access.authorizeLead(actor, 'lead.push', {
        departmentId: lead.departmentId,
        responsibleUserId: lead.responsibleUserId,
        ...(lead.teamId === null ? {} : { teamId: lead.teamId }),
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  private responseSnapshot(response: LeadResponse): Prisma.InputJsonObject {
    return {
      id: response.id,
      businessNo: response.businessNo,
      departmentId: response.departmentId,
      customerId: response.customerId,
      rightsHolderId: response.rightsHolderId,
      responsibleUserId: response.responsibleUserId,
      teamId: response.teamId,
      status: response.status,
      caseType: response.caseType,
      infringementTypes: [...response.infringementTypes],
      source: response.source,
      platform: response.platform,
      foundAt: response.foundAt,
      shopName: response.shopName,
      shopExternalId: response.shopExternalId,
      needDisclose: response.needDisclose,
      remark: response.remark,
      creationChannel: response.creationChannel,
      externalSourceRef: response.externalSourceRef,
      products: response.products.map((product) => ({
        id: product.id,
        position: product.position,
        url: product.url,
        title: product.title,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
        commentCount: product.commentCount,
        estimatedAmount: product.estimatedAmount,
        screenshotContentVersionIds: [...product.screenshotContentVersionIds],
      })),
      leadScreenshotContentVersionIds: [
        ...response.leadScreenshotContentVersionIds,
      ],
      version: response.version,
      pushedAt: response.pushedAt,
      pushedByUserId: response.pushedByUserId,
      pushedByDisplayName: response.pushedByDisplayName,
      reviewDecision: response.reviewDecision
        ? response.reviewDecision.result === 'NO_INFRINGEMENT'
          ? {
              result: response.reviewDecision.result,
              reason: response.reviewDecision.reason,
              reviewerDisplayName: response.reviewDecision.reviewerDisplayName,
              decidedAt: response.reviewDecision.decidedAt,
              archiveType: response.reviewDecision.archiveType,
              archivedAt: response.reviewDecision.archivedAt,
            }
          : {
              result: response.reviewDecision.result,
              reviewerDisplayName: response.reviewDecision.reviewerDisplayName,
              decidedAt: response.reviewDecision.decidedAt,
            }
        : null,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
    };
  }
  private isLeadResponse(value: unknown): value is LeadResponse {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return false;
    const candidate = value as Partial<LeadResponse>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.businessNo === 'string' &&
      typeof candidate.departmentId === 'string' &&
      typeof candidate.customerId === 'string' &&
      typeof candidate.rightsHolderId === 'string' &&
      typeof candidate.responsibleUserId === 'string' &&
      (candidate.teamId === null || typeof candidate.teamId === 'string') &&
      LEAD_STATUSES.includes(
        candidate.status as (typeof LEAD_STATUSES)[number],
      ) &&
      typeof candidate.caseType === 'string' &&
      Array.isArray(candidate.infringementTypes) &&
      typeof candidate.source === 'string' &&
      typeof candidate.platform === 'string' &&
      typeof candidate.foundAt === 'string' &&
      typeof candidate.shopName === 'string' &&
      (candidate.shopExternalId === null ||
        typeof candidate.shopExternalId === 'string') &&
      typeof candidate.needDisclose === 'boolean' &&
      (candidate.remark === null || typeof candidate.remark === 'string') &&
      typeof candidate.creationChannel === 'string' &&
      (candidate.externalSourceRef === null ||
        typeof candidate.externalSourceRef === 'string') &&
      Array.isArray(candidate.products) &&
      candidate.products.every(
        (product) =>
          typeof product.id === 'string' &&
          Number.isInteger(product.position) &&
          (product.url === null || typeof product.url === 'string') &&
          (product.title === null || typeof product.title === 'string') &&
          Number.isInteger(product.quantity) &&
          typeof product.unitPrice === 'string' &&
          Number.isInteger(product.commentCount) &&
          typeof product.estimatedAmount === 'string' &&
          Array.isArray(product.screenshotContentVersionIds) &&
          product.screenshotContentVersionIds.every(
            (id) => typeof id === 'string',
          ),
      ) &&
      Array.isArray(candidate.leadScreenshotContentVersionIds) &&
      candidate.leadScreenshotContentVersionIds.every(
        (id) => typeof id === 'string',
      ) &&
      Number.isInteger(candidate.version) &&
      (candidate.pushedAt === null || typeof candidate.pushedAt === 'string') &&
      (candidate.pushedByUserId === null ||
        typeof candidate.pushedByUserId === 'string') &&
      (candidate.reviewDecision === undefined ||
        candidate.reviewDecision === null ||
        (typeof candidate.reviewDecision === 'object' &&
          !Array.isArray(candidate.reviewDecision) &&
          typeof candidate.reviewDecision.reviewerDisplayName === 'string' &&
          typeof candidate.reviewDecision.decidedAt === 'string' &&
          (candidate.reviewDecision.result === 'INFRINGEMENT'
            ? !('reason' in candidate.reviewDecision) &&
              !('archiveType' in candidate.reviewDecision) &&
              !('archivedAt' in candidate.reviewDecision)
            : candidate.reviewDecision.result === 'NO_INFRINGEMENT' &&
              typeof candidate.reviewDecision.reason === 'string' &&
              candidate.reviewDecision.archiveType === 'NO_INFRINGEMENT' &&
              typeof candidate.reviewDecision.archivedAt === 'string'))) &&
      (candidate.pushedByDisplayName === undefined ||
        candidate.pushedByDisplayName === null ||
        typeof candidate.pushedByDisplayName === 'string') &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string'
    );
  }
  private fingerprint(input: unknown) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
  private fingerprintBusiness(input: NormalizedBusiness) {
    return {
      ...input,
      foundAtDate: input.foundAtDate.toISOString(),
      products: input.products.map(({ estimatedAmount, ...product }) => ({
        ...product,
        estimatedAmount: estimatedAmount.toFixed(2),
      })),
    };
  }
  private receiptWhere(
    actor: ActorContext,
    action: string,
    idempotencyKey: string,
  ) {
    return {
      departmentId_actorUserId_action_idempotencyKey: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        action,
        idempotencyKey,
      },
    };
  }
  private async receiptResult(
    tx: Pick<Prisma.TransactionClient, 'lead' | 'businessNumberAlias'>,
    actor: ActorContext,
    receipt: Receipt,
    fingerprint: string,
  ): Promise<LeadResponse> {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      !this.isLeadResponse(snapshot) ||
      snapshot.id !== receipt.resultLeadId ||
      snapshot.version !== receipt.resultLeadVersion ||
      snapshot.departmentId !== actor.departmentId
    )
      throw this.corruptReceipt();
    const current = await tx.lead.findUnique({
      where: { id: receipt.resultLeadId },
      select: { businessNo: true },
    });
    if (
      !current ||
      !(await resolveHistoricalNumber(tx, {
        entityType: 'LEAD',
        entityId: receipt.resultLeadId,
        receiptNumber: snapshot.businessNo,
        currentNumber: current.businessNo,
      }))
    )
      throw this.corruptReceipt();
    return {
      ...snapshot,
      businessNo: current.businessNo,
      pushedByDisplayName: snapshot.pushedByDisplayName ?? null,
      reviewDecision: snapshot.reviewDecision ?? null,
      evidenceDecision: snapshot.evidenceDecision ?? null,
    };
  }
  private async pushReceiptResult(
    tx: Pick<Prisma.TransactionClient, 'lead' | 'businessNumberAlias'>,
    actor: ActorContext,
    receipt: Receipt,
    fingerprint: string,
    leadId: string,
    fallbackDisplayName: string,
  ): Promise<LeadPushResponse> {
    if (receipt.requestFingerprint !== fingerprint)
      throw this.idempotencyConflict();
    const snapshot = receipt.resultSnapshot;
    if (
      snapshot === null ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot)
    )
      throw this.corruptReceipt();
    const result = snapshot as Record<string, unknown>;
    if (
      result.id !== leadId ||
      result.id !== receipt.resultLeadId ||
      result.status !== 'WAITING_REVIEW' ||
      result.version !== receipt.resultLeadVersion ||
      typeof result.businessNo !== 'string' ||
      typeof result.pushedAt !== 'string' ||
      typeof result.pushedByUserId !== 'string' ||
      result.pushedByUserId !== actor.userId ||
      (result.pushedByDisplayName !== undefined &&
        typeof result.pushedByDisplayName !== 'string')
    )
      throw this.corruptReceipt();
    const current = await tx.lead.findUnique({
      where: { id: leadId },
      select: { businessNo: true },
    });
    if (
      !current ||
      !(await resolveHistoricalNumber(tx, {
        entityType: 'LEAD',
        entityId: leadId,
        receiptNumber: result.businessNo,
        currentNumber: current.businessNo,
      }))
    )
      throw this.corruptReceipt();
    return {
      ...(result as Omit<LeadPushResponse, 'pushedByDisplayName'>),
      businessNo: current.businessNo,
      pushedByDisplayName:
        typeof result.pushedByDisplayName === 'string'
          ? result.pushedByDisplayName
          : fallbackDisplayName,
    };
  }
  private changedFields(
    current: LeadRecord,
    normalized: NormalizedBusiness,
    screenshotChanged: boolean,
  ) {
    const changed: string[] = [];
    const scalarPairs: Array<[string, unknown, unknown]> = [
      ['caseType', current.caseType, normalized.caseType],
      ['source', current.source, normalized.source],
      ['platform', current.platform, normalized.platform],
      [
        'foundAt',
        current.foundAt instanceof Date
          ? current.foundAt.toISOString()
          : current.foundAt,
        normalized.foundAtDate.toISOString(),
      ],
      ['shopName', current.shopName, normalized.shopName],
      [
        'shopExternalId',
        current.shopExternalId ?? null,
        normalized.shopExternalId,
      ],
      ['needDisclose', current.needDisclose, normalized.needDisclose],
      ['remark', current.remark ?? null, normalized.remark],
    ];
    for (const [name, before, after] of scalarPairs) {
      if (before !== after) changed.push(name);
    }
    const currentProducts = current.products.map((product) => ({
      url: product.url,
      title: product.title,
      quantity: product.quantity,
      unitPrice: this.decimal(product.unitPrice),
      commentCount: product.commentCount,
    }));
    const nextProducts = normalized.products.map((product) => ({
      url: product.url,
      title: product.title,
      quantity: product.quantity,
      unitPrice: new Prisma.Decimal(product.unitPrice).toFixed(2),
      commentCount: product.commentCount,
    }));
    if (JSON.stringify(currentProducts) !== JSON.stringify(nextProducts))
      changed.push('products');
    const currentInfringements = current.infringements
      .map(({ type }) => type)
      .sort();
    const nextInfringements = [...normalized.infringementTypes].sort();
    if (
      JSON.stringify(currentInfringements) !== JSON.stringify(nextInfringements)
    )
      changed.push('infringementTypes');
    if (screenshotChanged) changed.push('leadScreenshotContentVersionIds');
    return changed;
  }
  private required(value: unknown, max: number) {
    if (typeof value !== 'string') throw this.validation();
    const result = value.normalize('NFKC').trim();
    if (!result || result.length > max) throw this.validation();
    return result;
  }
  private optional(value: unknown, max: number) {
    if (value === undefined || value === null) return null;
    const result = this.required(value, max);
    return result;
  }
  private mapAuthorization(error: unknown): unknown {
    if (error instanceof ForbiddenException) return this.actionForbidden();
    return error;
  }
  private isSerializationConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    if (record.code === 'P2034') return true;
    if (record.code === 'P2010') {
      const meta = record.meta;
      const adapter =
        meta !== null &&
        typeof meta === 'object' &&
        'driverAdapterError' in meta
          ? meta.driverAdapterError
          : undefined;
      const cause =
        adapter !== null && typeof adapter === 'object' && 'cause' in adapter
          ? adapter.cause
          : undefined;
      if (
        cause !== null &&
        typeof cause === 'object' &&
        (('originalCode' in cause && cause.originalCode === '40001') ||
          ('sqlState' in cause && cause.sqlState === '40001'))
      )
        return true;
    }
    return this.isSerializationConflict(record.cause);
  }
  private isUnique(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      ((error as { code?: unknown }).code === 'P2002' ||
        this.isUnique((error as { cause?: unknown }).cause))
    );
  }
  private validation() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '请求字段不符合接口要求',
    });
  }
  private actionForbidden() {
    return new ForbiddenException({
      code: 'ACTION_FORBIDDEN',
      message: '无权执行此线索操作',
    });
  }
  private notFound() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: '线索或关联资源不存在或不可访问',
    });
  }
  private invalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅待推送线索可以编辑',
    });
  }
  private pushInvalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅待推送线索可以推送',
    });
  }
  private withdrawalInvalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅当前未申请撤回的不侵权归档线索可以申请',
    });
  }
  private evidenceInvalidState() {
    return new ConflictException({
      code: 'INVALID_STATE',
      message: '仅客户确认侵权后的待确认线索可以决定不取证',
    });
  }
  private customerNotAdmitted() {
    return new ConflictException({
      code: 'CUSTOMER_NOT_ADMITTED',
      message: '客户已不处于准入状态',
    });
  }
  private productsRequired() {
    return new ConflictException({
      code: 'LEAD_PRODUCTS_REQUIRED',
      message: '线索至少需要一项有效商品',
    });
  }
  private clientAccountUnavailable() {
    return new ConflictException({
      code: 'CLIENT_ACCOUNT_UNAVAILABLE',
      message: '客户没有可用的已绑定账号',
    });
  }
  private versionConflict() {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: '线索已被他人更新，请重新加载',
    });
  }
  private idempotencyConflict() {
    return new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '该 Idempotency-Key 已用于不同请求',
    });
  }
  private corruptReceipt() {
    return new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: '线索回执数据损坏',
    });
  }
}
