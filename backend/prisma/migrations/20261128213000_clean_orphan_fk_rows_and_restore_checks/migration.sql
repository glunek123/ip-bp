-- Clean orphan rows violating the 20 unvalidated/failing FK constraints and idempotently restore the 5 dropped CHECK constraints.

DELETE FROM "case_litigation_refund_item_meta" t
WHERE NOT EXISTS (
  SELECT 1 FROM "case_refund_inventory_items" p
  WHERE p."inventory_version_id" = t."inventory_version_id" AND p."item_id" = t."item_id"
);

DELETE FROM "case_refund_inventory_item_amounts" t
WHERE NOT EXISTS (
  SELECT 1 FROM "case_refund_inventory_items" p
  WHERE p."inventory_version_id" = t."inventory_version_id" AND p."item_id" = t."item_id"
);

DELETE FROM "case_closure_versions" t
WHERE NOT EXISTS (SELECT 1 FROM "audit_events" ae WHERE ae."id" = t."audit_event_id")
   OR NOT EXISTS (
     SELECT 1 FROM "case_closures" cc
     WHERE cc."id" = t."closure_id" AND cc."case_id" = t."case_id" AND cc."department_id" = t."department_id"
   );

DELETE FROM "case_consolidation_receipts" r
WHERE EXISTS (
  SELECT 1 FROM "case_consolidations" t
  WHERE t."id" = r."consolidation_id" AND t."department_id" = r."department_id"
    AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = t."main_case_id" AND c."department_id" = t."department_id")
);

DELETE FROM "case_consolidation_members" m
WHERE EXISTS (
  SELECT 1 FROM "case_consolidations" t
  WHERE t."id" = m."consolidation_id" AND t."department_id" = m."department_id"
    AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = t."main_case_id" AND c."department_id" = t."department_id")
);

DELETE FROM "case_archive_evidence_snapshots" s
WHERE s."consolidation_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "case_consolidations" t
    WHERE t."id" = s."consolidation_id" AND t."department_id" = s."department_id"
      AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = t."main_case_id" AND c."department_id" = t."department_id")
  );

DELETE FROM "case_consolidations" t
WHERE NOT EXISTS (
  SELECT 1 FROM "cases" c
  WHERE c."id" = t."main_case_id" AND c."department_id" = t."department_id"
);

DELETE FROM "case_csv_imported_rows" t
WHERE NOT EXISTS (
  SELECT 1 FROM "cases" c
  WHERE c."id" = t."case_id" AND c."department_id" = t."department_id"
);

DELETE FROM "case_external_entry_receipts" t
WHERE NOT EXISTS (
  SELECT 1 FROM "cases" c
  WHERE c."id" = t."case_id" AND c."department_id" = t."department_id"
);

DELETE FROM "case_lawyer_assignments" t
WHERE NOT EXISTS (
  SELECT 1 FROM "cases" c
  WHERE c."id" = t."case_id" AND c."department_id" = t."department_id"
);

DELETE FROM "case_trial_rounds" t
WHERE NOT EXISTS (
  SELECT 1 FROM "cases" c
  WHERE c."id" = t."case_id" AND c."department_id" = t."department_id"
)
OR (
  t."external_entry_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "case_external_entries" ee
    WHERE ee."id" = t."external_entry_id" AND ee."case_id" = t."case_id" AND ee."department_id" = t."department_id"
  )
);

DELETE FROM "client_lead_review_receipts" t
WHERE (
  t."review_decision_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "lead_review_decisions" lrd WHERE lrd."id" = t."review_decision_id")
)
OR (
  t."result_lead_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "leads" l WHERE l."id" = t."result_lead_id" AND l."department_id" = t."department_id"
  )
)
OR (
  t."review_decision_id" IS NOT NULL AND t."result_lead_id" IS NOT NULL AND t."actor_user_id" IS NOT NULL AND t."result_lead_version" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "lead_review_decisions" lrd
    WHERE lrd."id" = t."review_decision_id"
      AND lrd."department_id" = t."department_id"
      AND lrd."lead_id" = t."result_lead_id"
      AND lrd."reviewer_user_id" = t."actor_user_id"
      AND lrd."to_version" = t."result_lead_version"
  )
);

DELETE FROM "customer_admission_receipts" t
WHERE t."result_customer_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customers" c WHERE c."id" = t."result_customer_id" AND c."department_id" = t."department_id"
  );

DELETE FROM "customer_agreement_versions" t
WHERE NOT EXISTS (
  SELECT 1 FROM "customer_agreements" ca
  WHERE ca."id" = t."agreement_id" AND ca."customer_id" = t."customer_id" AND ca."department_id" = t."department_id"
);

DELETE FROM "lead_command_receipts" t
WHERE t."result_lead_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "leads" l WHERE l."id" = t."result_lead_id" AND l."department_id" = t."department_id"
  );

DELETE FROM "material_references" t
WHERE t."action_event_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "audit_events" ae WHERE ae."id" = t."action_event_id");

DELETE FROM "rights_holder_command_receipts" t
WHERE (t."result_customer_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = t."result_customer_id" AND c."department_id" = t."department_id"))
   OR (t."result_holder_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rights_holders" rh WHERE rh."id" = t."result_holder_id" AND rh."department_id" = t."department_id"))
   OR (t."result_link_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customer_rights_holder_links" lnk WHERE lnk."id" = t."result_link_id" AND lnk."department_id" = t."department_id"));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_archive_versions_check2') THEN
    ALTER TABLE "public"."case_archive_versions" ADD CONSTRAINT "case_archive_versions_check2" CHECK (((archive_at >= '0001-01-01'::date) AND (archive_at <= ((recorded_at AT TIME ZONE 'Asia/Shanghai'::text))::date)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_closure_versions_check3') THEN
    ALTER TABLE "public"."case_closure_versions" ADD CONSTRAINT "case_closure_versions_check3" CHECK (((close_at IS NULL) OR (close_at <= ((recorded_at AT TIME ZONE 'Asia/Shanghai'::text))::date)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_complaint_state_check') THEN
    ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK ((((source_lead_id IS NULL) AND (source_notary_matter_id IS NULL) AND (certificate_id IS NULL)) OR (((stage = ANY (ARRAY['PENDING_MATCH'::case_stage, 'WAITING_COMPLAINT'::case_stage])) AND (complaint_submitted_at IS NULL) AND (complaint_submitted_by_user_id IS NULL) AND (complaint_amount_state IS NULL) AND (complaint_amount IS NULL) AND (complaint_pending_reason IS NULL)) OR ((stage = ANY (ARRAY['WAITING_COMPLAINT_CONFIRMATION'::case_stage, 'WAITING_COMPLAINT_STAMP'::case_stage, 'WAITING_FILING'::case_stage, 'WAITING_FORMAL_ACCEPTANCE'::case_stage, 'WAITING_HEARING'::case_stage, 'WAITING_JUDGMENT'::case_stage, 'SECOND_INSTANCE'::case_stage, 'WAITING_EXECUTION_DOCUMENTS'::case_stage, 'WAITING_EXECUTION_CONFIRMATION'::case_stage, 'WAITING_EXECUTION_STAMP'::case_stage, 'WAITING_EXECUTION_FILING'::case_stage, 'EXECUTING'::case_stage, 'WAITING_ARCHIVE'::case_stage, 'ARCHIVED'::case_stage])) AND (complaint_submitted_at IS NOT NULL) AND (complaint_submitted_by_user_id IS NOT NULL) AND (complaint_amount_state IS NOT NULL) AND (((complaint_amount_state = 'KNOWN'::case_complaint_amount_state) AND (complaint_amount IS NOT NULL) AND (complaint_amount >= (0)::numeric) AND (complaint_pending_reason IS NULL)) OR ((complaint_amount_state = 'PENDING'::case_complaint_amount_state) AND (complaint_amount IS NULL) AND (complaint_pending_reason IS NOT NULL) AND (char_length(btrim((complaint_pending_reason)::text)) > 0))))) OR (stage = 'ARCHIVED'::case_stage) OR (stage = 'WAITING_ARCHIVE'::case_stage)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_matched_on_state_check') THEN
    ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_matched_on_state_check" CHECK (((matched_on IS NULL) OR (stage <> 'PENDING_MATCH'::case_stage)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_matching_state_check') THEN
    ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_matching_state_check" CHECK ((((source_lead_id IS NULL) AND (source_notary_matter_id IS NULL) AND (certificate_id IS NULL)) OR ((version >= 1) AND (((stage = 'PENDING_MATCH'::case_stage) AND (matched_at IS NULL)) OR ((stage = ANY (ARRAY['WAITING_COMPLAINT'::case_stage, 'WAITING_COMPLAINT_CONFIRMATION'::case_stage, 'WAITING_COMPLAINT_STAMP'::case_stage, 'WAITING_FILING'::case_stage, 'WAITING_FORMAL_ACCEPTANCE'::case_stage, 'WAITING_HEARING'::case_stage, 'WAITING_JUDGMENT'::case_stage, 'SECOND_INSTANCE'::case_stage, 'WAITING_EXECUTION_DOCUMENTS'::case_stage, 'WAITING_EXECUTION_CONFIRMATION'::case_stage, 'WAITING_EXECUTION_STAMP'::case_stage, 'WAITING_EXECUTION_FILING'::case_stage, 'EXECUTING'::case_stage, 'WAITING_ARCHIVE'::case_stage, 'ARCHIVED'::case_stage])) AND (matched_at IS NOT NULL)))) OR (stage = 'ARCHIVED'::case_stage) OR (stage = 'WAITING_ARCHIVE'::case_stage)));
  END IF;
END $$;
