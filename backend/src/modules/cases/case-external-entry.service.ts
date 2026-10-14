import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseStage, InfringementType, LeadCaseType, LeadPlatform } from '../../generated/prisma/enums';
import { CreateCaseExternalEntryDto, CreateCaseExternalEntryResultDto } from './case-external-entry.dto';

const stages = Object.values(CaseStage);
const day = /^\d{4}-\d{2}-\d{2}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const knownKeys = ['courtId', 'courtCaseNo', 'acceptedOn', 'secondInstanceAcceptedOn', 'platform', 'shopName', 'shopExternalId', 'caseType', 'infringementTypes'] as const;

@Injectable()
export class CaseExternalEntryService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessControlService) {}

  private invalid(): BadRequestException { return new BadRequestException({code:'VALIDATION_ERROR',message:'Invalid external case entry'}); }
  private forbidden(): ForbiddenException { return new ForbiddenException({code:'FORBIDDEN',message:'External case entry unavailable'}); }
  private conflict(): ConflictException { return new ConflictException({code:'IDEMPOTENCY_CONFLICT',message:'External case entry key already used'}); }
  private todayShanghai(): string { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  private date(value: unknown): value is string {
    if (typeof value !== 'string' || !day.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value && value <= this.todayShanghai();
  }
  private assertInternal(actor: ActorContext): void {
    if (actor.clientCustomerId !== undefined || actor.notaryOfficeId !== undefined || actor.lawyerAccountId !== undefined) throw this.forbidden();
  }
  private facts(actor: ActorContext, teamId: string | null) {
    return {departmentId:actor.departmentId,responsibleUserId:actor.userId,...(teamId === null ? {} : {teamId})};
  }
  private async actorMembership(tx: Prisma.TransactionClient, actor: ActorContext) {
    this.assertInternal(actor);
    const [account,membership] = await Promise.all([
      tx.userAccount.findUnique({where:{id:actor.userId},select:{id:true,displayName:true,active:true,accountType:true}}),
      tx.departmentMembership.findUnique({where:{userId_departmentId:{userId:actor.userId,departmentId:actor.departmentId}},select:{active:true,teamId:true}}),
    ]);
    if (account?.active !== true || account.accountType !== 'INTERNAL' || membership?.active !== true) throw this.forbidden();
    return {account, membership};
  }
  private normalize(input: CreateCaseExternalEntryDto) {
    const keys = Object.keys(input as object).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['customerId','defendants','entryKind','idempotencyKey','initialStage','known','lawyerAccountId','lawyerProfileId','reason','rightsHolderId','source','stageReachedOn'].sort())) throw this.invalid();
    const known = input.known;
    if (known === null || typeof known !== 'object' || JSON.stringify(Object.keys(known).sort()) !== JSON.stringify([...knownKeys].sort())) throw this.invalid();
    if (!this.date(input.stageReachedOn) || !stages.includes(input.initialStage) || !['EXTERNAL_TRANSFER','HISTORICAL_BACKFILL'].includes(input.entryKind)) throw this.invalid();
    for (const value of [input.idempotencyKey,input.source,input.reason]) if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > (value === input.idempotencyKey ? 128 : 500)) throw this.invalid();
    if (!uuid.test(input.customerId) || !uuid.test(input.rightsHolderId)) throw this.invalid();
    if ((input.lawyerAccountId === null) !== (input.lawyerProfileId === null) || (input.lawyerAccountId !== null && (!uuid.test(input.lawyerAccountId) || !uuid.test(input.lawyerProfileId!)))) throw this.invalid();
    if (!Array.isArray(input.defendants) || input.defendants.length > 20 || (input.initialStage === 'PENDING_MATCH' && (input.defendants.length !== 0 || input.lawyerAccountId !== null))) throw this.invalid();
    for (const part of input.defendants) {
      if (part === null || !['PERSON','ORGANIZATION'].includes(part.kind) || typeof part.name !== 'string' || part.name.trim() !== part.name || part.name.length < 1 || part.name.length > 200 || Object.keys(part).some((key) => !['kind','name','idNo','phone','address'].includes(key))) throw this.invalid();
      for (const [value,max] of [[part.idNo,100],[part.phone,100],[part.address,500]] as const) if (value !== undefined && (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max)) throw this.invalid();
    }
    if (known.courtId !== null && !uuid.test(known.courtId)) throw this.invalid();
    if (known.courtCaseNo !== null && (known.courtCaseNo.trim() !== known.courtCaseNo || known.courtCaseNo.length < 1 || known.courtCaseNo.length > 100)) throw this.invalid();
    if ((known.acceptedOn !== null && !this.date(known.acceptedOn)) || (known.secondInstanceAcceptedOn !== null && !this.date(known.secondInstanceAcceptedOn))) throw this.invalid();
    if (known.acceptedOn !== null && known.acceptedOn > input.stageReachedOn || known.secondInstanceAcceptedOn !== null && known.secondInstanceAcceptedOn > input.stageReachedOn) throw this.invalid();
    if (known.platform !== null && !Object.values(LeadPlatform).includes(known.platform)) throw this.invalid();
    if (known.caseType !== null && !Object.values(LeadCaseType).includes(known.caseType)) throw this.invalid();
    for (const [value,max] of [[known.shopName,200],[known.shopExternalId,100]] as const) if (value !== null && (value.trim() !== value || value.length < 1 || value.length > max)) throw this.invalid();
    if (known.infringementTypes !== null && (!Array.isArray(known.infringementTypes) || known.infringementTypes.length < 1 || known.infringementTypes.length > 12 || new Set(known.infringementTypes).size !== known.infringementTypes.length || known.infringementTypes.some((value) => !Object.values(InfringementType).includes(value)))) throw this.invalid();
    return {
      idempotencyKey:input.idempotencyKey,entryKind:input.entryKind,initialStage:input.initialStage,stageReachedOn:input.stageReachedOn,
      source:input.source,reason:input.reason,customerId:input.customerId,rightsHolderId:input.rightsHolderId,
      defendants:input.defendants.map((part) => ({kind:part.kind,name:part.name,idNo:part.idNo ?? null,phone:part.phone ?? null,address:part.address ?? null})),
      lawyerAccountId:input.lawyerAccountId,lawyerProfileId:input.lawyerProfileId,
      known:{courtId:known.courtId,courtCaseNo:known.courtCaseNo,acceptedOn:known.acceptedOn,secondInstanceAcceptedOn:known.secondInstanceAcceptedOn,platform:known.platform,shopName:known.shopName,shopExternalId:known.shopExternalId,caseType:known.caseType,infringementTypes:known.infringementTypes},
    };
  }
  async options(actor: ActorContext) {
    const {account,membership} = await this.database.$transaction((tx) => this.actorMembership(tx,actor));
    const facts = this.facts(actor,membership.teamId);
    const [canCreate,canCreateArchived] = await Promise.all([
      this.access.canAuthorizeCase(actor,'case.external-entry.create',facts),
      this.access.canAuthorizeCase(actor,'case.external-entry.archive',facts),
    ]);
    const [customers,lawyers,courts] = canCreate ? await Promise.all([
      this.access.tryBuildCustomerScope(actor,'customer.read').then((scope) => scope === null ? [] : this.database.customer.findMany({where:{...scope,departmentId:actor.departmentId,profileStatus:'ADMITTED',deletedAt:null},select:{id:true,name:true,rightsHolderLinks:{select:{rightsHolder:{select:{id:true,name:true}}}}},orderBy:{name:'asc'},take:500})),
      this.database.lawyerAccountBinding.findMany({where:{departmentId:actor.departmentId,active:true,user:{active:true,accountType:'LAWYER',localCredential:{isNot:null}}},select:{userId:true,profileId:true,profile:{select:{fullName:true,lawFirm:true}}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:500}),
      this.database.filingCourt.findMany({where:{departmentId:actor.departmentId},select:{id:true,name:true},orderBy:{name:'asc'},take:500}),
    ]) : [[],[],[]];
    return {canCreate,canCreateArchived:canCreate && canCreateArchived,currentUser:{id:account.id,displayName:account.displayName},customers:customers.map((customer) => ({id:customer.id,name:customer.name,rightsHolders:customer.rightsHolderLinks.map((link) => link.rightsHolder)})),lawyers:lawyers.map((binding) => ({accountId:binding.userId,profileId:binding.profileId,fullName:binding.profile.fullName,firm:binding.profile.lawFirm})),dictionaries:{stages:stages.map((value) => ({value,label:value})),courts,platforms:Object.values(LeadPlatform).map((value) => ({value,label:value})),caseTypes:Object.values(LeadCaseType).map((value) => ({value,label:value})),infringementTypes:Object.values(InfringementType).map((value) => ({value,label:value}))}};
  }
  async create(actor: ActorContext, raw: CreateCaseExternalEntryDto): Promise<CreateCaseExternalEntryResultDto> {
    const input = this.normalize(raw);
    const fingerprint = createHash('sha256').update(JSON.stringify({...input,idempotencyKey:undefined})).digest('hex');
    for (let attempt=0;attempt<3;attempt++) {
      try { return await this.database.$transaction(async (tx) => {
        const {membership} = await this.actorMembership(tx,actor);
        const facts = this.facts(actor,membership.teamId);
        await this.access.authorizeCase(actor,'case.external-entry.create',facts,tx);
        if (input.initialStage === 'ARCHIVED') await this.access.authorizeCase(actor,'case.external-entry.archive',facts,tx);
        const prior = await tx.caseExternalEntryReceipt.findUnique({where:{departmentId_actorUserId_idempotencyKey:{departmentId:actor.departmentId,actorUserId:actor.userId,idempotencyKey:input.idempotencyKey}}});
        if (prior !== null) {
          if (prior.requestFingerprint !== fingerprint) throw this.conflict();
          const snapshot = prior.resultSnapshot as Partial<CreateCaseExternalEntryResultDto>;
          if (snapshot.id !== prior.caseId || typeof snapshot.entryId !== 'string' || typeof snapshot.businessNo !== 'string' || !stages.includes(snapshot.stage!) || snapshot.version !== 1 || typeof snapshot.recordedAt !== 'string') throw this.conflict();
          return snapshot as CreateCaseExternalEntryResultDto;
        }
        const customerScope = await this.access.buildCustomerScope(actor,'customer.read',tx);
        const customer = await tx.customer.findFirst({where:{...customerScope,id:input.customerId,departmentId:actor.departmentId,profileStatus:'ADMITTED',deletedAt:null,rightsHolderLinks:{some:{rightsHolderId:input.rightsHolderId,departmentId:actor.departmentId}}},select:{id:true}});
        if (customer === null) throw this.forbidden();
        if (input.known.courtId !== null && await tx.filingCourt.count({where:{id:input.known.courtId,departmentId:actor.departmentId}}) !== 1) throw this.invalid();
        if (input.lawyerAccountId !== null) {
          const binding = await tx.lawyerAccountBinding.findFirst({where:{userId:input.lawyerAccountId,profileId:input.lawyerProfileId!,departmentId:actor.departmentId,active:true,user:{accountType:'LAWYER',active:true,localCredential:{isNot:null}}},select:{id:true}});
          if (binding === null) throw this.forbidden();
        }
        const today = this.todayShanghai();
        const counter = await tx.caseNumberCounter.upsert({where:{businessDate:new Date(`${today}T00:00:00.000Z`)},create:{businessDate:new Date(`${today}T00:00:00.000Z`),lastValue:1},update:{lastValue:{increment:1}}});
        const businessNo = `CA-${today.replaceAll('-','')}-${String(counter.lastValue).padStart(4,'0')}`;
        const caseId=randomUUID(), entryId=randomUUID(), auditId=randomUUID(), recordedAt=new Date();
        await tx.case.create({data:{id:caseId,businessNo,departmentId:actor.departmentId,customerId:input.customerId,rightsHolderId:input.rightsHolderId,responsibleUserId:actor.userId,stage:input.initialStage,sourceLeadId:null,sourceNotaryMatterId:null,certificateId:null,courtCaseNo:input.known.courtCaseNo}});
        await tx.auditEvent.create({data:{id:auditId,departmentId:actor.departmentId,actorUserId:actor.userId,internalActorUserId:actor.userId,resourceType:'CASE',resourceId:caseId,action:'case.external-entry.created',details:{entryId,entryKind:input.entryKind,initialStage:input.initialStage,stageReachedOn:input.stageReachedOn,source:input.source,reason:input.reason}}});
        await tx.caseExternalEntry.create({data:{id:entryId,caseId,departmentId:actor.departmentId,entryKind:input.entryKind,initialStage:input.initialStage,stageReachedOn:new Date(`${input.stageReachedOn}T00:00:00.000Z`),source:input.source,reason:input.reason,known:{...input.known},recordedByUserId:actor.userId,recordedAt,auditEventId:auditId}});
        if (input.defendants.length > 0) await tx.caseDefendant.createMany({data:input.defendants.map((party) => ({caseId,departmentId:actor.departmentId,kind:party.kind,name:party.name,idNo:party.idNo ?? null,phone:party.phone ?? null,address:party.address ?? null}))});
        if (input.lawyerProfileId !== null) await tx.caseLawyerAssignment.create({data:{caseId,departmentId:actor.departmentId,lawyerId:input.lawyerProfileId,role:'PRIMARY',startedAt:recordedAt}});
        if (stages.indexOf(input.initialStage) >= stages.indexOf('WAITING_FORMAL_ACCEPTANCE') && input.initialStage !== 'ARCHIVED') {
          const round = await tx.caseTrialRound.create({data:{caseId,departmentId:actor.departmentId,sequence:1,origin:'EXTERNAL_CURRENT',externalEntryId:entryId},select:{id:true}});
          await tx.case.update({where:{id:caseId},data:{currentTrialRoundId:round.id}});
        }
        const result: CreateCaseExternalEntryResultDto = {id:caseId,businessNo,stage:input.initialStage,version:1,entryId,recordedAt:recordedAt.toISOString()};
        await tx.caseExternalEntryReceipt.create({data:{departmentId:actor.departmentId,actorUserId:actor.userId,caseId,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint,resultSnapshot:{...result}}});
        return result;
      },{isolationLevel:'Serializable'}); } catch(error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw this.conflict();
        throw error;
      }
    }
    throw this.conflict();
  }
}
