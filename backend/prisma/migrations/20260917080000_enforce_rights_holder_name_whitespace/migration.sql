BEGIN;

-- Match ECMAScript String.prototype.trim: WhiteSpace and LineTerminator.
-- Explicit code points keep the check independent of PostgreSQL locale rules.
ALTER TABLE "rights_holders"
  DROP CONSTRAINT "rights_holders_name_nonblank_check",
  ADD CONSTRAINT "rights_holders_name_nonblank_check"
    CHECK (NULLIF(BTRIM("name", U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '') IS NOT NULL);

COMMIT;
