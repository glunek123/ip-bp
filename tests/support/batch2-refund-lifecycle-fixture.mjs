import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertBatch2Admission } from './batch2-proxy-calendar-acceptance.mjs';

const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { Client } = backend('pg');

async function withOwnedDatabase(callback) {
  const { databaseUrl } = assertBatch2Admission();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS db,current_schema() AS schema',
      )
    ).rows[0];
    if (identity.db !== 'dev_cor_test' || identity.schema !== 'public')
      throw new Error('Unexpected refund lifecycle database namespace');
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function grantBatch2RefundLifecycleActions(fixture) {
  return withOwnedDatabase(async (client) => {
    const role = (
      await client.query(
        `SELECT ra.role_template_id FROM role_assignments ra
       JOIN role_templates rt ON rt.id=ra.role_template_id AND rt.department_id=ra.department_id
       WHERE ra.user_id=$1 AND ra.department_id=$2 AND rt.name=$3 AND ra.active AND rt.active`,
        [
          fixture.operator.id,
          fixture.departmentId,
          `batch2-operator-${fixture.suffix}`,
        ],
      )
    ).rows;
    if (role.length !== 1) throw new Error('Owned operator role absent');
    const actions = [
      'case.second_instance.save',
      'case.second_instance.result',
      'case.second_instance.result.revoke',
      'case.acceptance.register',
      'case.hearing.schedule',
      'case.archive',
    ];
    await client.query('BEGIN');
    try {
      for (const action of actions)
        await client.query(
          "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES($1,$2,$3,'DEPARTMENT')",
          [randomUUID(), role[0].role_template_id, action],
        );
      const courtId = randomUUID();
      await client.query(
        'INSERT INTO filing_courts(id,department_id,name) VALUES($1,$2,$3)',
        [
          courtId,
          fixture.departmentId,
          `Batch2 remand court ${fixture.suffix}`,
        ],
      );
      await client.query('COMMIT');
      return { courtId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function readBatch2RefundLedger(caseId, departmentId, sourceId) {
  return withOwnedDatabase(async (client) => {
    const rows = (
      await client.query(
        `SELECT
       (SELECT count(*)::integer FROM case_refund_applications
        WHERE case_id=$1 AND department_id=$2 AND source_id=$3) AS applications,
       (SELECT count(*)::integer FROM calendar_reminder_reads
        WHERE department_id=$2 AND source_id=$3) AS reads,
       (SELECT count(*)::integer FROM fee_records
        WHERE case_id=$1 AND department_id=$2 AND type='诉讼退费' AND deleted_at IS NULL) AS refund_fees,
       (SELECT count(*)::integer FROM fee_refund_reconciliations
        WHERE case_id=$1 AND department_id=$2) AS actual_refunds`,
        [caseId, departmentId, sourceId],
      )
    ).rows[0];
    return rows;
  });
}

export async function readBatch2RoundRevokedAt(roundId, caseId, departmentId) {
  return withOwnedDatabase(async (client) => {
    const rows = (
      await client.query(
        'SELECT revoked_at FROM case_trial_rounds WHERE id=$1 AND case_id=$2 AND department_id=$3',
        [roundId, caseId, departmentId],
      )
    ).rows;
    if (rows.length !== 1) throw new Error('Owned remand child round absent');
    return rows[0].revoked_at;
  });
}

// Uses the production reminder service against the owned PostgreSQL facts.
// Only this test process's Date.now is controlled; the app and DB clocks stay real.
export async function verifyBatch2RefundBoundaryAndRead(fixture, source) {
  const { databaseUrl } = assertBatch2Admission();
  const { PrismaPg } = backend('@prisma/adapter-pg');
  const { PrismaClient } = backend('./dist/generated/prisma/client.js');
  const { PrismaAccessControlStore } = backend(
    './dist/access-control/prisma-access-control.store.js',
  );
  const { AccessControlService } = backend(
    './dist/access-control/access-control.service.js',
  );
  const { CaseCalendarSourceService } = backend(
    './dist/modules/cases/case-calendar-source.service.js',
  );
  const { CustomerCalendarSourceService } = backend(
    './dist/modules/customers/customer-calendar-source.service.js',
  );
  const { CalendarReminderService } = backend(
    './dist/modules/calendar/calendar-reminder.service.js',
  );
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const account = await database.userAccount.findUnique({
      where: { id: fixture.operator.id },
      select: { active: true, accountType: true, authorizationRevision: true },
    });
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw new Error('Synthetic reminder owner is not current');
    const actor = {
      userId: fixture.operator.id,
      departmentId: fixture.departmentId,
      authorizationRevision: account.authorizationRevision,
    };
    const access = new AccessControlService(
      new PrismaAccessControlStore(database),
    );
    const reminders = new CalendarReminderService(
      database,
      access,
      new CaseCalendarSourceService(database, access),
      new CustomerCalendarSourceService(database, access),
    );
    const recorded = await database.caseSecondInstanceResult.findUnique({
      where: { id: source.resultId },
      select: { caseId: true, recordedAt: true },
    });
    if (
      recorded?.caseId !== source.caseId ||
      recorded.recordedAt.toISOString() !== source.recordedAt
    )
      throw new Error(
        'Controlled clock source differs from actual registered fact',
      );
    const calendarDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(recorded.recordedAt);
    const dueDate = new Date(`${calendarDate}T00:00:00.000Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + 15);
    const dueAt = new Date(
      `${dueDate.toISOString().slice(0, 10)}T01:00:00.000Z`,
    );
    const before = await reminders.due(actor, new Date(dueAt.getTime() - 1));
    const at = await reminders.due(actor, dueAt);
    const item = at.find((value) => value.sourceId === source.resultId);
    if (
      before.some((value) => value.sourceId === source.resultId) ||
      !item ||
      item.readAt !== null
    )
      throw new Error(
        '09:00 arrival boundary differs for actual refund source',
      );
    const originalNow = Date.now;
    let first;
    let second;
    try {
      Date.now = () => dueAt.getTime();
      const identity = {
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceEpoch: item.sourceEpoch,
        eventDate: item.eventDate,
      };
      first = await reminders.markRead(actor, identity);
      second = await reminders.markRead(actor, identity);
    } finally {
      Date.now = originalNow;
    }
    const persisted = await database.calendarReminderRead.count({
      where: {
        departmentId: fixture.departmentId,
        ownerUserId: actor.userId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceEpoch: item.sourceEpoch,
      },
    });
    const after = await reminders.due(actor, dueAt);
    return {
      dueAt: item.dueAt,
      beforeAbsent: true,
      atPresent: true,
      readStable: first.readAt === second.readAt,
      persisted,
      afterRead:
        after.find((value) => value.sourceId === source.resultId)?.readAt ??
        null,
    };
  } finally {
    await database.$disconnect();
  }
}
