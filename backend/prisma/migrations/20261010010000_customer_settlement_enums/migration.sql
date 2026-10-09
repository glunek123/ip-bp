BEGIN;
ALTER TYPE permission_action ADD VALUE IF NOT EXISTS 'customer.settlement.read';
ALTER TYPE permission_action ADD VALUE IF NOT EXISTS 'customer.settlement.register';
ALTER TYPE permission_action ADD VALUE IF NOT EXISTS 'customer.settlement.correct';
CREATE TYPE customer_settlement_action AS ENUM ('REGISTER', 'CORRECT');
COMMIT;
