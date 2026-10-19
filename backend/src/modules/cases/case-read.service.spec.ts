import { CaseReadService } from './case-read.service';
import { Prisma } from '../../generated/prisma/client';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
function displaySource(leadId: string, matterId: string) {
  return {
    departmentId: actor.departmentId,
    customerId: 'customer',
    rightsHolderId: 'holder',
    sourceLeadId: leadId,
    sourceNotaryMatterId: matterId,
    certificateId: 'certificate-1',
    externalEntry: null,
    customer: {
      id: 'customer',
      departmentId: actor.departmentId,
      name: '真实客户',
    },
    rightsHolder: {
      id: 'holder',
      departmentId: actor.departmentId,
      name: '真实权利主体',
    },
    sourceLead: {
      id: leadId,
      businessNo: 'LD-1',
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      platform: 'TMALL',
      shopName: '真实店铺',
      shopExternalId: null,
    },
    sourceNotaryMatter: {
      id: matterId,
      businessNo: 'NT-1',
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      sourceLeadId: leadId,
    },
    defendants: [],
    lawyers: [],
    filingSubmission: null,
    courtCaseNo: null,
    complaintSubmittedAt: null,
    complaintAmountState: null,
    complaintAmount: null,
    complaintConfirmation: null,
    currentJudgment: null,
    closure: null,
  };
}

describe('CaseReadService', () => {
  function fixture() {
    const db = {
      caseExecutionFilingFeedback: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      caseExecutionFilingSupplement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      },
      lawyerAccountBinding: {
        findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
      },
      case: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      material: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      filingCourt: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    const access = {
      buildLeadScope: jest.fn(),
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
      canAuthorizeLead: jest.fn().mockResolvedValue(false),
      buildCaseScope: jest
        .fn()
        .mockResolvedValue({ departmentId: actor.departmentId }),
      canAuthorizeCase: jest.fn().mockResolvedValue(true),
    };
    const materials = {
      listOwnerMaterials: jest.fn().mockResolvedValue({ items: [] }),
      listFrozenCaseAcceptanceFiles: jest.fn().mockResolvedValue([]),
      listFrozenCertificateFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseComplaintFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseComplaintConfirmationFile: jest
        .fn()
        .mockResolvedValue(null),
      listFrozenCaseComplaintMailingFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseExecutionMailingFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseExecutionFilingFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseExecutionFinishFiles: jest.fn().mockResolvedValue([]),
      listFrozenCaseClosureFiles: jest.fn().mockResolvedValue([]),
    };
    db.$transaction.mockImplementation(async (operation) =>
      operation({
        caseExecutionFilingFeedback: db.caseExecutionFilingFeedback,
        caseExecutionFilingSupplement: db.caseExecutionFilingSupplement,
        case: { findFirst: db.case.findFirst },
        material: db.material,
        $queryRawUnsafe: db.$queryRawUnsafe,
      }),
    );
    return {
      db,
      access,
      materials,
      service: new CaseReadService(
        db as never,
        access as never,
        materials as never,
      ),
    };
  }
  function externalRecord(stage: string) {
    const hasRound = ![
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'ARCHIVED',
    ].includes(stage);
    return {
      ...displaySource('lead', 'matter'),
      id: 'case-1',
      businessNo: 'CA-1',
      stage,
      version: 1,
      sourceLeadId: null,
      sourceNotaryMatterId: null,
      certificateId: null,
      sourceLead: null,
      sourceNotaryMatter: null,
      certificate: null,
      externalEntry: {
        id: 'entry-1',
        caseId: 'case-1',
        departmentId: actor.departmentId,
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage: stage,
        stageReachedOn: new Date('2026-10-01T00:00:00Z'),
        source: '内部来源说明',
        reason: '内部录入原因',
        recordedAt: new Date('2026-10-02T01:00:00Z'),
        recordedByUserId: actor.userId,
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
      },
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      owner: { id: actor.userId, displayName: '负责人' },
      department: { id: actor.departmentId, name: '部门' },
      createdAt: new Date('2026-10-02T01:00:00Z'),
      matchedAt: null,
      matchedOn: null,
      currentTrialRoundId: hasRound ? 'round-1' : null,
      trialRounds: hasRound
        ? [
            {
              id: 'round-1',
              sequence: 1,
              origin: 'EXTERNAL_CURRENT',
              externalEntryId: 'entry-1',
              sourceResultId: null,
              revokedAt: null,
            },
          ]
        : [],
      currentAcceptanceId: null,
      acceptance: null,
      acceptances: [],
      currentJudgmentId: null,
      judgmentFacts: [],
      currentJudgmentNextStepId: null,
      judgmentNextSteps: [],
      judgmentNextStepRevocations: [],
      currentHearingArrangementId: null,
      currentHearingArrangement: null,
      currentHearingAdvanceId: null,
      currentHearingAdvance: null,
      hearingArrangements: [],
      hearingAdvances: [],
      hearingCorrections: [],
      currentSecondInstanceProgressId: null,
      currentSecondInstanceResultId: null,
      secondInstanceProgresses: [],
      secondInstanceResults: [],
      secondInstanceAcceptanceChanges: [],
      currentExecutionSubmissionId: null,
      executionSubmissions: [],
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      archive: null,
      complaintMailing: null,
    };
  }
  describe('execution filing followup scoped read', () => {
    const first = {
      id: 'feedback-root',
      feedbackId: 'feedback-root',
      priorVersionId: null,
      fromRevision: 0,
      toRevision: 1,
      correctionReason: null,
      recordedAt: new Date('2026-10-16T00:00:00Z'),
      feedbackOn: null,
      courtCaseNo: null,
      content: '真实反馈',
    };
    const corrected = {
      ...first,
      id: 'feedback-version-2',
      priorVersionId: first.id,
      fromRevision: 1,
      toRevision: 2,
      correctionReason: '内部原因',
      content: '更正内容',
    };
    function withFiling(stage = 'EXECUTING') {
      const f = fixture();
      const record = {
        ...externalRecord('WAITING_EXECUTION_FILING'),
        stage,
        executionFiling: {
          id: 'local-filing',
          mailingId: null,
          submittedAt: new Date('2026-10-15T00:00:00Z'),
          recordedAt: new Date('2026-10-15T00:00:00Z'),
          toVersion: 2,
        },
      };
      f.db.case.findFirst.mockResolvedValue(record);
      f.db.caseExecutionFilingFeedback.findMany.mockResolvedValue([
        first,
        corrected,
      ]);
      return { ...f, record };
    }
    it('queries exact case, department and real filing inside the existing repeatable-read snapshot', async () => {
      const f = withFiling();
      const result = await f.service.get(actor, 'case-1');
      const where = {
        caseId: 'case-1',
        departmentId: actor.departmentId,
        filingId: 'local-filing',
      };
      expect(f.db.caseExecutionFilingFeedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(f.db.caseExecutionFilingSupplement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
      expect(result.executionFilingFollowups).toMatchObject({
        filingId: 'local-filing',
        feedbacks: [
          {
            current: { id: corrected.id, revision: 2 },
            history: [
              { id: first.id, correctionReason: null },
              { id: corrected.id, correctionReason: '内部原因' },
            ],
          },
        ],
      });
      expect(result.executionFiling).toEqual({
        id: 'local-filing',
        mailingId: null,
        submittedAt: '2026-10-15',
        recordedAt: '2026-10-15T00:00:00.000Z',
        files: [],
      });
    });
    it('computes each current internal action independently rather than deriving writes from case.read', async () => {
      const f = withFiling();
      f.access.canAuthorizeCase.mockImplementation(
        async (_actor: typeof actor, action: string) =>
          action === 'case.execution.feedback.record' ||
          action === 'case.execution.supplement.correct',
      );
      f.db.caseExecutionFilingSupplement.findMany.mockResolvedValue([
        {
          id: 'supplement-root',
          supplementId: 'supplement-root',
          priorVersionId: null,
          fromRevision: 0,
          toRevision: 1,
          correctionReason: null,
          recordedAt: new Date(),
          submittedOn: null,
          note: null,
          documents: [
            {
              materialId: 'supplement-material',
              contentVersionId: 'supplement-file',
              contentVersion: {
                originalFilename: '真实补交.pdf',
                mimeType: 'application/pdf',
              },
            },
          ],
        },
      ]);
      const result = await f.service.get(actor, 'case-1');
      expect(result.executionFilingFollowups).toMatchObject({
        canRecordFeedback: true,
        canSubmitSupplement: false,
        feedbacks: [{ canCorrect: false }],
        supplements: [{ canCorrect: true }],
      });
      for (const action of [
        'case.execution.feedback.record',
        'case.execution.feedback.correct',
        'case.execution.supplement.submit',
        'case.execution.supplement.correct',
      ])
        expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(actor, action, {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        });
    });
    it('keeps a true empty filing distinct from an external EXECUTING source without a local filing', async () => {
      const f = withFiling();
      f.db.caseExecutionFilingFeedback.findMany.mockResolvedValue([]);
      expect(
        (await f.service.get(actor, 'case-1')).executionFilingFollowups,
      ).toMatchObject({ feedbacks: [], supplements: [] });
      f.db.case.findFirst.mockResolvedValue(externalRecord('EXECUTING'));
      f.db.caseExecutionFilingFeedback.findMany.mockClear();
      f.db.caseExecutionFilingSupplement.findMany.mockClear();
      expect(
        (await f.service.get(actor, 'case-1')).executionFilingFollowups,
      ).toBeNull();
      expect(f.db.caseExecutionFilingFeedback.findMany).not.toHaveBeenCalled();
      expect(
        f.db.caseExecutionFilingSupplement.findMany,
      ).not.toHaveBeenCalled();
    });
    it('retains history after archive with all new write capabilities false', async () => {
      const f = withFiling('ARCHIVED');
      const closureVersion = {
        id: 'closure-version',
        kind: 'REGISTER',
        priorVersionId: null,
        finishId: 'finish',
        fromVersion: 3,
        toVersion: 4,
        closeAt: null,
        closeAmountState: 'UNKNOWN',
        closeAmt: null,
        note: null,
        correctionReason: null,
        recordedAt: new Date('2026-10-16T01:00:00Z'),
        recordedByUserId: actor.userId,
      };
      f.db.case.findFirst.mockResolvedValue({
        ...f.record,
        version: 5,
        executionFinish: {
          id: 'finish',
          filingId: 'local-filing',
          finishedAt: new Date('2026-10-16T00:00:00Z'),
          reason: 'EXECUTION_COLLECTED',
          basisNote: null,
          recordedAt: new Date('2026-10-16T00:00:00Z'),
          toVersion: 3,
        },
        closure: {
          id: 'closure',
          finishId: 'finish',
          currentVersionId: closureVersion.id,
          versions: [closureVersion],
        },
        archive: {
          id: 'archive',
          closureId: 'closure',
          closureVersionId: closureVersion.id,
          currentVersionId: 'archive-version',
          versions: [
            {
              id: 'archive-version',
              kind: 'ARCHIVE',
              priorVersionId: null,
              closureVersionId: closureVersion.id,
              fromVersion: 4,
              toVersion: 5,
              archiveAt: new Date('2026-10-16T00:00:00Z'),
              archiveType: 'EXECUTION_COLLECTED',
              archiveReason: '真实归档',
              correctionReason: null,
              recordedAt: new Date('2026-10-16T02:00:00Z'),
              recordedByUserId: actor.userId,
            },
          ],
        },
      });
      const result = await f.service.get(actor, 'case-1');
      expect(result.executionFilingFollowups).toMatchObject({
        canRecordFeedback: false,
        canSubmitSupplement: false,
        feedbacks: [{ canCorrect: false, current: { revision: 2 } }],
      });
    });
    it('retains current PRIMARY scope in the actual lawyer query and strips internal reasons from history', async () => {
      const f = withFiling();
      f.db.userAccount.findUnique.mockResolvedValue({
        accountType: 'LAWYER',
        active: true,
      });
      const result = await f.service.get(
        { ...actor, lawyerAccountId: actor.userId },
        'case-1',
      );
      expect(f.db.case.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            departmentId: actor.departmentId,
            lawyers: {
              some: expect.objectContaining({ role: 'PRIMARY', endedAt: null }),
            },
          }),
        }),
      );
      expect(result.executionFilingFollowups).toMatchObject({
        canRecordFeedback: true,
        canSubmitSupplement: true,
        feedbacks: [{ canCorrect: true }],
      });
      expect(JSON.stringify(result.executionFilingFollowups)).not.toContain(
        'correctionReason',
      );
      expect(JSON.stringify(result.executionFilingFollowups)).not.toContain(
        '内部原因',
      );
    });
  });
  it('hides prepared judgment metadata from lawyer details until exact first-consumption proof without changing ordinary files', async () => {
    const f = fixture();
    const record = externalRecord('ARCHIVED');
    const pendingId = '33333333-3333-4333-8333-333333333333';
    const ordinaryId = '44444444-4444-4444-8444-444444444444';
    f.db.case.findFirst.mockResolvedValue(record);
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const materials = [
      {
        id: 'pending-material',
        currentVersionId: pendingId,
        contentVersions: [
          {
            id: pendingId,
            originalFilename: '内部未提交判决.pdf',
            mimeType: 'application/pdf',
            caseSectionRecordUploadDraftId: 'dedicated-draft',
          },
        ],
      },
      {
        id: 'ordinary-material',
        currentVersionId: ordinaryId,
        contentVersions: [
          {
            id: ordinaryId,
            originalFilename: '原普通判决.pdf',
            mimeType: 'application/pdf',
            caseSectionRecordUploadDraftId: null,
          },
        ],
      },
    ];
    f.db.material.findMany.mockImplementation(async ({ where }) =>
      where.category === 'JUDGMENT' ? structuredClone(materials) : [],
    );
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    const before = await f.service.get(lawyer, record.id);
    expect(
      before.judgment.availableFiles.map((file) => file.contentVersionId),
    ).toEqual([ordinaryId]);
    expect(JSON.stringify(before)).not.toContain('内部未提交判决.pdf');
    expect(f.db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('case_section_upload_has_first_freeze(v.id)'),
      [pendingId],
    );
    f.db.$queryRawUnsafe.mockResolvedValue([{ id: pendingId }]);
    const after = await f.service.get(lawyer, record.id);
    expect(
      after.judgment.availableFiles.map((file) => file.contentVersionId),
    ).toEqual([pendingId, ordinaryId]);
    expect(after.judgment.availableFiles[0]).not.toHaveProperty(
      'caseSectionRecordUploadDraftId',
    );
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.db.$queryRawUnsafe.mockClear();
    expect(
      (await f.service.get(actor, record.id)).judgment.availableFiles,
    ).toHaveLength(2);
    expect(f.db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('projects corrected execution mailing separately from its frozen record and hides internal correction evidence from lawyers', async () => {
    const f = fixture();
    const originalFile = {
      materialId: 'old-material',
      contentVersionId: 'old-content',
      originalFilename: '原回执.pdf',
      mimeType: 'application/pdf',
    };
    const effectiveFile = {
      materialId: 'new-material',
      contentVersionId: 'new-content',
      originalFilename: '更正回执.pdf',
      mimeType: 'application/pdf',
    };
    const mailing = {
      id: 'mailing',
      confirmationId: 'confirmation',
      mailedAt: new Date('2026-10-01T00:00:00Z'),
      recordedAt: new Date('2026-10-02T01:00:00Z'),
    };
    const record = {
      ...externalRecord('EXECUTING'),
      executionMailing: mailing,
      executionMailingRecordCorrections: [
        {
          id: 'mailing-correction',
          mailingId: 'mailing',
          caseId: 'case-1',
          departmentId: actor.departmentId,
          priorCorrectionId: null,
          fromRevision: 0,
          toRevision: 1,
          mailedAt: new Date('2026-09-30T00:00:00Z'),
          correctionReason: '内部邮寄日期更正',
          recordedAt: new Date('2026-10-03T01:00:00Z'),
          recordedByUserId: 'correction-operator',
          caseAnchorSnapshot: { privateMarker: 'do-not-expose-anchor' },
          documents: [
            {
              materialId: effectiveFile.materialId,
              contentVersionId: effectiveFile.contentVersionId,
              contentVersion: {
                originalFilename: effectiveFile.originalFilename,
                mimeType: effectiveFile.mimeType,
              },
            },
          ],
        },
      ],
    };
    f.materials.listFrozenCaseExecutionMailingFiles.mockResolvedValue([
      originalFile,
    ]);
    f.db.case.findFirst.mockResolvedValue(record);
    const before = JSON.stringify(record);
    const detail = await f.service.get(actor, record.id);
    expect(detail).toMatchObject({
      stage: 'EXECUTING',
      version: 1,
      executionMailing: {
        id: 'mailing',
        mailedAt: '2026-09-30',
        files: [effectiveFile],
      },
      recordEdits: {
        executionMailings: [
          {
            mailingId: 'mailing',
            mailingRevision: 1,
            canEdit: true,
            original: { mailedAt: '2026-10-01', files: [originalFile] },
            effective: { mailedAt: '2026-09-30', files: [effectiveFile] },
            history: [
              {
                id: 'mailing-correction',
                correctionReason: '内部邮寄日期更正',
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(record)).toBe(before);
    expect(JSON.stringify(detail)).not.toContain('do-not-expose-anchor');
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      recordEdits: { executionMailings: [{ canEdit: false }] },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      record.id,
    );
    expect(lawyer.executionMailing).toMatchObject({
      id: 'mailing',
      mailedAt: '2026-09-30',
      files: [effectiveFile],
    });
    expect(lawyer).not.toHaveProperty('recordEdits');
    expect(JSON.stringify(lawyer)).not.toContain('内部邮寄日期更正');
    expect(JSON.stringify(lawyer)).not.toContain('correction-operator');
  });
  it('reads all six populated correction sections while preserving exact original targets, history and closure anchor', async () => {
    const f = fixture();
    const date = (day: number) =>
      new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);
    const originalFile = {
      materialId: 'original-material',
      contentVersionId: 'original-content',
      originalFilename: '原文书.pdf',
      mimeType: 'application/pdf',
    };
    const correctedFile = {
      materialId: 'corrected-material',
      contentVersionId: 'corrected-content',
      contentVersion: {
        originalFilename: '更正文书.pdf',
        mimeType: 'application/pdf',
      },
    };
    const correctedPublicFile = {
      materialId: correctedFile.materialId,
      contentVersionId: correctedFile.contentVersionId,
      ...correctedFile.contentVersion,
    };
    const metadata = {
      priorCorrectionId: null,
      fromRevision: 0,
      toRevision: 1,
      correctionReason: '内部更正原因',
      recordedAt: date(14),
      recordedByUserId: 'internal-corrector',
      caseAnchorSnapshot: { private: 'private-anchor' },
    };
    const correction = { ...metadata, documents: [correctedFile] };
    const hearing = {
      id: 'hearing',
      trialRoundId: 'round-1',
      hearingAt: date(1),
      source: 'SCHEDULE',
      recordedAt: date(1),
      recordedByUserId: actor.userId,
    };
    const judgment = {
      id: 'judgment',
      trialRoundId: 'round-1',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: date(3),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: new Prisma.Decimal('123'),
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 2,
      toVersion: 3,
      recordedAt: date(3),
      reason: null,
      recordedByUserId: actor.userId,
      versions: [
        {
          materialId: originalFile.materialId,
          contentVersionId: originalFile.contentVersionId,
          contentVersion: {
            originalFilename: originalFile.originalFilename,
            mimeType: originalFile.mimeType,
          },
        },
      ],
    };
    const finish = {
      id: 'finish',
      filingId: 'filing',
      finishedAt: date(9),
      reason: '原结束原因',
      basisNote: null,
      fromVersion: 24,
      toVersion: 25,
      recordedAt: date(9),
    };
    const closureVersion = {
      id: 'closure-version',
      kind: 'REGISTER',
      priorVersionId: null,
      finishId: finish.id,
      fromVersion: 25,
      toVersion: 26,
      closeAt: date(11),
      closeAmountState: 'KNOWN',
      closeAmt: new Prisma.Decimal('80'),
      note: '原备注',
      correctionReason: null,
      recordedAt: date(11),
      recordedByUserId: actor.userId,
    };
    const record = {
      ...externalRecord('EXECUTING'),
      stage: 'WAITING_ARCHIVE',
      version: 26,
      executionMailing: {
        id: 'mailing',
        confirmationId: 'confirmation',
        mailedAt: date(5),
        recordedAt: date(5),
      },
      executionFiling: {
        id: 'filing',
        mailingId: 'mailing',
        submittedAt: date(7),
        toVersion: 24,
        recordedAt: date(7),
      },
      executionFinish: finish,
      currentHearingArrangementId: hearing.id,
      currentHearingArrangement: hearing,
      hearingArrangements: [hearing],
      currentJudgmentId: judgment.id,
      judgmentFacts: [judgment],
      closure: {
        id: 'closure',
        finishId: finish.id,
        currentVersionId: closureVersion.id,
        versions: [closureVersion],
      },
      executionMailingRecordCorrections: [
        {
          ...correction,
          id: 'mailing-edit',
          mailingId: 'mailing',
          mailedAt: date(6),
        },
      ],
      executionFilingRecordCorrections: [
        {
          ...correction,
          id: 'filing-edit',
          filingId: 'filing',
          submittedAt: date(8),
        },
      ],
      executionFinishRecordCorrections: [
        {
          ...correction,
          id: 'finish-edit',
          finishId: 'finish',
          finishedAt: date(10),
          businessReason: '更正结束业务原因',
          basisNote: '依据说明',
        },
      ],
      hearingRecordCorrections: [
        {
          ...metadata,
          id: 'hearing-edit',
          arrangementId: hearing.id,
          trialRoundId: hearing.trialRoundId,
          hearingAt: date(2),
        },
      ],
      judgmentRecordCorrections: [
        {
          ...correction,
          id: 'judgment-edit',
          judgmentId: judgment.id,
          trialRoundId: judgment.trialRoundId,
          judgmentReceivedAt: date(4),
          judgmentAmountState: 'KNOWN',
          judgmentAmount: new Prisma.Decimal('100'),
          paidLitigationFeeState: 'KNOWN',
          paidLitigationFee: new Prisma.Decimal('0'),
        },
      ],
      closureRecordCorrections: [
        {
          ...correction,
          id: 'closure-edit',
          closureId: 'closure',
          sourceClosureVersionId: closureVersion.id,
          closeAt: date(12),
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: null,
        },
      ],
    };
    for (const method of [
      f.materials.listFrozenCaseExecutionMailingFiles,
      f.materials.listFrozenCaseExecutionFilingFiles,
      f.materials.listFrozenCaseExecutionFinishFiles,
      f.materials.listFrozenCaseClosureFiles,
    ])
      method.mockResolvedValue([originalFile]);
    f.db.case.findFirst.mockResolvedValue(record);
    const originalSnapshot = JSON.stringify(record);
    const detail = await f.service.get(actor, record.id);
    expect(detail).toMatchObject({
      stage: 'WAITING_ARCHIVE',
      version: 26,
      executionMailing: {
        id: 'mailing',
        mailedAt: '2026-10-06',
        files: [correctedPublicFile],
      },
      executionFiling: {
        id: 'filing',
        submittedAt: '2026-10-08',
        files: [correctedPublicFile],
      },
      executionFinish: {
        id: 'finish',
        finishedAt: '2026-10-10',
        reason: '更正结束业务原因',
        basisNote: '依据说明',
        files: [correctedPublicFile],
      },
      hearing: {
        currentArrangement: { id: 'hearing', hearingAt: '2026-10-02' },
        arrangements: [{ id: 'hearing', hearingAt: '2026-10-01' }],
      },
      judgment: {
        current: {
          id: 'judgment',
          judgmentReceivedAt: '2026-10-04',
          judgmentAmount: '100.00',
          paidLitigationFee: '0.00',
          files: [correctedPublicFile],
        },
        history: [
          { id: 'judgment', judgmentAmount: '123.00', files: [originalFile] },
        ],
      },
      closure: {
        id: 'closure',
        current: {
          id: 'closure-version',
          closeAt: '2026-10-12',
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: null,
          files: [correctedPublicFile],
        },
        history: [
          {
            id: 'closure-version',
            closeAt: '2026-10-11',
            closeAmt: '80.00',
            files: [originalFile],
          },
        ],
      },
      recordEdits: {
        executionMailings: [
          { mailingId: 'mailing', mailingRevision: 1, canEdit: true },
        ],
        executionFilings: [
          { filingId: 'filing', filingRevision: 1, canEdit: true },
        ],
        executionFinishes: [
          { finishId: 'finish', finishRevision: 1, canEdit: true },
        ],
        hearings: [
          {
            arrangementId: 'hearing',
            trialRoundId: 'round-1',
            hearingRevision: 1,
            canEdit: true,
          },
        ],
        judgments: [
          {
            judgmentId: 'judgment',
            trialRoundId: 'round-1',
            judgmentRevision: 1,
            canEdit: true,
          },
        ],
        closures: [{ closureId: 'closure', closureRevision: 1, canEdit: true }],
      },
    });
    expect(JSON.stringify(detail)).not.toContain('private-anchor');
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      record.id,
    );
    expect(lawyer.judgment.current).toMatchObject({ judgmentAmount: '100.00' });
    expect(lawyer.closure?.current).toMatchObject({
      id: 'closure-version',
      closeAt: '2026-10-12',
    });
    expect(lawyer).not.toHaveProperty('recordEdits');
    expect(JSON.stringify(lawyer)).not.toContain('内部更正原因');
    expect(JSON.stringify(lawyer)).not.toContain('internal-corrector');
    expect(JSON.stringify(record)).toBe(originalSnapshot);
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      closureRecordCorrections: [
        {
          ...record.closureRecordCorrections[0],
          sourceClosureVersionId: 'foreign-version',
        },
      ],
    });
    await expect(f.service.get(actor, record.id)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
  });

  it.each([
    ['SECOND_INSTANCE', 'canSaveSecondInstance'],
    ['WAITING_EXECUTION_DOCUMENTS', 'canSubmitExecution'],
    ['WAITING_EXECUTION_CONFIRMATION', 'canConfirmExecution'],
    ['WAITING_EXECUTION_STAMP', 'canMailExecution'],
    ['WAITING_EXECUTION_FILING', 'canSubmitExecutionFiling'],
    ['EXECUTING', 'canFinishExecution'],
    ['WAITING_ARCHIVE', 'canRecordClosure'],
  ])(
    'exposes only authorized direct-source %s capabilities in list and detail',
    async (stage, capability) => {
      const f = fixture();
      const record = externalRecord(stage);
      f.db.case.findMany.mockResolvedValue([record]);
      f.db.case.findFirst.mockResolvedValue(record);
      expect(await f.service.get(actor, record.id)).toMatchObject({
        [capability]: true,
        sourceLead: null,
        sourceNotaryMatter: null,
        certificate: null,
        fees: [],
      });
      expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
        [capability]: true,
      });
      f.access.canAuthorizeCase.mockResolvedValue(false);
      expect(await f.service.get(actor, record.id)).toMatchObject({
        [capability]: false,
      });
      expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
        [capability]: false,
      });
      f.access.canAuthorizeCase.mockResolvedValue(true);
      record.externalEntry.initialStage = 'PENDING_MATCH';
      expect(await f.service.get(actor, record.id)).toMatchObject({
        [capability]: false,
      });
      expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
        [capability]: false,
      });
    },
  );
  it('exposes direct confirmation material upload separately from submit and confirm rights', async () => {
    const f = fixture();
    const record = externalRecord('WAITING_EXECUTION_CONFIRMATION');
    f.db.case.findMany.mockResolvedValue([record]);
    f.db.case.findFirst.mockResolvedValue(record);
    const detail = await f.service.get(actor, record.id);
    const item = (await f.service.list(actor, 1, 20)).items[0];
    for (const value of [detail, item])
      expect(value).toMatchObject({
        canUploadDirectExecutionMaterials: true,
        canSubmitExecution: false,
      });
    expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.submit',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
    );
    f.access.canAuthorizeCase.mockImplementation(
      async (_actor, action) => action === 'case.execution.confirm',
    );
    expect(await f.service.get(actor, record.id)).toMatchObject({
      canUploadDirectExecutionMaterials: false,
      canConfirmExecution: true,
    });
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canUploadDirectExecutionMaterials: false,
      canConfirmExecution: true,
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyerActor = { ...actor, lawyerAccountId: actor.userId };
    expect(await f.service.get(lawyerActor, record.id)).toMatchObject({
      canUploadDirectExecutionMaterials: true,
      canSubmitExecution: false,
    });
    expect((await f.service.list(lawyerActor, 1, 20)).items[0]).toMatchObject({
      canUploadDirectExecutionMaterials: true,
    });
    const falseCases = [
      {
        externalEntry: {
          ...record.externalEntry,
          initialStage: 'WAITING_EXECUTION_DOCUMENTS',
        },
      },
      { currentExecutionSubmissionId: 'submission-1' },
      { executionConfirmation: { id: 'confirmation-1' } },
      {
        trialRounds: [
          { ...record.trialRounds[0], externalEntryId: 'other-entry' },
        ],
      },
      { stage: 'WAITING_EXECUTION_STAMP' },
      displaySource('lead', 'matter'),
    ];
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.access.canAuthorizeCase.mockResolvedValue(true);
    for (const change of falseCases) {
      f.db.case.findMany.mockResolvedValue([{ ...record, ...change }]);
      expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
        canUploadDirectExecutionMaterials: false,
      });
    }
  });
  it('uses the material upload case facts for SELF and TEAM grants in list and detail', async () => {
    const f = fixture();
    const source = externalRecord('WAITING_EXECUTION_CONFIRMATION');
    const read = async (responsibleUserId: string, teamId: string | null) => {
      const record = {
        ...source,
        responsibleUserId,
        responsibleMembership: { teamId },
      };
      f.db.case.findFirst.mockResolvedValue(record);
      f.db.case.findMany.mockResolvedValue([record]);
      const detail = await f.service.get(actor, record.id);
      const item = (await f.service.list(actor, 1, 20)).items[0];
      expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
        actor,
        'case.execution.submit',
        {
          departmentId: actor.departmentId,
          responsibleUserId,
          ...(teamId ? { teamId } : {}),
        },
      );
      return [
        detail.canUploadDirectExecutionMaterials,
        item.canUploadDirectExecutionMaterials,
      ];
    };
    f.access.canAuthorizeCase.mockImplementation(
      async (_actor, action, facts) =>
        action === 'case.execution.submit' &&
        facts.responsibleUserId === actor.userId,
    );
    expect(await read(actor.userId, null)).toEqual([true, true]);
    expect(await read('other-user', null)).toEqual([false, false]);
    f.access.canAuthorizeCase.mockImplementation(
      async (_actor, action, facts) =>
        action === 'case.execution.submit' && facts.teamId === 'team-1',
    );
    expect(await read('other-user', 'team-1')).toEqual([true, true]);
    expect(await read('other-user', 'team-2')).toEqual([false, false]);
  });
  it('resolves known court names only within authorized case department and without an acceptance fact', async () => {
    const f = fixture();
    const base = externalRecord('SECOND_INSTANCE');
    const record = {
      ...base,
      externalEntry: {
        ...base.externalEntry,
        known: { ...base.externalEntry.known, courtId: 'known-court' },
      },
    };
    f.db.case.findMany.mockResolvedValue([record]);
    f.db.filingCourt.findMany.mockResolvedValue([
      { id: 'known-court', name: '原审已知法院' },
    ]);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      displaySummary: { court: { id: 'known-court', name: '原审已知法院' } },
    });
    expect(f.db.filingCourt.findMany).toHaveBeenCalledWith({
      where: { departmentId: actor.departmentId, id: { in: ['known-court'] } },
      select: { id: true, name: true },
    });
    f.db.filingCourt.findMany.mockResolvedValue([]);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      displaySummary: { court: null },
    });
  });
  it('keeps direct archived entry read-only without fabricating terminal facts and rejects normal missing archives', async () => {
    const f = fixture();
    const record = externalRecord('ARCHIVED');
    f.db.case.findFirst.mockResolvedValue(record);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      stage: 'ARCHIVED',
      archive: null,
      closure: null,
      executionFinish: null,
      canArchive: false,
      canCorrectArchive: false,
      canRecordClosure: false,
      canCorrectClosure: false,
    });
    record.version = 2;
    await expect(f.service.get(actor, record.id)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      version: 1,
      externalEntry: null,
      sourceLead: { id: 'lead' },
      sourceNotaryMatter: { id: 'matter' },
      certificate: { id: 'certificate' },
    });
    await expect(f.service.get(actor, record.id)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
  });
  it('reads real closure and archive after a waiting-archive entry without fabricating an execution finish', async () => {
    const f = fixture();
    const closureVersion = {
      id: 'closure-version',
      kind: 'REGISTER',
      priorVersionId: null,
      finishId: null,
      fromVersion: 1,
      toVersion: 2,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: '真实结案登记',
      correctionReason: null,
      recordedAt: new Date('2026-10-03T00:00:00Z'),
      recordedByUserId: actor.userId,
    };
    const record = {
      ...externalRecord('WAITING_ARCHIVE'),
      stage: 'ARCHIVED',
      version: 3,
      closure: {
        id: 'closure',
        finishId: null,
        currentVersionId: closureVersion.id,
        versions: [closureVersion],
      },
      archive: {
        id: 'archive',
        closureId: 'closure',
        closureVersionId: closureVersion.id,
        currentVersionId: 'archive-version',
        versions: [
          {
            id: 'archive-version',
            kind: 'ARCHIVE',
            priorVersionId: null,
            closureVersionId: closureVersion.id,
            fromVersion: 2,
            toVersion: 3,
            archiveAt: new Date('2026-10-04T00:00:00Z'),
            archiveType: 'OTHER',
            archiveReason: '真实归档原因',
            correctionReason: null,
            recordedAt: new Date('2026-10-04T01:00:00Z'),
            recordedByUserId: actor.userId,
          },
        ],
      },
    };
    f.db.case.findFirst.mockResolvedValue(record);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      executionFinish: null,
      closure: { finishId: null },
      archive: { closureId: 'closure', closureVersionId: closureVersion.id },
      canCorrectArchive: true,
    });
    record.externalEntry.initialStage = 'EXECUTING';
    await expect(f.service.get(actor, record.id)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    record.externalEntry.initialStage = 'WAITING_ARCHIVE';
    closureVersion.fromVersion = 9;
    await expect(f.service.get(actor, record.id)).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
  });
  it('provides direct second-instance acceptance coordinates without an invented appeal and restricts lawyer origin metadata', async () => {
    const f = fixture();
    const record = externalRecord('SECOND_INSTANCE');
    f.db.case.findFirst.mockResolvedValue(record);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      recordEdits: {
        canSaveSecondInstanceAcceptance: true,
        secondInstanceAcceptances: [
          {
            choiceId: null,
            trialRoundId: 'round-1',
            acceptanceRevision: 0,
            acceptedAt: null,
            courtCaseNo: null,
            canEdit: true,
            history: [],
          },
        ],
      },
      judgmentNextStep: { current: null, history: [] },
    });
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      recordEdits: {
        canSaveSecondInstanceAcceptance: false,
        secondInstanceAcceptances: [{ canEdit: false }],
      },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      record.id,
    );
    expect(lawyer.origin).toEqual({
      kind: 'EXTERNAL_ENTRY',
      entryKind: 'HISTORICAL_BACKFILL',
      initialStage: 'SECOND_INSTANCE',
      stageReachedOn: '2026-10-01',
    });
    expect(lawyer).not.toHaveProperty('recordEdits');
    expect(lawyer.origin).not.toHaveProperty('known');
    expect(lawyer.origin).not.toHaveProperty('reason');
  });
  it('reads a directly confirmed frozen package from real confirmation versions without a fake submission', async () => {
    const f = fixture();
    const record = {
      ...externalRecord('WAITING_EXECUTION_CONFIRMATION'),
      stage: 'WAITING_EXECUTION_STAMP',
      version: 2,
      executionConfirmation: {
        id: 'confirmation-1',
        submissionId: null,
        confirmedAt: new Date('2026-10-02T02:00:00Z'),
        confirmedByUserId: actor.userId,
        versions: [
          {
            materialId: 'material-1',
            contentVersionId: 'version-1',
            contentVersion: {
              originalFilename: 'real.pdf',
              mimeType: 'application/pdf',
              createdAt: new Date('2026-10-02T01:00:00Z'),
            },
          },
        ],
      },
    };
    f.db.case.findFirst.mockResolvedValue(record);
    expect(await f.service.get(actor, record.id)).toMatchObject({
      executionSubmission: { current: null, submissions: [] },
      executionConfirmation: {
        submissionId: null,
        files: [
          {
            materialId: 'material-1',
            contentVersionId: 'version-1',
            originalFilename: 'real.pdf',
          },
        ],
      },
      canMailExecution: true,
    });
    expect(
      (await f.service.get(actor, record.id)).executionConfirmation,
    ).toHaveProperty('confirmedByUserId', actor.userId);
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      record.id,
    );
    expect(lawyer.executionConfirmation).toMatchObject({
      id: 'confirmation-1',
      submissionId: null,
      files: [{ contentVersionId: 'version-1' }],
    });
    expect(lawyer.executionConfirmation).not.toHaveProperty(
      'confirmedByUserId',
    );
  });
  it('authorizes before a repeatable-read detail aggregate for internal and lawyer', async () => {
    const f = fixture();
    await expect(f.service.get(actor, 'case-1')).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(
      f.access.authorizeDepartmentAction.mock.invocationCallOrder[0],
    ).toBeLessThan(f.db.$transaction.mock.invocationCallOrder[0]);
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    await expect(
      f.service.get({ ...actor, lawyerAccountId: actor.userId }, 'case-1'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
    expect(f.db.lawyerAccountBinding.findFirst).toHaveBeenCalled();
    expect(
      f.db.lawyerAccountBinding.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(f.db.$transaction.mock.invocationCallOrder[1]);
    expect(f.db.case.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lawyers: expect.any(Object) }),
      }),
    );
  });
  it('lists only currently authorized internal department cases', async () => {
    const f = fixture();
    expect(
      await (f.service.list as (...args: unknown[]) => Promise<unknown>)(
        actor,
        1,
        20,
        'department',
      ),
    ).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
        WAITING_HEARING: 0,
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
      },
    });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
    );
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
        }),
      }),
    );
  });
  it('denies client and notary accounts before querying cases', async () => {
    const f = fixture();
    await expect(
      f.service.list(
        { ...actor, clientCustomerId: '33333333-3333-4333-8333-333333333333' },
        1,
        20,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      f.service.list(
        { ...actor, notaryOfficeId: '44444444-4444-4444-8444-444444444444' },
        1,
        20,
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.db.case.findMany).not.toHaveBeenCalled();
  });

  it('lists only current primary assignments for a lawyer account', async () => {
    const f = fixture();
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    await f.service.list(lawyer, 1, 20);
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          lawyers: {
            some: expect.objectContaining({
              role: 'PRIMARY',
              endedAt: null,
            }),
          },
        }),
      }),
    );
  });

  it('reads four fees by original source without inventing a court case number', async () => {
    const f = fixture();
    const historicalAcceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: new Date('2026-10-01T00:00:00.000Z'),
      courtCaseNo: 'OLD-CASE-NO',
      corrections: [
        {
          id: 'acceptance-correction-1',
          priorCorrectionId: null,
          fromRevision: 0,
          toRevision: 1,
          acceptedAt: new Date('2026-10-02T00:00:00.000Z'),
          courtCaseNo: 'CORRECTED-CASE-NO',
          reason: 'recording correction',
          recordedAt: new Date('2026-10-12T01:00:00.000Z'),
          recordedByUserId: actor.userId,
        },
      ],
      recordedAt: new Date('2026-10-01T01:00:00.000Z'),
      recordedByUserId: actor.userId,
      versions: [
        {
          category: 'ACCEPTANCE_NOTICE',
          materialId: 'material-1',
          contentVersionId: 'version-1',
          contentVersion: {
            originalFilename: 'old.pdf',
            mimeType: 'application/pdf',
          },
        },
      ],
    };
    const record = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'PENDING_MATCH',
      version: 1,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      currentJudgmentId: null,
      judgmentFacts: [],
      currentTrialRoundId: null,
      acceptances: [historicalAcceptance],
      currentSecondInstanceProgressId: null,
      currentSecondInstanceResultId: null,
      trialRounds: [],
      secondInstanceProgresses: [],
      secondInstanceResults: [],
      currentHearingAdvanceId: 'advance-1',
      currentHearingArrangement: {
        id: 'arrangement-1',
        trialRoundId: 'round-1',
        hearingAt: new Date('2026-10-08T00:00:00.000Z'),
        source: 'SCHEDULE',
        recordedAt: new Date('2026-10-07T01:00:00.000Z'),
        recordedByUserId: actor.userId,
      },
      currentHearingAdvance: {
        id: 'advance-1',
        trialRoundId: 'round-1',
        arrangementId: 'arrangement-1',
        dueAt: new Date('2026-10-08T16:00:00.000Z'),
        executedAt: new Date('2026-10-08T16:00:01.000Z'),
      },
      hearingArrangements: [
        {
          id: 'arrangement-1',
          trialRoundId: 'round-1',
          hearingAt: new Date('2026-10-08T00:00:00.000Z'),
          source: 'SCHEDULE',
          recordedAt: new Date('2026-10-07T01:00:00.000Z'),
          recordedByUserId: actor.userId,
        },
      ],
      hearingAdvances: [
        {
          id: 'advance-1',
          trialRoundId: 'round-1',
          arrangementId: 'arrangement-1',
          dueAt: new Date('2026-10-08T16:00:00.000Z'),
          executedAt: new Date('2026-10-08T16:00:01.000Z'),
        },
      ],
      hearingCorrections: [
        {
          id: 'correction-1',
          priorArrangementId: 'arrangement-1',
          priorAdvanceId: 'advance-1',
          newArrangementId: 'arrangement-2',
          resultStage: 'WAITING_HEARING',
          recordedAt: new Date('2026-10-09T01:00:00.000Z'),
          recordedByUserId: actor.userId,
          reason: '改期',
        },
      ],
      matchedAt: null,
      matchedOn: null,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      defendants: [],
      lawyers: [],
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
      courtCaseNo: null,
      owner: { id: actor.userId, displayName: '负责人' },
      department: { id: actor.departmentId, name: '品维' },
      customer: { id: 'customer-1', name: '客户' },
      rightsHolder: { id: 'rights-1', name: '主体' },
      sourceLead: {
        id: 'lead-1',
        businessNo: 'LD-1',
      },
      externalEntry: null,
      sourceNotaryMatter: {
        id: 'matter-1',
        businessNo: 'NT-1',
        evidence: {
          matterId: 'matter-1',
          sampleFeeState: 'KNOWN',
          sampleFeeAmount: { toString: () => '200' },
        },
      },
      certificate: {
        id: 'certificate-1',
        certificateNo: '证001',
        certificateDate: new Date('2026-09-28T00:00:00.000Z'),
        issuedAt: new Date('2026-09-28T01:00:00.000Z'),
        needDisclose: false,
        fees: [
          {
            category: 'NOTARY',
            state: 'KNOWN',
            amount: { toString: () => '100' },
          },
          { category: 'INVESTIGATION', state: 'PENDING', amount: null },
          {
            category: 'DISCLOSURE',
            state: 'KNOWN',
            amount: { toString: () => '0' },
          },
        ],
      },
    };
    f.db.case.findFirst.mockResolvedValue(record);
    const result = await f.service.get(actor, 'case-1');
    expect(result.acceptance).toBeNull();
    expect(result.acceptances[0]).toMatchObject({
      trialRoundId: 'round-1',
      courtCaseNo: 'CORRECTED-CASE-NO',
      recordedByUserId: actor.userId,
      files: [{ category: 'ACCEPTANCE_NOTICE', contentVersionId: 'version-1' }],
    });
    expect(result.hearing.currentArrangement).toMatchObject({
      hearingAt: '2026-10-08',
      recordedByUserId: actor.userId,
    });
    expect(result.hearing.currentAdvance).toMatchObject({
      dueAt: '2026-10-08T16:00:00.000Z',
      executedAt: '2026-10-08T16:00:01.000Z',
    });
    expect(result.hearing.corrections[0]).toMatchObject({ reason: '改期' });
    expect(result).toMatchObject({
      recordEdits: {
        acceptanceCorrections: [
          {
            acceptanceId: 'acceptance-1',
            originalAcceptedAt: '2026-10-01',
            originalCourtCaseNo: 'OLD-CASE-NO',
            acceptanceRevision: 1,
            history: [
              { acceptedAt: '2026-10-02', courtCaseNo: 'CORRECTED-CASE-NO' },
            ],
          },
        ],
      },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_JUDGMENT',
      currentJudgmentNextStepId: null,
    });
    const lawyerDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(lawyerDetail.acceptances[0]).not.toHaveProperty('recordedByUserId');
    expect(lawyerDetail.acceptances[0]).toMatchObject({
      acceptedAt: '2026-10-02',
      courtCaseNo: 'CORRECTED-CASE-NO',
    });
    expect(lawyerDetail).not.toHaveProperty('recordEdits');
    expect(lawyerDetail.acceptances[0].files[0]).toMatchObject({
      category: 'ACCEPTANCE_NOTICE',
      contentVersionId: 'version-1',
    });
    expect(lawyerDetail.hearing.currentArrangement).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(lawyerDetail.hearing.corrections[0]).not.toHaveProperty('reason');
    expect(lawyerDetail.hearing.corrections[0]).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(lawyerDetail).toMatchObject({
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      judgmentNextStep: { current: null, history: [], revocations: [] },
    });

    const executionFinish = {
      id: 'finish-1',
      filingId: 'filing-1',
      finishedAt: new Date('2026-10-01T00:00:00Z'),
      reason: '真实原因',
      basisNote: '真实依据',
      recordedAt: new Date('2026-10-13T01:00:00Z'),
    };
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_ARCHIVE',
      version: 25,
      executionFinish,
    });
    const finishedDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(finishedDetail.executionFinish).toEqual({
      ...executionFinish,
      finishedAt: '2026-10-01',
      recordedAt: '2026-10-13T01:00:00.000Z',
      files: [],
    });
    expect(finishedDetail.canFinishExecution).toBe(false);
    expect(f.materials.listFrozenCaseExecutionFinishFiles).toHaveBeenCalledWith(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    const closureVersion = {
      id: 'closure-version',
      kind: 'REGISTER',
      priorVersionId: null,
      finishId: executionFinish.id,
      fromVersion: 25,
      toVersion: 26,
      closeAt: null,
      closeAmountState: 'KNOWN',
      closeAmt: { toFixed: () => '0.00' },
      note: '真实结案',
      correctionReason: null,
      recordedAt: new Date('2026-10-13T02:00:00Z'),
      recordedByUserId: actor.userId,
    };
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_ARCHIVE',
      version: 26,
      executionFinish,
      closure: {
        id: 'closure',
        finishId: executionFinish.id,
        currentVersionId: closureVersion.id,
        versions: [closureVersion],
      },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    const closedInternal = await f.service.get(actor, 'case-1');
    expect(closedInternal).not.toHaveProperty('displaySummary');
    expect(closedInternal.closure?.current).toMatchObject({
      closeAt: null,
      closeAmt: '0.00',
      recordedByUserId: actor.userId,
    });
    expect(closedInternal.canRecordClosure).toBe(false);
    expect(closedInternal.canCorrectClosure).toBe(true);
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const closedLawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(closedLawyer.canCorrectClosure).toBe(false);
    expect(closedLawyer.closure?.current).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(closedLawyer.closure?.current).not.toHaveProperty(
      'correctionReason',
    );
    expect(closedLawyer.closure?.history[0]).not.toHaveProperty(
      'correctionReason',
    );
    const archiveVersion = {
      id: 'archive-v1',
      kind: 'ARCHIVE',
      priorVersionId: null,
      closureVersionId: closureVersion.id,
      fromVersion: 26,
      toVersion: 27,
      archiveAt: new Date('2020-01-01T00:00:00Z'),
      archiveType: 'EXECUTION_COLLECTED',
      archiveReason: '真实归档分类',
      correctionReason: null,
      recordedAt: new Date('2026-10-14T01:00:00Z'),
      recordedByUserId: actor.userId,
    };
    const archivedRecord = {
      ...record,
      stage: 'ARCHIVED',
      version: 27,
      executionFinish: { ...executionFinish, toVersion: 25 },
      closure: {
        id: 'closure',
        finishId: executionFinish.id,
        currentVersionId: closureVersion.id,
        versions: [closureVersion],
      },
      archive: {
        id: 'archive',
        closureId: 'closure',
        closureVersionId: closureVersion.id,
        currentVersionId: archiveVersion.id,
        versions: [archiveVersion],
      },
    };
    f.db.case.findFirst.mockResolvedValue(archivedRecord);
    const archivedLawyer = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(archivedLawyer.canArchive).toBe(false);
    expect(archivedLawyer.canCorrectArchive).toBe(false);
    expect(archivedLawyer.canCorrectClosure).toBe(false);
    expect(archivedLawyer.archive?.current).toMatchObject({
      archiveReason: '真实归档分类',
      archiveAt: '2020-01-01',
    });
    expect(archivedLawyer.archive?.current).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(archivedLawyer.archive?.history[0]).not.toHaveProperty(
      'correctionReason',
    );
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    const archivedInternal = await f.service.get(actor, 'case-1');
    expect(archivedInternal.canCorrectArchive).toBe(true);
    expect(archivedInternal.canRecordClosure).toBe(false);
    expect(archivedInternal.archive?.current).toMatchObject({
      recordedByUserId: actor.userId,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...archivedRecord,
      archive: {
        ...archivedRecord.archive,
        versions: [{ ...archiveVersion, fromVersion: 25 }],
      },
    });
    await expect(f.service.get(actor, 'case-1')).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    f.db.case.findFirst.mockResolvedValue({ ...archivedRecord, archive: null });
    await expect(f.service.get(actor, 'case-1')).rejects.toMatchObject({
      response: { code: 'CASE_NOT_FOUND' },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const judgment = {
      id: 'judgment-1',
      trialRoundId: 'round-1',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: new Date('2026-10-08T00:00:00.000Z'),
      judgmentAmountState: 'PENDING',
      judgmentAmount: null,
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      reason: 'internal judgment reason',
      recordedAt: new Date('2026-10-08T01:00:00.000Z'),
      recordedByUserId: 'internal-judgment-user',
      fromVersion: 2,
      toVersion: 3,
      versions: [],
    };
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_JUDGMENT',
      version: 3,
      currentJudgmentId: judgment.id,
      currentJudgmentNextStepId: null,
      judgmentFacts: [judgment],
      judgmentNextSteps: [],
      judgmentNextStepRevocations: [],
    });
    const eligibleLawyerDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(eligibleLawyerDetail).toMatchObject({
      canChooseJudgmentNextStep: true,
      canRevokeJudgmentNextStep: false,
      judgmentNextStep: { current: null, history: [], revocations: [] },
    });

    const choices = [
      {
        id: 'choice-1',
        trialRoundId: 'round-1',
        judgmentId: judgment.id,
        next: 'APPEAL',
        plaintiffRightsHolderId: 'rights-1',
        plaintiffName: '原告',
        defendants: [{ defendantId: 'defendant-1', nameSnapshot: '被告' }],
        executionReadinessConfirmed: false,
        fromVersion: 3,
        toVersion: 4,
        recordedAt: new Date('2026-10-09T01:00:00.000Z'),
        recordedByUserId: 'internal-choice-user',
      },
      {
        id: 'choice-2',
        trialRoundId: 'round-1',
        judgmentId: judgment.id,
        next: 'EXECUTION',
        plaintiffRightsHolderId: null,
        plaintiffName: null,
        defendants: [],
        executionReadinessConfirmed: true,
        fromVersion: 5,
        toVersion: 6,
        recordedAt: new Date('2026-10-10T01:00:00.000Z'),
        recordedByUserId: 'internal-choice-user-2',
      },
    ];
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 6,
      currentJudgmentId: judgment.id,
      currentJudgmentNextStepId: choices[1].id,
      judgmentFacts: [judgment],
      judgmentNextSteps: choices,
      judgmentNextStepRevocations: [
        {
          id: 'revocation-1',
          choiceId: choices[0].id,
          reason: 'internal revocation reason',
          fromVersion: 4,
          toVersion: 5,
          recordedAt: new Date('2026-10-09T02:00:00.000Z'),
          recordedByUserId: 'internal-revocation-user',
        },
      ],
    });
    const historyLawyerDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(historyLawyerDetail).toMatchObject({
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      judgmentNextStep: {
        current: {
          id: 'choice-2',
          next: 'EXECUTION',
          executionReadinessConfirmed: true,
        },
        history: [
          {
            id: 'choice-1',
            defendants: [{ defendantId: 'defendant-1', nameSnapshot: '被告' }],
          },
          { id: 'choice-2', judgmentId: judgment.id },
        ],
        revocations: [{ id: 'revocation-1', choiceId: 'choice-1' }],
      },
    });
    expect(historyLawyerDetail).toHaveProperty('judgmentNextStep.history', [
      {
        id: 'choice-1',
        trialRoundId: 'round-1',
        judgmentId: judgment.id,
        next: 'APPEAL',
        plaintiffRightsHolderId: 'rights-1',
        plaintiffName: '原告',
        defendants: [{ defendantId: 'defendant-1', nameSnapshot: '被告' }],
        executionReadinessConfirmed: false,
        fromVersion: 3,
        toVersion: 4,
        recordedAt: '2026-10-09T01:00:00.000Z',
      },
      {
        id: 'choice-2',
        trialRoundId: 'round-1',
        judgmentId: judgment.id,
        next: 'EXECUTION',
        plaintiffRightsHolderId: null,
        plaintiffName: null,
        defendants: [],
        executionReadinessConfirmed: true,
        fromVersion: 5,
        toVersion: 6,
        recordedAt: '2026-10-10T01:00:00.000Z',
      },
    ]);
    expect(historyLawyerDetail).toHaveProperty('judgmentNextStep.revocations', [
      {
        id: 'revocation-1',
        choiceId: 'choice-1',
        fromVersion: 4,
        toVersion: 5,
        recordedAt: '2026-10-09T02:00:00.000Z',
      },
    ]);
    expect(historyLawyerDetail).not.toHaveProperty(
      'judgmentNextStep.history.0.recordedByUserId',
    );
    expect(historyLawyerDetail).not.toHaveProperty(
      'judgmentNextStep.history.1.recordedByUserId',
    );
    expect(historyLawyerDetail).not.toHaveProperty(
      'judgmentNextStep.revocations.0.reason',
    );
    expect(historyLawyerDetail).not.toHaveProperty(
      'judgmentNextStep.revocations.0.recordedByUserId',
    );
    expect(historyLawyerDetail).not.toHaveProperty('judgment.history.0.reason');
    expect(historyLawyerDetail).not.toHaveProperty(
      'judgment.history.0.recordedByUserId',
    );
    expect(historyLawyerDetail).not.toHaveProperty('owner');
    expect(historyLawyerDetail).not.toHaveProperty('department');
    expect(historyLawyerDetail).not.toHaveProperty('fees');
    expect(historyLawyerDetail).toMatchObject({
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      canSubmitExecution: false,
    });

    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    const historyInternalDetail = await f.service.get(actor, 'case-1');
    expect(historyInternalDetail).toHaveProperty(
      'judgmentNextStep.history.0.recordedByUserId',
      'internal-choice-user',
    );
    expect(historyInternalDetail).toHaveProperty(
      'judgmentNextStep.revocations.0.reason',
      'internal revocation reason',
    );
    expect(historyInternalDetail).toHaveProperty(
      'judgmentNextStep.revocations.0.recordedByUserId',
      'internal-revocation-user',
    );
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 7,
      currentTrialRoundId: 'round-1',
      currentJudgmentId: judgment.id,
      currentJudgmentNextStepId: 'choice-2',
      currentExecutionSubmissionId: 'submission-1',
      judgmentFacts: [judgment],
      judgmentNextSteps: choices,
      judgmentNextStepRevocations: [],
      executionSubmissions: [
        {
          id: 'submission-1',
          trialRoundId: 'round-1',
          judgmentNextStepId: 'choice-2',
          secondInstanceResultId: null,
          priorSubmissionId: null,
          changeReason: null,
          fromVersion: 6,
          toVersion: 7,
          submittedAt: new Date('2026-10-11T02:00:00.000Z'),
          versions: [
            {
              materialId: 'execution-material-1',
              contentVersionId: 'execution-version-1',
              contentVersion: {
                originalFilename: '申请执行.pdf',
                mimeType: 'application/pdf',
                createdAt: new Date('2026-10-11T01:00:00.000Z'),
              },
            },
          ],
        },
      ],
    });
    const submittedLawyerDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(submittedLawyerDetail).toMatchObject({
      canSubmitExecution: true,
      executionSubmission: {
        current: {
          id: 'submission-1',
          files: [
            {
              contentVersionId: 'execution-version-1',
              uploadedAt: '2026-10-11T01:00:00.000Z',
            },
          ],
        },
        submissions: [
          {
            id: 'submission-1',
            secondInstanceResultId: null,
            priorSubmissionId: null,
            changeReason: null,
          },
        ],
        availableFiles: [],
      },
    });
    expect(submittedLawyerDetail).not.toHaveProperty('owner');
    expect(submittedLawyerDetail).not.toHaveProperty('fees');
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    const oldChoiceProgress = {
      id: 'old-progress',
      trialRoundId: 'round-1',
      choiceId: 'choice-1',
      priorProgressId: null,
      hearingAt: null,
      hearingPlace: null,
      judgeName: null,
      fromVersion: 4,
      toVersion: 5,
      recordedAt: new Date('2026-10-09T03:00:00.000Z'),
      recordedByUserId: actor.userId,
      versions: [],
    };
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'SECOND_INSTANCE',
      currentJudgmentId: 'judgment-2',
      currentJudgmentNextStepId: 'choice-current',
      judgmentNextSteps: [
        ...choices,
        { ...choices[0], id: 'choice-current', trialRoundId: 'round-2' },
      ],
      judgmentNextStepRevocations: [],
      secondInstanceProgresses: [oldChoiceProgress],
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canRevokeJudgmentNextStep: true,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'SECOND_INSTANCE',
      currentJudgmentId: 'judgment-2',
      currentJudgmentNextStepId: 'choice-current',
      judgmentNextSteps: [
        ...choices,
        { ...choices[0], id: 'choice-current', trialRoundId: 'round-2' },
      ],
      judgmentNextStepRevocations: [],
      secondInstanceProgresses: [
        oldChoiceProgress,
        {
          ...oldChoiceProgress,
          id: 'current-progress',
          choiceId: 'choice-current',
        },
      ],
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canRevokeJudgmentNextStep: false,
    });
    const secondAcceptanceChanges = [
      {
        id: 'second-acceptance-1',
        choiceId: 'choice-current',
        trialRoundId: 'round-2',
        priorChangeId: null,
        fromRevision: 0,
        toRevision: 1,
        acceptedAt: new Date('2026-10-10T00:00:00.000Z'),
        courtCaseNo: null,
        reason: null,
        recordedAt: new Date('2026-10-11T01:00:00.000Z'),
        recordedByUserId: actor.userId,
      },
      {
        id: 'second-acceptance-2',
        choiceId: 'choice-current',
        trialRoundId: 'round-2',
        priorChangeId: 'second-acceptance-1',
        fromRevision: 1,
        toRevision: 2,
        acceptedAt: new Date('2026-10-10T00:00:00.000Z'),
        courtCaseNo: '二审案号',
        reason: '补录案号',
        recordedAt: new Date('2026-10-12T01:00:00.000Z'),
        recordedByUserId: actor.userId,
      },
    ];
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'SECOND_INSTANCE',
      currentJudgmentNextStepId: 'choice-current',
      judgmentNextSteps: [
        { ...choices[0], id: 'choice-current', trialRoundId: 'round-2' },
      ],
      judgmentNextStepRevocations: [],
      secondInstanceAcceptanceChanges: secondAcceptanceChanges,
    });
    const internalAcceptanceDetail = await f.service.get(actor, 'case-1');
    expect(internalAcceptanceDetail.secondInstance.acceptances).toEqual([
      {
        choiceId: 'choice-current',
        trialRoundId: 'round-2',
        acceptedAt: '2026-10-10',
        courtCaseNo: '二审案号',
        recordedAt: '2026-10-12T01:00:00.000Z',
      },
    ]);
    expect(internalAcceptanceDetail).toMatchObject({
      recordEdits: {
        secondInstanceAcceptances: [
          {
            acceptanceRevision: 2,
            canEdit: true,
            history: [{ reason: null }, { reason: '补录案号' }],
          },
        ],
      },
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyerAcceptanceDetail = await f.service.get(
      { ...actor, lawyerAccountId: actor.userId },
      'case-1',
    );
    expect(lawyerAcceptanceDetail.secondInstance.acceptances).toEqual(
      internalAcceptanceDetail.secondInstance.acceptances,
    );
    expect(lawyerAcceptanceDetail).not.toHaveProperty('recordEdits');
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.db.case.findFirst.mockResolvedValue(record);
    expect(result).toMatchObject({
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      canSubmitExecution: false,
      courtCaseNo: null,
      fees: [
        {
          category: 'NOTARY',
          state: 'KNOWN',
          amount: '100.00',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
          sourceId: 'certificate-1',
        },
        {
          category: 'SAMPLE',
          state: 'KNOWN',
          amount: '200.00',
          sourceType: 'NOTARY_MATTER_EVIDENCE',
          sourceId: 'matter-1',
        },
        {
          category: 'INVESTIGATION',
          state: 'PENDING',
          amount: null,
          sourceType: 'NOTARY_CERTIFICATE_FEE',
        },
        {
          category: 'DISCLOSURE',
          state: 'KNOWN',
          amount: '0.00',
          sourceType: 'NOTARY_CERTIFICATE_FEE',
        },
      ],
    });
    expect(f.db.case.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case-1', departmentId: actor.departmentId },
      }),
    );
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      matchedOn: new Date('2026-09-28T00:00:00.000Z'),
      lawyers: [
        {
          id: 'assignment-1',
          role: 'PRIMARY',
          startedAt: new Date('2026-09-29T09:00:00.000Z'),
          endedAt: null,
          lawyer: {
            id: 'lawyer-1',
            fullName: '张律师',
            lawFirm: null,
            phone: null,
          },
        },
      ],
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      matchedOn: '2026-09-28',
      matchedAt: '2026-09-29T09:00:00.000Z',
      lawyers: [{ fullName: '张律师', lawFirm: null }],
      canSubmitComplaint: true,
      complaint: null,
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      complaintAmountState: 'KNOWN',
      complaintAmount: '12.34',
      complaintPendingReason: null,
      complaintSubmittedAt: new Date('2026-09-30T09:00:00.000Z'),
      complaintSubmittedByUserId: actor.userId,
    });
    f.materials.listFrozenCaseComplaintFiles.mockResolvedValue([
      {
        purpose: 'COMPLAINT',
        materialId: 'material-1',
        contentVersionId: 'version-1',
        originalFilename: '诉状.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canSubmitComplaint: false,
      canConfirmComplaint: true,
      complaint: {
        amountState: 'KNOWN',
        amount: '12.34',
        complaintFiles: [{ contentVersionId: 'version-1' }],
        authorizationFiles: [],
      },
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_COMPLAINT_STAMP',
      matchedAt: new Date('2026-09-29T09:00:00.000Z'),
      complaintAmountState: 'KNOWN',
      complaintAmount: '12.34',
      complaintPendingReason: null,
      complaintSubmittedAt: new Date('2026-09-30T09:00:00.000Z'),
      complaintSubmittedByUserId: actor.userId,
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        confirmedByUserId: actor.userId,
        confirmedAt: new Date('2026-10-02T09:00:00.000Z'),
      },
      complaintMailing: null,
    });
    f.materials.listFrozenCaseComplaintConfirmationFile.mockResolvedValue({
      materialId: 'material-2',
      contentVersionId: 'version-2',
      originalFilename: '修订诉状.pdf',
      mimeType: 'application/pdf',
    });
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canConfirmComplaint: false,
      canMailComplaint: true,
      complaintMailing: null,
      complaint: {
        amount: '12.34',
        complaintFiles: [{ contentVersionId: 'version-1' }],
      },
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        complaintFile: { contentVersionId: 'version-2' },
      },
    });
    f.db.case.findFirst.mockResolvedValue({
      ...record,
      stage: 'WAITING_FILING',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'version-2',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待核实',
        changeNote: '金额待核实',
        confirmDisclose: true,
        confirmedByUserId: actor.userId,
        confirmedAt: new Date('2026-10-02T09:00:00.000Z'),
      },
      complaintMailing: {
        mailedAt: new Date('2026-10-02T00:00:00.000Z'),
        recordedAt: new Date('2026-10-03T03:00:00.000Z'),
        recordedByUserId: actor.userId,
        actorType: 'INTERNAL',
      },
    });
    f.materials.listFrozenCaseComplaintMailingFiles.mockResolvedValue([
      {
        materialId: 'receipt',
        contentVersionId: 'receipt-version',
        originalFilename: '凭证.pdf',
        mimeType: 'application/pdf',
      },
    ]);
    await expect(f.service.get(actor, 'case-1')).resolves.toMatchObject({
      canMailComplaint: false,
      complaintMailing: {
        mailedAt: '2026-10-02',
        receiptFiles: [{ contentVersionId: 'receipt-version' }],
      },
    });
  });
  it('scopes mine by case ownership and keeps stage counts independent of filter', async () => {
    const f = fixture();
    f.db.case.groupBy.mockResolvedValue([
      { stage: 'PENDING_MATCH', _count: { _all: 2 } },
    ]);
    const result = await (
      f.service.list as (...args: unknown[]) => Promise<unknown>
    )(actor, 1, 20, 'mine', 'WAITING_COMPLAINT');
    expect(result).toMatchObject({
      counts: {
        PENDING_MATCH: 2,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
      },
    });
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          stage: 'WAITING_COMPLAINT',
        },
      }),
    );
    expect(f.db.case.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        },
      }),
    );
  });
  it('filters before pagination and applies the same text scope to total and stage counts', async () => {
    const f = fixture();
    await f.service.list(actor, 2, 20, 'mine', 'WAITING_COMPLAINT', undefined, {
      q: 'CA-1',
      customerName: '客户',
      sortBy: 'rightsHolderName',
      sortDirection: 'asc',
    });
    const scope = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      AND: [
        {
          OR: [
            { businessNo: { contains: 'CA-1', mode: 'insensitive' } },
            { courtCaseNo: { contains: 'CA-1', mode: 'insensitive' } },
            {
              customer: {
                is: { name: { contains: 'CA-1', mode: 'insensitive' } },
              },
            },
            {
              rightsHolder: {
                is: { name: { contains: 'CA-1', mode: 'insensitive' } },
              },
            },
            {
              defendants: {
                some: { name: { contains: 'CA-1', mode: 'insensitive' } },
              },
            },
          ],
        },
        {
          customer: { is: { name: { contains: '客户', mode: 'insensitive' } } },
        },
      ],
    };
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...scope, stage: 'WAITING_COMPLAINT' },
        orderBy: [{ rightsHolder: { name: 'asc' } }, { id: 'asc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(f.db.case.count).toHaveBeenCalledWith({
      where: { ...scope, stage: 'WAITING_COMPLAINT' },
    });
    expect(f.db.case.groupBy).toHaveBeenCalledWith({
      by: ['stage'],
      where: scope,
      _count: { _all: true },
    });
  });
  it('keeps the lawyer original read while rejecting the new internal query inputs', async () => {
    const f = fixture();
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    const lawyer = { ...actor, lawyerAccountId: actor.userId };
    await f.service.list(lawyer, 1, 20);
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          lawyers: expect.any(Object),
        }),
      }),
    );
    f.db.case.findMany.mockClear();
    await expect(
      f.service.list(lawyer, 1, 20, 'department', undefined, undefined, {
        q: 'case',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.case.findMany).not.toHaveBeenCalled();
  });
  it('returns public list fields without internal ownership relation data', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: 'case-1',
        businessNo: 'CA-1',
        stage: 'PENDING_MATCH',
        version: 1,
        currentSecondInstanceResultId: null,
        createdAt: new Date('2026-09-28T00:00:00.000Z'),
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: 'team-private' },
        owner: { id: actor.userId, displayName: '负责人' },
        ...displaySource('lead-1', 'matter-1'),
      },
    ]);
    const result = await f.service.list(actor, 1, 20);
    expect(result.items[0]).not.toHaveProperty('responsibleMembership');
    expect(result.items[0]).not.toHaveProperty('responsibleUserId');
    expect(result.items[0]).toMatchObject({
      owner: { id: actor.userId },
      canMatch: true,
    });
  });

  it('projects the independent execution confirmation capability in internal lists', async () => {
    const f = fixture();
    f.db.case.findMany.mockResolvedValue([
      {
        id: 'case-1',
        businessNo: 'CA-1',
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        version: 7,
        currentTrialRoundId: null,
        currentJudgmentNextStepId: null,
        currentJudgmentNextStep: null,
        currentExecutionSubmissionId: 'submission-1',
        executionConfirmation: null,
        currentSecondInstanceResultId: null,
        createdAt: new Date('2026-10-11T00:00:00.000Z'),
        responsibleUserId: actor.userId,
        responsibleMembership: { teamId: null },
        owner: { id: actor.userId, displayName: 'operator' },
        ...displaySource('lead-1', 'matter-1'),
      },
    ]);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canConfirmExecution: true,
    });
    expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.confirm',
      expect.any(Object),
    );
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canConfirmExecution: false,
    });
  });

  it('projects execution mailing and filing capabilities only from their anchored stages', async () => {
    const f = fixture();
    const shared = {
      businessNo: 'CA-1',
      version: 8,
      currentTrialRoundId: null,
      currentJudgmentNextStepId: null,
      currentJudgmentNextStep: null,
      currentExecutionSubmissionId: null,
      currentSecondInstanceResultId: null,
      currentSecondInstanceResult: null,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      createdAt: new Date('2026-10-11T00:00:00.000Z'),
      owner: { id: actor.userId, displayName: 'operator' },
      ...displaySource('lead-1', 'matter-1'),
    };
    f.db.case.findMany.mockResolvedValue([
      {
        ...shared,
        id: 'case-mail',
        stage: 'WAITING_EXECUTION_STAMP',
        executionConfirmation: { id: 'confirmation-1' },
        executionMailing: null,
        executionFiling: null,
      },
      {
        ...shared,
        id: 'case-filing',
        stage: 'WAITING_EXECUTION_FILING',
        executionConfirmation: { id: 'confirmation-2' },
        executionMailing: { id: 'mailing-2' },
        executionFiling: null,
      },
    ]);

    const result = await f.service.list(actor, 1, 20);
    expect(result.items).toMatchObject([
      {
        id: 'case-mail',
        canMailExecution: true,
        canSubmitExecutionFiling: false,
      },
      {
        id: 'case-filing',
        canMailExecution: false,
        canSubmitExecutionFiling: true,
      },
    ]);
    expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.mail',
      expect.objectContaining({ departmentId: actor.departmentId }),
    );
    expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.filing.submit',
      expect.objectContaining({ departmentId: actor.departmentId }),
    );
  });
  it('projects finish capability only for the exact filing version and live action', async () => {
    const f = fixture();
    const row = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'EXECUTING',
      version: 24,
      currentTrialRoundId: null,
      currentJudgmentNextStepId: null,
      currentJudgmentNextStep: null,
      currentExecutionSubmissionId: 'submission',
      currentSecondInstanceResultId: null,
      currentSecondInstanceResult: null,
      executionConfirmation: { id: 'confirmation' },
      executionMailing: { id: 'mailing' },
      executionFiling: { id: 'filing', toVersion: 24 },
      executionFinish: null,
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      createdAt: new Date(),
      owner: { id: actor.userId, displayName: 'operator' },
      ...displaySource('lead', 'matter'),
    };
    f.db.case.findMany.mockResolvedValue([row]);
    expect(
      (await f.service.list(actor, 1, 20)).items[0].canFinishExecution,
    ).toBe(true);
    expect(f.access.canAuthorizeCase).toHaveBeenCalledWith(
      actor,
      'case.execution.finish',
      expect.any(Object),
    );
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect(
      (await f.service.list(actor, 1, 20)).items[0].canFinishExecution,
    ).toBe(false);
    f.access.canAuthorizeCase.mockResolvedValue(true);
    row.executionFiling.toVersion = 23;
    expect(
      (await f.service.list(actor, 1, 20)).items[0].canFinishExecution,
    ).toBe(false);
  });

  it('lists second-instance actions by current choice, stage and actual authorization', async () => {
    const f = fixture();
    const listCase = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'SECOND_INSTANCE',
      version: 20,
      currentTrialRoundId: 'round-2',
      currentJudgmentId: 'judgment-2',
      currentJudgmentNextStepId: 'choice-current',
      currentJudgmentNextStep: {
        next: 'APPEAL',
        judgmentId: 'judgment-2',
        trialRoundId: 'round-2',
      },
      currentSecondInstanceResultId: null,
      currentSecondInstanceResult: null,
      secondInstanceProgresses: [{ choiceId: 'choice-old' }],
      secondInstanceResults: [{ choiceId: 'choice-old' }],
      createdAt: new Date('2026-10-10T00:00:00.000Z'),
      responsibleUserId: actor.userId,
      responsibleMembership: { teamId: null },
      owner: { id: actor.userId, displayName: '负责人' },
      ...displaySource('lead-1', 'matter-1'),
    };
    f.db.case.findMany.mockResolvedValue([listCase]);
    const operator = (await f.service.list(actor, 1, 20)).items[0];
    expect(operator).toMatchObject({
      canSaveSecondInstance: true,
      canRegisterSecondInstanceResult: true,
      canRevokeSecondInstanceResult: false,
      canRevokeJudgmentNextStep: true,
    });
    f.db.case.findMany.mockResolvedValue([
      {
        ...listCase,
        secondInstanceProgresses: [
          { choiceId: 'choice-old' },
          { choiceId: 'choice-current' },
        ],
      },
    ]);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canSaveSecondInstance: true,
      canRevokeJudgmentNextStep: false,
    });
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      canRevokeJudgmentNextStep: false,
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'LAWYER',
      active: true,
    });
    expect(
      (await f.service.list({ ...actor, lawyerAccountId: actor.userId }, 1, 20))
        .items[0],
    ).toMatchObject({
      canSaveSecondInstance: true,
      canRegisterSecondInstanceResult: true,
      canRevokeSecondInstanceResult: false,
      canRevokeJudgmentNextStep: false,
    });
    f.db.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.access.canAuthorizeCase.mockResolvedValue(true);
    f.db.case.findMany.mockResolvedValue([
      {
        ...listCase,
        stage: 'WAITING_EXECUTION_DOCUMENTS',
        currentSecondInstanceResultId: 'result-current',
        currentSecondInstanceResult: {
          id: 'result-current',
          result: 'CHANGE',
          revocation: null,
          childRound: null,
        },
      },
    ]);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: true,
      canRevokeJudgmentNextStep: false,
    });
    f.access.canAuthorizeCase.mockResolvedValue(false);
    expect((await f.service.list(actor, 1, 20)).items[0]).toMatchObject({
      canRevokeSecondInstanceResult: false,
    });
  });

  it('filters the execution preparation group across all three atomic stages', async () => {
    const f = fixture();
    f.db.case.groupBy.mockResolvedValue([
      { stage: 'WAITING_EXECUTION_DOCUMENTS', _count: { _all: 2 } },
      { stage: 'WAITING_EXECUTION_CONFIRMATION', _count: { _all: 3 } },
    ]);
    const result = await f.service.list(
      actor,
      1,
      20,
      'department',
      undefined,
      'EXECUTION_PREPARATION',
    );
    expect(f.db.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: {
            in: [
              'WAITING_EXECUTION_DOCUMENTS',
              'WAITING_EXECUTION_CONFIRMATION',
              'WAITING_EXECUTION_STAMP',
            ],
          },
        }),
      }),
    );
    expect(result.counts).toMatchObject({
      WAITING_EXECUTION_DOCUMENTS: 2,
      WAITING_EXECUTION_CONFIRMATION: 3,
    });
    expect(result.counts).not.toHaveProperty('EXECUTION_PREPARATION');
    await expect(
      f.service.list(
        actor,
        1,
        20,
        'department',
        'WAITING_EXECUTION_DOCUMENTS',
        'EXECUTION_PREPARATION',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  describe.each([
    [
      'COMPLAINT_PREPARATION',
      [
        'WAITING_COMPLAINT',
        'WAITING_COMPLAINT_CONFIRMATION',
        'WAITING_COMPLAINT_STAMP',
      ],
    ],
    [
      'EXECUTION_PREPARATION',
      [
        'WAITING_EXECUTION_DOCUMENTS',
        'WAITING_EXECUTION_CONFIRMATION',
        'WAITING_EXECUTION_STAMP',
      ],
    ],
  ] as const)('%s read group', (group, stages) => {
    it.each(['mine', 'department', 'lawyer'] as const)(
      'intersects exact stages with %s list, total and full-scope counts',
      async (scope) => {
        const f = fixture();
        const currentActor =
          scope === 'lawyer'
            ? { ...actor, lawyerAccountId: actor.userId }
            : actor;
        if (scope === 'lawyer')
          f.db.userAccount.findUnique.mockResolvedValue({
            accountType: 'LAWYER',
            active: true,
          });
        f.db.case.findMany.mockResolvedValue(
          stages.map((stage, index) => ({
            id: 'case-' + index,
            businessNo: 'CA-' + index,
            stage,
            version: 1,
            createdAt: new Date('2026-10-13T00:00:00Z'),
            currentTrialRoundId: null,
            currentJudgmentNextStepId: null,
            currentJudgmentNextStep: null,
            currentExecutionSubmissionId: null,
            executionConfirmation: null,
            executionMailing: null,
            executionFiling: null,
            executionFinish: null,
            currentSecondInstanceResultId: null,
            responsibleUserId: actor.userId,
            responsibleMembership: { teamId: null },
            owner: { id: actor.userId, displayName: 'owner' },
            ...displaySource('lead', 'matter'),
          })),
        );
        f.db.case.count.mockResolvedValue(27);
        f.db.case.groupBy.mockResolvedValue([
          ...stages.map((stage, index) => ({
            stage,
            _count: { _all: index + 8 },
          })),
          { stage: 'PENDING_MATCH', _count: { _all: 77 } },
          { stage: 'WAITING_FILING', _count: { _all: 66 } },
          { stage: 'SECOND_INSTANCE', _count: { _all: 55 } },
          { stage: 'WAITING_EXECUTION_FILING', _count: { _all: 44 } },
        ]);
        const view = scope === 'mine' ? 'mine' : 'department';
        const result = await f.service.list(
          currentActor,
          2,
          3,
          view,
          undefined,
          group,
        );
        const baseWhere = {
          departmentId: actor.departmentId,
          ...(scope === 'mine'
            ? { responsibleUserId: actor.userId }
            : scope === 'lawyer'
              ? {
                  lawyers: {
                    some: {
                      role: 'PRIMARY',
                      endedAt: null,
                      lawyer: {
                        accountBinding: {
                          is: {
                            userId: actor.userId,
                            departmentId: actor.departmentId,
                            active: true,
                            user: { active: true, accountType: 'LAWYER' },
                          },
                        },
                      },
                    },
                  },
                }
              : {}),
        };
        const where = { ...baseWhere, stage: { in: [...stages] } };
        expect(f.db.case.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where,
            skip: 3,
            take: 3,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          }),
        );
        expect(f.db.case.count).toHaveBeenCalledWith({ where });
        expect(f.db.case.groupBy).toHaveBeenCalledWith({
          by: ['stage'],
          where: baseWhere,
          _count: { _all: true },
        });
        expect(result.items.map((item) => item.stage)).toEqual([...stages]);
        expect(result.total).toBe(27);
        expect(stages.map((stage) => result.counts[stage])).toEqual([8, 9, 10]);
        expect(result.counts.WAITING_FILING).toBe(66);
        expect(result.counts).not.toHaveProperty(group);
        for (const stage of stages) {
          await f.service.list(currentActor, 1, 20, view, stage);
          expect(f.db.case.count).toHaveBeenLastCalledWith({
            where: { ...baseWhere, stage },
          });
        }
        await expect(
          f.service.list(currentActor, 1, 20, view, stages[0], group),
        ).rejects.toMatchObject({ status: 400 });
        f.db.userAccount.findUnique.mockResolvedValue({
          accountType: scope === 'lawyer' ? 'LAWYER' : 'INTERNAL',
          active: false,
        });
        f.db.case.findMany.mockClear();
        f.db.case.count.mockClear();
        f.db.case.groupBy.mockClear();
        await expect(
          f.service.list(currentActor, 1, 20, view, undefined, group),
        ).rejects.toMatchObject({ status: 403 });
        expect(f.db.case.findMany).not.toHaveBeenCalled();
        expect(f.db.case.count).not.toHaveBeenCalled();
        expect(f.db.case.groupBy).not.toHaveBeenCalled();
      },
    );
    it('rechecks a revoked department grant or lawyer binding before group reads', async () => {
      const f = fixture();
      const { ForbiddenException } = await import('@nestjs/common');
      f.access.authorizeDepartmentAction.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        f.service.list(actor, 1, 20, 'department', undefined, group),
      ).rejects.toMatchObject({ status: 403 });
      f.db.userAccount.findUnique.mockResolvedValue({
        accountType: 'LAWYER',
        active: true,
      });
      f.db.lawyerAccountBinding.findFirst.mockResolvedValue(null);
      await expect(
        f.service.list(
          { ...actor, lawyerAccountId: actor.userId },
          1,
          20,
          'department',
          undefined,
          group,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.db.case.findMany).not.toHaveBeenCalled();
      expect(f.db.case.count).not.toHaveBeenCalled();
      expect(f.db.case.groupBy).not.toHaveBeenCalled();
    });
  });
});
