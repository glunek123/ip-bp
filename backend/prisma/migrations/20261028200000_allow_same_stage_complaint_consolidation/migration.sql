CREATE OR REPLACE FUNCTION check_case_consolidation_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_id UUID; root RECORD; member_count INTEGER; main_count INTEGER; mismatch_count INTEGER; receipt_count INTEGER; shop_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'case_consolidations' THEN
    root_id := NEW."id";
  ELSIF TG_TABLE_NAME IN ('case_consolidation_members', 'case_consolidation_receipts') THEN
    root_id := NEW."consolidation_id";
  ELSE
    RAISE EXCEPTION 'unexpected consolidation integrity target' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO root FROM "case_consolidations" WHERE "id" = root_id;
  SELECT count(*), count(*) FILTER (WHERE "case_id" = root."main_case_id" AND "is_main")
    INTO member_count, main_count FROM "case_consolidation_members" WHERE "consolidation_id" = root_id;
  IF member_count NOT BETWEEN 2 AND 20 OR main_count <> 1 THEN
    RAISE EXCEPTION 'consolidation needs two to twenty cases and one main case' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO mismatch_count FROM "case_consolidation_members" member
    JOIN "cases" record ON record."id" = member."case_id"
    JOIN "cases" main ON main."id" = root."main_case_id"
    WHERE member."consolidation_id" = root_id
      AND (member."department_id" <> root."department_id"
        OR member."is_main" <> (member."case_id" = root."main_case_id")
        OR record."customer_id" <> main."customer_id"
        OR record."rights_holder_id" <> main."rights_holder_id"
        OR record."stage" <> main."stage"
        OR record."stage" NOT IN ('PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP')
        OR record."version" <> member."original_version" + 1);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'consolidation members have inconsistent source facts' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO receipt_count FROM "case_consolidation_receipts"
    WHERE "consolidation_id" = root_id AND "department_id" = root."department_id";
  IF receipt_count <> 1 THEN
    RAISE EXCEPTION 'consolidation requires one immutable receipt' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_consolidation_members" main
      ON main."consolidation_id" = member."consolidation_id" AND main."is_main"
    WHERE member."consolidation_id" = root_id
      AND (member."defendant_kind", member."defendant_name", member."defendant_id_no")
        IS DISTINCT FROM (main."defendant_kind", main."defendant_name", main."defendant_id_no")
  ) THEN
    RAISE EXCEPTION 'consolidation defendant identity differs' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_defendants" defendant ON defendant."case_id" = member."case_id"
      AND defendant."department_id" = member."department_id"
    WHERE member."consolidation_id" = root_id
      AND (defendant."kind", defendant."name", defendant."id_no")
        IS DISTINCT FROM (member."defendant_kind", member."defendant_name", member."defendant_id_no")
  ) OR EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_defendants" defendant ON defendant."case_id" = member."case_id"
      AND defendant."department_id" = member."department_id"
    WHERE member."consolidation_id" = root_id
    GROUP BY member."case_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'consolidation conflicts with existing defendant' USING ERRCODE = '23514';
  END IF;
  SELECT count(DISTINCT (
    COALESCE(lead."platform"::text, entry."known"->>'platform'),
    COALESCE(btrim(lead."shop_external_id"), btrim(entry."known"->>'shopExternalId'))
  )) INTO shop_count
  FROM "case_consolidation_members" member
  JOIN "cases" record ON record."id" = member."case_id"
  LEFT JOIN "leads" lead ON lead."id" = record."source_lead_id"
  LEFT JOIN "case_external_entries" entry ON entry."case_id" = record."id"
  WHERE member."consolidation_id" = root_id;
  IF shop_count <> 1 OR EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "cases" record ON record."id" = member."case_id"
    LEFT JOIN "leads" lead ON lead."id" = record."source_lead_id"
    LEFT JOIN "case_external_entries" entry ON entry."case_id" = record."id"
    WHERE member."consolidation_id" = root_id AND (
      COALESCE(lead."platform"::text, entry."known"->>'platform', '') = '' OR
      COALESCE(btrim(lead."shop_external_id"), btrim(entry."known"->>'shopExternalId'), '') = ''
    )
  ) THEN
    RAISE EXCEPTION 'consolidation shop identity differs or is incomplete' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "cases" main ON main."id" = root."main_case_id"
    LEFT JOIN LATERAL (
      SELECT count(*) AS assigned_count, (array_agg("lawyer_id"))[1] AS lawyer_id
      FROM "case_lawyer_assignments"
      WHERE "case_id" = member."case_id" AND "department_id" = member."department_id"
        AND "role" = 'PRIMARY' AND "ended_at" IS NULL
    ) assignment ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS assigned_count, (array_agg("lawyer_id"))[1] AS lawyer_id
      FROM "case_lawyer_assignments"
      WHERE "case_id" = main."id" AND "department_id" = root."department_id"
        AND "role" = 'PRIMARY' AND "ended_at" IS NULL
    ) main_assignment ON true
    WHERE member."consolidation_id" = root_id
      AND main."stage" <> 'PENDING_MATCH'
      AND (assignment.assigned_count <> 1 OR main_assignment.assigned_count <> 1
        OR assignment.lawyer_id IS DISTINCT FROM main_assignment.lawyer_id)
  ) THEN
    RAISE EXCEPTION 'consolidation primary lawyer differs or is missing' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;


