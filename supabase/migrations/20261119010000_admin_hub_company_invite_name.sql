ALTER TABLE public.admin_hub_company_invites
  ADD COLUMN IF NOT EXISTS company_name text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_hub_company_invites_company_name_check'
      AND conrelid = 'public.admin_hub_company_invites'::regclass
  ) THEN
    ALTER TABLE public.admin_hub_company_invites
      ADD CONSTRAINT admin_hub_company_invites_company_name_check
      CHECK (
        company_name = ''
        OR (
          length(btrim(company_name)) BETWEEN 1 AND 160
          AND company_name !~ '[[:cntrl:]]'
        )
      );
  END IF;
END;
$$;
