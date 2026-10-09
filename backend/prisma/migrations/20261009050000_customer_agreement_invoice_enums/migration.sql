ALTER TYPE "permission_action" ADD VALUE 'customer.agreement.read';
ALTER TYPE "permission_action" ADD VALUE 'customer.agreement.edit';
ALTER TYPE "permission_action" ADD VALUE 'customer.invoice.read';
ALTER TYPE "permission_action" ADD VALUE 'customer.invoice.edit';
ALTER TYPE "material_category" ADD VALUE 'CUSTOMER_AGREEMENT';
CREATE TYPE "customer_agreement_validity_mode" AS ENUM ('FIXED', 'LONG_TERM', 'UNKNOWN');
