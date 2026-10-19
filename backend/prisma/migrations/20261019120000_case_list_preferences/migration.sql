BEGIN;

CREATE TABLE "case_list_preferences" (
    "user_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "bucket" VARCHAR(64) NOT NULL,
    "column_order" TEXT[] NOT NULL,
    "hidden_columns" TEXT[] NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "case_list_preferences_pkey" PRIMARY KEY ("user_id","department_id","bucket"),
    CONSTRAINT "case_list_preferences_bucket_check" CHECK ("bucket" IN (
        'all', 'PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION',
        'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE',
        'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE',
        'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION',
        'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING',
        'WAITING_ARCHIVE', 'ARCHIVED', 'COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'
    ))
);

ALTER TABLE "case_list_preferences" ADD CONSTRAINT "case_list_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "case_list_preferences" ADD CONSTRAINT "case_list_preferences_membership_fkey"
    FOREIGN KEY ("user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
