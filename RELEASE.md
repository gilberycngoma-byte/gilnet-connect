# GILNET release preparation

## Windows

Run `npm run package:windows` to create a Windows x64 NSIS installer in `release/windows`. The installer packages the local Electron app and its bundled TanStack server; it does not simply open the hosted site. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) to the intended backend before packaging. The bundled key must be public/publishable; never bundle a service-role key. Configure trusted server-side access after installation through File > Configure Supabase server key, where Electron encrypts the key with Windows `safeStorage`. Desktop auto-updates use the Supabase `installers` bucket as a generic update feed. The legacy portable wrapper remains available with `npm run package:windows:portable`.

Before distribution, test the installer on a clean Windows device, verify first launch, offline relaunch, local writes and reconnect synchronization, and sign the installer with an Authenticode certificate. Existing installs built with the old GitHub updater need one manual install of the new Supabase-configured installer; subsequent desktop updates can be installed from Settings.

## Android

The Capacitor app loads its local client bundle from `dist/client`; `npm run android:sync` builds both bundles, renders a bootstrap HTML shell with the local server bundle, and syncs the result to Android. Use `npm run android:build:debug` for a test APK. Supabase login and cloud sync require internet access. Server-side staff administration also requires an accessible server-function endpoint; Capacitor does not configure a remote server URL. Play Store distribution requires a signed release build and the same protected keystore for subsequent updates.

Android builds require Java 21 or newer, the Android SDK and a signing keystore. The launcher icon and native splash screens are generated from `public/icon-1024.png` with `npm run android:branding`; run this after changing the source icon. Use `npm run android:build:debug` for a local test APK. For a distributable update, create the release key once with `.\scripts\create-android-keystore.ps1`, then build with `.\scripts\build-android-release.ps1`. The key stays under `%USERPROFILE%\.gilnet\android`; its randomly generated password is DPAPI-encrypted for the current Windows account. Back up the `.p12` file and maintain access to the Windows account that protects its password. Never replace or commit the release key; future APK updates must use the same key. The release build reads the app version from `package.json` unless `GILNET_ANDROID_VERSION` is set for an Android-only version override. An override produces a versioned APK filename and must increase the Android version code.

Apply `drizzle/migrations/0003_property_assets_storage.sql` only to a Supabase project confirmed to be missing the `property_assets` bucket. In the current setup, that is the new Electron backend; leave the old Android/site backend untouched if its uploads still work. Keep the projects separate and do not copy user or property data between them.

The Supabase Auth email OTP length is set to six digits to match the app's confirmation and password-reset forms. This project-wide setting applies to all email OTP messages.

The new Electron backend also needs the `staff_members` and private-message database objects from migration `0002`. Verify those objects before applying that migration, since the backend may already have some of its changes; Messages can fall back to property-scoped profiles and roles for directory display while `staff_members` is absent. Apply migration `0005_staff_role_constraints.sql` to each Supabase backend after verifying its `user_roles` and `staff_members` tables; it enables every role offered by Staff Management and the department values used when adding staff. Apply `0006_supabase_installer_updates.sql` to create the public `installers` bucket and extend the existing `app_versions` table; do not create a second `app_versions` table.

After approving a code release, prepare its version and optional update manifest with:

```powershell
npm run release:prepare -- patch "Short release notes"
```

Use `minor` or `major` instead of `patch` when appropriate. Build the Windows installer and signed Android APK. Upload the versioned Windows installer, its `.blockmap`, `latest.yml`, and the Android APK named `GILNET-GPM-CONNECT.apk` to the public `installers` bucket. Keep the versioned Windows files in the bucket and overwrite only `latest.yml` and the stable APK name for each release. The Windows updater reads `latest.yml`; the Android/web update check reads the latest `app_versions` row. Publish that row after all files have uploaded:

```sql
BEGIN;
UPDATE public.app_versions SET is_latest = false WHERE is_latest;
INSERT INTO public.app_versions
  (version, file_name, public_url, apk_url, release_notes, forced, is_latest)
VALUES
  ('2.5.5',
   'GILNET-GPM-CONNECT-2.5.5-Setup.exe',
   'https://YOUR_PROJECT.supabase.co/storage/v1/object/public/installers/GILNET-GPM-CONNECT-2.5.5-Setup.exe',
   'https://YOUR_PROJECT.supabase.co/storage/v1/object/public/installers/GILNET-GPM-CONNECT.apk',
   'Short release notes',
   false,
   true)
ON CONFLICT (version) DO UPDATE SET
  file_name = EXCLUDED.file_name,
  public_url = EXCLUDED.public_url,
  apk_url = EXCLUDED.apk_url,
  release_notes = EXCLUDED.release_notes,
  forced = EXCLUDED.forced,
  is_latest = true,
  created_at = now();
COMMIT;
```

Replace the example version, project URL and release notes with the prepared release values. The `installers` bucket is public for downloads; do not enable anonymous uploads. `public/version.json` remains a static build manifest, while published release checks use Supabase.

## PWA, offline app and updates

The published PWA uses `public/manifest.webmanifest` and `public/sw.js`. Offline registration is disabled in the editor and preview. Open the home page and each operational page online first, then disconnect and reopen from the installed icon. Confirm existing property data appears, a saved operational change survives closing, and it syncs when reconnected.

Updates are announced by the Account badge and applied only after a user checks and confirms; “Not now” leaves the current web session and saved data alone. `forced` remains false. A failed check is not reported as “Up to date”. Updates never delete local storage or all caches, and there is no automatic navigation on worker activation. Test a newer published release with an older installed version before claiming update delivery verified.