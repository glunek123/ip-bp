-- New actions are opt-in. Existing roles and accounts receive no grants.
ALTER TYPE public.permission_action ADD VALUE 'case.refund.read';
ALTER TYPE public.permission_action ADD VALUE 'case.refund.record';
ALTER TYPE public.permission_action ADD VALUE 'case.refund.follow';
ALTER TYPE public.permission_action ADD VALUE 'case.refund.export';
