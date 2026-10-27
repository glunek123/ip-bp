BEGIN;

ALTER TABLE "local_credentials"
  DROP CONSTRAINT "local_credentials_username_format_check",
  ADD CONSTRAINT "local_credentials_username_format_check"
    CHECK (
      char_length("username") BETWEEN 3 AND 64
      AND "username" !~ '[[:cntrl:]]'
      AND "username" !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
    );

COMMIT;
