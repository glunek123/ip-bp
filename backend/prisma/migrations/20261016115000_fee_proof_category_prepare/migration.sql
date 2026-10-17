-- Prepare the enum in a separate migration before any statement uses its value.
-- No business rows, accounts, roles, or grants are modified.
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'FEE_PROOF';
