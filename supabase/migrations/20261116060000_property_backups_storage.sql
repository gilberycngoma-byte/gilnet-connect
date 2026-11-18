BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'gilnet-backups',
  'gilnet-backups',
  false,
  26214400,
  ARRAY['application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS gilnet_backups_manager_read ON storage.objects;
CREATE POLICY gilnet_backups_manager_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'gilnet-backups'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

DROP POLICY IF EXISTS gilnet_backups_manager_upload ON storage.objects;
CREATE POLICY gilnet_backups_manager_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gilnet-backups'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

DROP POLICY IF EXISTS gilnet_backups_manager_update ON storage.objects;
CREATE POLICY gilnet_backups_manager_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gilnet-backups'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  )
  WITH CHECK (
    bucket_id = 'gilnet-backups'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

COMMIT;
