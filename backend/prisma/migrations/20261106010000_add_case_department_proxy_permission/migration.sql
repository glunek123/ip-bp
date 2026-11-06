-- Explicit opt-in for acting on another owner's case in the same department.
-- No existing role receives this grant automatically.
ALTER TYPE public.permission_action ADD VALUE 'case.department.proxy';
