-- Separate enum migration: a following migration may use this value after commit.
-- No upload, payment or case gate is removed here.
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'CASE_CLOSURE_PAYMENT_PROOF';
