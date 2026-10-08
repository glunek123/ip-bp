ALTER TYPE "permission_action" ADD VALUE 'customer.right-asset.withdraw';
CREATE TYPE "customer_right_asset_type" AS ENUM ('TRADEMARK', 'PATENT', 'COPYRIGHT', 'REPUTATION', 'AUTHORIZATION', 'OTHER');
CREATE TYPE "customer_right_asset_validity_mode" AS ENUM ('FIXED', 'LONG_TERM', 'UNKNOWN');
CREATE TYPE "customer_right_asset_action" AS ENUM ('CREATE', 'REVISE', 'WITHDRAW');
