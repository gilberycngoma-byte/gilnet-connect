-- Apply only to the project missing this bucket; review existing policies before running.
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('property_assets', 'property_assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

GRANT UPDATE(name, address, phone, image_url) ON public.properties TO authenticated;

DROP POLICY IF EXISTS property_profile_update ON public.properties;
CREATE POLICY property_profile_update ON public.properties
  FOR UPDATE TO authenticated
  USING (code = public.gpm_property() AND public.gpm_role() = 'Admin')
  WITH CHECK (code = public.gpm_property() AND public.gpm_role() = 'Admin');

DROP POLICY IF EXISTS property_assets_admin_upload ON storage.objects;
CREATE POLICY property_assets_admin_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  );

DROP POLICY IF EXISTS property_assets_admin_update ON storage.objects;
CREATE POLICY property_assets_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  )
  WITH CHECK (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  );

COMMIT;
