import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  grantV6SyntheticRole,
  seedV6ExternalCase,
  seedV6InternalCustomer,
  v6Access,
  v6Actor,
  v6BackendClass,
  v6Materials,
  v6ScopedPrisma,
  withV6FollowupSchema,
} from './v6-followup-fixture.mjs';

const cutover = readFileSync(
  resolve(
    process.cwd(),
    'docs/superpowers/plans/2026-10-26-v6-numbering-cutover.draft.sql',
  ),
  'utf8',
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    const response = error?.getResponse?.() ?? error?.response;
    if (response?.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function syntheticProof(client, owner, caseId) {
  const materialId = randomUUID();
  await client.query(
    `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,updated_at)
     VALUES($1,$2,'CASE',$3,'FEE_PROOF','FEE_PROOF',now())`,
    [materialId, owner.departmentId, caseId],
  );
  const versionId = await appendProofVersion(client, owner, materialId);
  return { materialId, versionId };
}

async function appendProofVersion(client, owner, materialId) {
  const versionId = randomUUID();
  await client.query(
    `INSERT INTO content_versions(id,material_id,storage_key,original_filename,
       mime_type,size_bytes,sha256,uploaded_by)
     VALUES($1,$2,$3,'synthetic-proof.png','image/png',8,repeat('c',64),$4)`,
    [versionId, materialId, `v6-synthetic/${versionId}.png`, owner.actorUserId],
  );
  await client.query('UPDATE materials SET current_version_id=$2 WHERE id=$1', [
    materialId,
    versionId,
  ]);
  return versionId;
}

async function expectFrozenProofHeadRejected(client, owner, proof) {
  let rejected;
  await client.query('BEGIN');
  try {
    await appendProofVersion(client, owner, proof.materialId);
  } catch (error) {
    rejected = error;
  } finally {
    await client.query('ROLLBACK');
  }
  assert(
    rejected?.code === '23514' &&
      rejected.message.includes('frozen fee proof must be retained'),
    'Frozen fee proof head update was not rejected by the installed guard',
  );
  const retained = (
    await client.query(
      `SELECT m.current_version_id,
        (SELECT count(*)::int FROM content_versions WHERE material_id=m.id) AS versions
       FROM materials m WHERE m.id=$1`,
      [proof.materialId],
    )
  ).rows[0];
  assert(
    retained.current_version_id === proof.versionId && retained.versions === 1,
    'Rejected fee proof head update changed the original material',
  );
}

async function expectOrphanProofReferenceRejected(
  client,
  owner,
  feeId,
  cancellationId,
  paymentId,
  proof,
  resourceType,
) {
  const isPayment = resourceType === 'fee-payment-verification';
  const factId = randomUUID();
  const auditId = randomUUID();
  const referenceId = randomUUID();
  const details = {
    ...(isPayment ? { paymentId: factId } : { refundId: factId, paymentId }),
    cancellationId,
    amount: '1.00',
    ...(isPayment ? { paymentDate: today() } : { refundDate: today() }),
    proofMaterialId: proof.materialId,
    proofContentVersionId: proof.versionId,
    requestFingerprint: 'd'.repeat(64),
  };
  let commitError;
  let committed = false;
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO audit_events(id,department_id,actor_user_id,
        internal_actor_user_id,resource_type,resource_id,action,details)
       VALUES($1,$2,$3,$3,'FEE',$4,$5,$6::jsonb)`,
      [
        auditId,
        owner.departmentId,
        owner.actorUserId,
        feeId,
        isPayment ? 'fee.payment-verified' : 'fee.refund-reconciled',
        JSON.stringify(details),
      ],
    );
    const inserted = await client.query(
      `INSERT INTO material_references(id,department_id,resource_type,
        resource_id,purpose,material_id,content_version_id,action_event_id)
       VALUES($1,$2,$3,$4,'FEE_PROOF',$5,$6,$7) RETURNING id`,
      [
        referenceId,
        owner.departmentId,
        resourceType,
        factId,
        proof.materialId,
        proof.versionId,
        auditId,
      ],
    );
    assert(
      inserted.rows[0]?.id === referenceId,
      'Orphan proof reference failed before deferred final check',
    );
    try {
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      commitError = error;
    }
  } finally {
    if (!committed) await client.query('ROLLBACK');
  }
  assert(
    commitError?.code === '23514' &&
      commitError.message.includes(
        'fee reconciliation proof lacks exact same-transaction fact',
      ),
    `${resourceType} orphan proof reference did not fail at COMMIT with the deferred 23514 guard`,
  );
  const residual = (
    await client.query(
      `SELECT
        (SELECT count(*)::int FROM audit_events WHERE id=$1) AS audits,
        (SELECT count(*)::int FROM material_references WHERE id=$2) AS refs,
        (SELECT count(*)::int FROM fee_cancellation_payments WHERE id=$3) AS payments,
        (SELECT count(*)::int FROM fee_refund_reconciliations WHERE id=$3) AS refunds`,
      [auditId, referenceId, factId],
    )
  ).rows[0];
  assert(
    residual.audits === 0 &&
      residual.refs === 0 &&
      residual.payments === 0 &&
      residual.refunds === 0,
    `${resourceType} failed COMMIT left an audit, proof reference or fact`,
  );
}

export async function verifyV6FeeCancellation() {
  return withV6FollowupSchema(async ({ client, schema }) => {
    const owner = await seedV6InternalCustomer(client);
    const outsider = await seedV6InternalCustomer(client);
    const source = await seedV6ExternalCase(client, owner);
    const otherCase = await seedV6ExternalCase(client, owner, {
      createdAt: '2026-10-25T02:00:00Z',
    });
    const outsiderCase = await seedV6ExternalCase(client, outsider);
    await client.query(cutover);
    const exactProof = await syntheticProof(client, owner, source.caseId);
    const wrongCaseProof = await syntheticProof(
      client,
      owner,
      otherCase.caseId,
    );
    const wrongDepartmentProof = await syntheticProof(
      client,
      outsider,
      outsiderCase.caseId,
    );
    const wrongVersionPair = await syntheticProof(client, owner, source.caseId);
    const roleId = await grantV6SyntheticRole(client, owner, [
      ['case.archive', 'SELF'],
      ['fee.create', 'DEPARTMENT'],
      ['fee.read', 'DEPARTMENT'],
      ['fee.delete', 'DEPARTMENT'],
      ['fee.update', 'DEPARTMENT'],
    ]);
    await grantV6SyntheticRole(client, outsider, [
      ['fee.update', 'DEPARTMENT'],
    ]);
    const database = v6ScopedPrisma(schema);
    try {
      const access = v6Access(database);
      const materials = v6Materials(database, access);
      const OrganizationService = v6BackendClass(
        'access-control/organization.service.js',
        'OrganizationService',
      );
      const FeeService = v6BackendClass(
        'modules/settlements/fee.service.js',
        'FeeService',
      );
      const CaseEarlyArchiveService = v6BackendClass(
        'modules/cases/case-early-archive.service.js',
        'CaseEarlyArchiveService',
      );
      const actor = v6Actor(owner);
      const service = new FeeService(
        database,
        access,
        new OrganizationService(database),
        materials,
      );
      const archive = new CaseEarlyArchiveService(database, access);
      await archive.archive(actor, source.caseId, {
        expectedVersion: 1,
        idempotencyKey: 'v6-fee-case-archive',
        archiveAt: today(),
        reason: '合成提前归档后仍有费用',
      });
      const makeFee = (status, suffix) =>
        service.create(actor, {
          caseId: source.caseId,
          type: '诉讼费',
          direction: '支出',
          amount: '10.00',
          status,
          feeDate: '2026-10-25',
          idempotencyKey: `v6-fee-${suffix}`,
        });
      const paid = await makeFee('已支付', 'paid');
      const issued = await makeFee('发起', 'issued');
      const unopened = await makeFee('未发起', 'unopened');
      const cancel = (fee, suffix) =>
        service.cancel(actor, fee.id, {
          expectedVersion: fee.version,
          idempotencyKey: `v6-cancel-${suffix}`,
          reason: '合成费用应作废',
        });
      const paidCancel = await cancel(paid, 'paid');
      const issuedCancel = await cancel(issued, 'issued');
      const unopenedCancel = await cancel(unopened, 'unopened');
      assert(
        paidCancel.outcome === 'VOIDED' &&
          paidCancel.refundReconciliationStatus === 'PENDING' &&
          issuedCancel.outcome === 'VOIDED' &&
          issuedCancel.refundReconciliationStatus === 'PAYMENT_UNVERIFIED' &&
          unopenedCancel.outcome === 'DELETED',
        'Cancellation conflated paid, issued and unopened fee states',
      );
      assert(
        JSON.stringify(await cancel(paid, 'paid')) ===
          JSON.stringify(paidCancel),
        'Paid cancellation replay changed result',
      );
      const beforeVerification = (
        await client.query(`SELECT
        (SELECT count(*)::int FROM fee_cancellation_payments) AS payments,
        (SELECT count(*)::int FROM fee_refund_reconciliations) AS refunds`)
      ).rows[0];
      assert(
        beforeVerification.payments === 0 && beforeVerification.refunds === 0,
        'Cancellation invented payment or refund facts',
      );
      await expectCode(
        () =>
          service.reconcileCancelledRefund(actor, paid.id, {
            amount: '1.00',
            refundDate: today(),
            proofMaterialId: null,
            proofContentVersionId: null,
            idempotencyKey: 'v6-refund-before-payment',
          }),
        'PAYMENT_NOT_VERIFIED',
      );

      const verifyInput = {
        amount: '6.00',
        paymentDate: '2026-10-25',
        proofMaterialId: exactProof.materialId,
        proofContentVersionId: exactProof.versionId,
        idempotencyKey: 'v6-verify-paid',
      };
      await expectCode(
        () =>
          service.verifyCancelledPayment(actor, paid.id, {
            ...verifyInput,
            proofContentVersionId: wrongVersionPair.versionId,
            idempotencyKey: 'v6-verify-mismatched-pair',
          }),
        'INVALID_FEE_PROOF',
      );
      for (const [proof, key] of [
        [wrongCaseProof, 'v6-verify-wrong-case'],
        [wrongDepartmentProof, 'v6-verify-wrong-dept'],
      ]) {
        await expectCode(
          () =>
            service.verifyCancelledPayment(actor, paid.id, {
              ...verifyInput,
              proofMaterialId: proof.materialId,
              proofContentVersionId: proof.versionId,
              idempotencyKey: key,
            }),
          'MATERIAL_VERSION_INVALID',
        );
      }
      const payment = await service.verifyCancelledPayment(
        actor,
        paid.id,
        verifyInput,
      );
      assert(
        payment.amount === '6.00' && payment.paymentDate === '2026-10-25',
        'Verified actual payment was replaced by nominal fee amount',
      );
      for (const resourceType of [
        'fee-payment-verification',
        'fee-refund-reconciliation',
      ])
        await expectOrphanProofReferenceRejected(
          client,
          owner,
          paid.id,
          paidCancel.cancellationId,
          payment.id,
          exactProof,
          resourceType,
        );
      await expectFrozenProofHeadRejected(client, owner, exactProof);
      const refundProof = await syntheticProof(client, owner, source.caseId);
      const refundVersionId = refundProof.versionId;
      const frozenPayment = (
        await client.query(
          `SELECT
        (SELECT proof_content_version_id FROM fee_cancellation_payments WHERE id=$1) AS proof,
        (SELECT count(*)::int FROM material_references WHERE resource_type='fee-payment-verification'
          AND resource_id=$1 AND content_version_id=$2) AS refs,
        (SELECT current_version_id FROM materials WHERE id=$3) AS current`,
          [payment.id, exactProof.versionId, exactProof.materialId],
        )
      ).rows[0];
      assert(
        frozenPayment.proof === exactProof.versionId &&
          frozenPayment.refs === 1 &&
          frozenPayment.current === exactProof.versionId,
        'Frozen exact payment proof changed after rejected head update',
      );
      assert(
        JSON.stringify(
          await service.verifyCancelledPayment(actor, paid.id, verifyInput),
        ) === JSON.stringify(payment),
        'Payment replay changed fact',
      );
      await expectCode(
        () =>
          service.verifyCancelledPayment(actor, paid.id, {
            ...verifyInput,
            idempotencyKey: 'v6-verify-again',
          }),
        'PAYMENT_ALREADY_VERIFIED',
      );
      const unpaid = await service.verifyCancelledPayment(actor, issued.id, {
        amount: '0.00',
        paymentDate: null,
        proofMaterialId: null,
        proofContentVersionId: null,
        idempotencyKey: 'v6-verify-unpaid',
      });
      assert(
        unpaid.amount === '0.00' && unpaid.paymentDate === null,
        'Explicit unpaid zero was confused with unknown payment',
      );
      await expectCode(
        () =>
          service.reconcileCancelledRefund(actor, issued.id, {
            amount: '1.00',
            refundDate: today(),
            proofMaterialId: null,
            proofContentVersionId: null,
            idempotencyKey: 'v6-refund-unpaid',
          }),
        'REFUND_EXCEEDS_PAYMENT',
      );

      const refundInput = (amount, key) => ({
        amount,
        refundDate: today(),
        proofMaterialId:
          key === 'v6-refund-first' ? refundProof.materialId : null,
        proofContentVersionId:
          key === 'v6-refund-first' ? refundVersionId : null,
        idempotencyKey: key,
      });
      await client.query(`CREATE FUNCTION v6_fail_refund() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic refund failure'
        USING ERRCODE='23514'; END $$`);
      await client.query(`CREATE TRIGGER v6_fail_refund BEFORE INSERT ON
        fee_refund_reconciliations FOR EACH ROW EXECUTE FUNCTION v6_fail_refund()`);
      let injectedFailure;
      try {
        await service.reconcileCancelledRefund(
          actor,
          paid.id,
          refundInput('2.00', 'v6-refund-first'),
        );
      } catch (error) {
        injectedFailure = error;
      }
      assert(injectedFailure, 'Late refund insertion unexpectedly committed');
      const failedRefund = (
        await client.query(
          `SELECT
        (SELECT count(*)::int FROM fee_refund_reconciliations) AS refunds,
        (SELECT count(*)::int FROM audit_events
          WHERE resource_id=$1 AND action='fee.refund-reconciled') AS audits`,
          [paid.id],
        )
      ).rows[0];
      assert(
        failedRefund.refunds === 0 && failedRefund.audits === 0,
        'Late refund failure left partial audit or refund fact',
      );
      await client.query(
        'DROP TRIGGER v6_fail_refund ON fee_refund_reconciliations',
      );
      await client.query('DROP FUNCTION v6_fail_refund()');
      const first = await service.reconcileCancelledRefund(
        actor,
        paid.id,
        refundInput('2.00', 'v6-refund-first'),
      );
      const second = await service.reconcileCancelledRefund(
        actor,
        paid.id,
        refundInput('3.00', 'v6-refund-second'),
      );
      assert(
        first.amount === '2.00' &&
          second.amount === '3.00' &&
          first.id !== second.id,
        'Partial refunds did not retain separate facts',
      );
      const frozenRefund = (
        await client.query(
          `SELECT
        (SELECT proof_material_id FROM fee_refund_reconciliations WHERE id=$1) AS material,
        (SELECT proof_content_version_id FROM fee_refund_reconciliations WHERE id=$1) AS proof,
        (SELECT count(*)::int FROM material_references ref
          JOIN fee_refund_reconciliations fact ON fact.id=ref.resource_id
            AND fact.action_event_id=ref.action_event_id
            AND fact.proof_material_id=ref.material_id
            AND fact.proof_content_version_id=ref.content_version_id
          JOIN audit_events audit ON audit.id=ref.action_event_id
            AND audit.action='fee.refund-reconciled'
            AND audit.details->>'refundId'=fact.id::text
            AND audit.details->>'proofMaterialId'=ref.material_id::text
            AND audit.details->>'proofContentVersionId'=ref.content_version_id::text
          WHERE ref.resource_type='fee-refund-reconciliation'
            AND ref.resource_id=$1 AND ref.material_id=$2
            AND ref.content_version_id=$3) AS refs,
        (SELECT count(*)::int FROM material_references ref
          JOIN fee_cancellation_payments fact ON fact.id=ref.resource_id
            AND fact.action_event_id=ref.action_event_id
            AND fact.proof_material_id=ref.material_id
            AND fact.proof_content_version_id=ref.content_version_id
          JOIN audit_events audit ON audit.id=ref.action_event_id
            AND audit.action='fee.payment-verified'
            AND audit.details->>'paymentId'=fact.id::text
            AND audit.details->>'proofMaterialId'=ref.material_id::text
            AND audit.details->>'proofContentVersionId'=ref.content_version_id::text
          WHERE ref.resource_type='fee-payment-verification'
            AND ref.resource_id=$4 AND ref.material_id=$5
            AND ref.content_version_id=$6) AS payment_refs`,
          [
            first.id,
            refundProof.materialId,
            refundVersionId,
            payment.id,
            exactProof.materialId,
            exactProof.versionId,
          ],
        )
      ).rows[0];
      assert(
        frozenRefund.material === refundProof.materialId &&
          frozenRefund.proof === refundVersionId &&
          frozenRefund.refs === 1 &&
          frozenRefund.payment_refs === 1,
        'Independent refund proof was not frozen or prior payment reference changed',
      );
      assert(
        JSON.stringify(
          await service.reconcileCancelledRefund(
            actor,
            paid.id,
            refundInput('2.00', 'v6-refund-first'),
          ),
        ) === JSON.stringify(first),
        'Refund replay changed immutable fact',
      );
      await expectCode(
        () =>
          service.reconcileCancelledRefund(
            actor,
            paid.id,
            refundInput('2.00', 'v6-refund-over-limit'),
          ),
        'REFUND_EXCEEDS_PAYMENT',
      );
      const raced = await Promise.allSettled([
        service.reconcileCancelledRefund(
          actor,
          paid.id,
          refundInput('1.00', 'v6-refund-race-a'),
        ),
        service.reconcileCancelledRefund(
          actor,
          paid.id,
          refundInput('1.00', 'v6-refund-race-b'),
        ),
      ]);
      assert(
        raced.filter((item) => item.status === 'fulfilled').length === 1 &&
          raced.filter((item) => item.status === 'rejected').length === 1,
        'Concurrent refunds exceeded the verified payment cap',
      );
      const ledger = (
        await client.query(
          `SELECT
        (SELECT coalesce(sum(amount),0)::text FROM fee_refund_reconciliations
          WHERE fee_id=$1) AS refunded,
        (SELECT amount::text FROM fee_cancellation_payments WHERE fee_id=$1) AS paid,
        (SELECT amount::text FROM fee_records WHERE id=$1) AS nominal,
        (SELECT count(*)::int FROM fee_refund_reconciliations WHERE fee_id=$1) AS parts`,
          [paid.id],
        )
      ).rows[0];
      assert(
        ledger.refunded === '6.00' &&
          ledger.paid === '6.00' &&
          ledger.nominal === '10.00' &&
          ledger.parts === 3,
        'Refund ledger lost partial facts or used nominal amount as cash',
      );
      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1 AND action='fee.update'`,
        [roleId],
      );
      await expectCode(
        () =>
          service.reconcileCancelledRefund(
            actor,
            paid.id,
            refundInput('0.01', 'v6-refund-no-grant'),
          ),
        'CUSTOMER_ACTION_FORBIDDEN',
      );
      await expectCode(
        () =>
          service.reconcileCancelledRefund(
            v6Actor(outsider),
            paid.id,
            refundInput('0.01', 'v6-refund-cross-dept'),
          ),
        'FEE_NOT_FOUND',
      );
      return {
        checks: [
          'archived case retains finance; paid and issued fees void, unopened fee deletes',
          'voiding preserves unknown payment until actual amount is verified',
          'explicit zero differs from unknown and nominal amount never caps refund',
          'late refund failure rolls back audit and fact, then same key retries',
          'same-case proof binds exact active version; cross-case and cross-department proofs reject',
          'frozen payment proof rejects head update; independent refund proof freezes its exact version',
          'orphan payment and refund proof references insert but fail at deferred COMMIT with no residual audit or reference',
          'partial, repeated and concurrent refunds stay within verified payment',
          'low grant and cross-department actor cannot reconcile a refund',
        ],
      };
    } finally {
      await database.$disconnect();
    }
  });
}
