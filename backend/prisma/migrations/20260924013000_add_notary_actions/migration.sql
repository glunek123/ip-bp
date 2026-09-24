ALTER TYPE "permission_action" ADD VALUE 'notary.office.manage';
ALTER TYPE "lead_status" ADD VALUE 'TRANSFERRED_TO_NOTARY';

CREATE TYPE "notary_office_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "notary_matter_stage" AS ENUM ('PENDING_EVIDENCE');
CREATE TYPE "notary_evidence_mode" AS ENUM ('ONLINE_PURCHASE');
CREATE TYPE "notary_source_type" AS ENUM ('LEAD');
