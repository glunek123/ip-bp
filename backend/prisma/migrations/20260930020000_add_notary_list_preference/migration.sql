CREATE TABLE "notary_list_preferences" (
    "user_id" UUID NOT NULL,
    "column_order" TEXT[] NOT NULL,
    "hidden_columns" TEXT[] NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notary_list_preferences_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "notary_list_preferences" ADD CONSTRAINT "notary_list_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
