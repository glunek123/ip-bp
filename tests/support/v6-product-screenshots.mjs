import { randomUUID } from 'node:crypto';
import {
  grantV6SyntheticRole,
  seedV6InternalCustomer,
  v6Access,
  v6Actor,
  v6BackendClass,
  v6Materials,
  v6ScopedPrisma,
  withV6FollowupSchema,
} from './v6-followup-fixture.mjs';

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

export async function verifyV6ProductScreenshots() {
  return withV6FollowupSchema(async ({ client, schema }) => {
    const owner = await seedV6InternalCustomer(client);
    const outsider = await seedV6InternalCustomer(client);
    const leadId = randomUUID();
    const productId = randomUUID();
    const otherProductId = randomUUID();
    const materialId = randomUUID();
    const versionId = randomUUID();
    await client.query(
      `INSERT INTO leads(id,department_id,business_no,customer_id,rights_holder_id,
         responsible_user_id,status,case_type,source,platform,found_at,shop_name,
         need_disclose,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'WAITING_PUSH','CIVIL','ONLINE','TAOBAO',
         now(),'合成店铺',false,now())`,
      [
        leadId,
        owner.departmentId,
        `LD-V6-${leadId.slice(0, 8)}`,
        owner.customerId,
        owner.rightsHolderId,
        owner.actorUserId,
      ],
    );
    for (const [id, position] of [
      [productId, 1],
      [otherProductId, 2],
    ]) {
      await client.query(
        `INSERT INTO lead_products(id,lead_id,position,title,quantity,unit_price,
           comment_count,estimated_amount)
         VALUES($1,$2,$3,'合成商品',1,1.00,0,1.00)`,
        [id, leadId, position],
      );
    }
    await client.query(
      `INSERT INTO materials(id,department_id,owner_type,owner_id,category,purpose,
         updated_at)
       VALUES($1,$2,'LEAD',$3,'LEAD_SCREENSHOT','LEAD_SCREENSHOT',now())`,
      [materialId, owner.departmentId, leadId],
    );
    await client.query(
      `INSERT INTO content_versions(id,material_id,storage_key,original_filename,
         mime_type,size_bytes,sha256,uploaded_by)
       VALUES($1,$2,$3,'synthetic.png','image/png',8,repeat('a',64),$4)`,
      [
        versionId,
        materialId,
        `v6-synthetic/${versionId}.png`,
        owner.actorUserId,
      ],
    );
    await client.query(
      'UPDATE materials SET current_version_id=$2 WHERE id=$1',
      [materialId, versionId],
    );
    const roleId = await grantV6SyntheticRole(client, owner, [
      ['lead.read', 'SELF'],
      ['lead.edit', 'SELF'],
    ]);
    await grantV6SyntheticRole(client, outsider, [
      ['lead.read', 'DEPARTMENT'],
      ['lead.edit', 'DEPARTMENT'],
    ]);
    const database = v6ScopedPrisma(schema);
    try {
      const access = v6Access(database);
      const materials = v6Materials(database, access);
      const LeadService = v6BackendClass(
        'modules/leads/lead.service.js',
        'LeadService',
      );
      const service = new LeadService(database, access, materials);
      const actor = v6Actor(owner);
      const input = {
        expectedVersion: 1,
        screenshotContentVersionIds: [versionId],
      };

      await client.query(`CREATE FUNCTION v6_fail_screenshot_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action='lead.product-screenshots.updated' THEN
            RAISE EXCEPTION 'synthetic screenshot audit failure' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$`);
      await client.query(`CREATE TRIGGER v6_fail_screenshot_audit BEFORE INSERT
        ON audit_events FOR EACH ROW EXECUTE FUNCTION v6_fail_screenshot_audit()`);
      let failed;
      try {
        await service.updateProductScreenshots(actor, leadId, productId, input);
      } catch (error) {
        failed = error;
      }
      assert(failed, 'Late screenshot audit failure unexpectedly committed');
      const rolledBack = (
        await client.query(
          `SELECT (SELECT version FROM leads WHERE id=$1) AS version,
          (SELECT count(*)::int FROM lead_product_screenshots WHERE lead_id=$1) AS screenshots,
          (SELECT count(*)::int FROM material_references WHERE resource_id=$1
            AND purpose='LEAD_SCREENSHOT') AS refs`,
          [leadId],
        )
      ).rows[0];
      assert(
        rolledBack.version === 1 &&
          rolledBack.screenshots === 0 &&
          rolledBack.refs === 0,
        'Screenshot failure left partial state',
      );
      await client.query(
        'DROP TRIGGER v6_fail_screenshot_audit ON audit_events',
      );
      await client.query('DROP FUNCTION v6_fail_screenshot_audit()');

      const created = await service.updateProductScreenshots(
        actor,
        leadId,
        productId,
        input,
      );
      assert(
        created.version === 2,
        'Product screenshot update did not advance lead',
      );
      const association = (
        await client.query(
          `SELECT product_id,material_id,content_version_id FROM lead_product_screenshots
         WHERE lead_id=$1`,
          [leadId],
        )
      ).rows;
      assert(
        association.length === 1 &&
          association[0].product_id === productId &&
          association[0].material_id === materialId &&
          association[0].content_version_id === versionId,
        'Screenshot did not bind stable product and exact material version',
      );
      await expectCode(
        () =>
          service.updateProductScreenshots(actor, leadId, otherProductId, {
            expectedVersion: 2,
            screenshotContentVersionIds: [versionId],
          }),
        'VALIDATION_ERROR',
      );

      await client.query(
        `UPDATE leads SET status='WAITING_REVIEW' WHERE id=$1`,
        [leadId],
      );
      const afterPush = await service.updateProductScreenshots(
        actor,
        leadId,
        productId,
        { expectedVersion: 2, screenshotContentVersionIds: [versionId] },
      );
      assert(
        afterPush.version === 3,
        'In-process lead refused product screenshot edit',
      );
      await expectCode(
        () =>
          service.updateProductScreenshots(
            v6Actor(outsider),
            leadId,
            productId,
            { expectedVersion: 3, screenshotContentVersionIds: [versionId] },
          ),
        'RESOURCE_NOT_FOUND',
      );
      await client.query(
        `DELETE FROM role_grants WHERE role_template_id=$1 AND action='lead.edit'`,
        [roleId],
      );
      await expectCode(
        () =>
          service.updateProductScreenshots(actor, leadId, productId, {
            expectedVersion: 3,
            screenshotContentVersionIds: [versionId],
          }),
        'ACTION_FORBIDDEN',
      );
      await client.query(`UPDATE leads SET status='ARCHIVED' WHERE id=$1`, [
        leadId,
      ]);
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
        VALUES($1,$2,'lead.edit','SELF')`,
        [randomUUID(), roleId],
      );
      await expectCode(
        () =>
          service.updateProductScreenshots(actor, leadId, productId, {
            expectedVersion: 3,
            screenshotContentVersionIds: [versionId],
          }),
        'INVALID_STATE',
      );
      return {
        checks: [
          'late service failure rolls back version, screenshot and material reference',
          'stable product and exact PNG version persist through in-process edit',
          'cross-department, insufficient grant and archived state reject mutation',
        ],
      };
    } finally {
      await database.$disconnect();
    }
  });
}
