CREATE TABLE IF NOT EXISTS public.gpm_app_content (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  about_text text NOT NULL CHECK (length(about_text) BETWEEN 1 AND 10000),
  agreement_text text NOT NULL CHECK (length(agreement_text) BETWEEN 1 AND 30000),
  agreement_effective_date text NOT NULL CHECK (
    length(btrim(agreement_effective_date)) BETWEEN 1 AND 80
  ),
  agreement_revision integer NOT NULL DEFAULT 2 CHECK (agreement_revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.gpm_app_content (
  id,
  about_text,
  agreement_text,
  agreement_effective_date
)
VALUES (
  1,
  $about$# What is GILNET GPM?

GILNET GPM (Guest & Property Management) is a complete hotel management solution by Gilbert C Ngoma.

## What it does

- Front Desk: Check-in, check-out, reservations & guest profiles
- Rooms: Real-time room status, cleaning & maintenance
- Billing: Automatic room, laundry, restaurant & bar charges
- Staff: Manage housekeeping, kitchen & front desk tasks
- Reports: Daily sales, occupancy & revenue reports

## Why GILNET?

Unlike expensive foreign systems, GILNET is affordable, easy to use, supports offline work for cached and local-first tasks, and is built for how Zambian hotels actually operate.

Secure. Fast.

© 2026 GILNET by Gilbert. All Rights Reserved.$about$,
  $agreement$1. ACCEPTANCE OF TERMS

By downloading, installing, or logging into GILNET CONNECT with your 6-digit PIN, you agree to this User Agreement. If you do not agree, do not use the app.

2. SERVICE DESCRIPTION

GILNET CONNECT is a Property and Guest Management Platform (GPM) built for lodges, hotels, guest houses and serviced apartments in Zambia. It manages rooms, bookings, guest check-in/out, staff, billing and reports with offline capability.

3. USER ACCOUNTS & SECURITY

3.1 Property Admin is responsible for creating and managing all staff accounts.
3.2 You must keep your 6-digit PIN confidential.
3.3 Any action performed under your PIN is your responsibility.
3.4 GILNET CONNECT may suspend accounts suspected of misuse.

4. DATA PROTECTION & PRIVACY

4.1 Data synchronized with Supabase is transmitted over encrypted connections. Offline data is cached on your device; keep your device secure.
4.2 Guest data remains property of the Property Owner.
4.3 GILNET CONNECT will never sell or share guest data with third parties.
4.4 The service complies with Zambia Data Protection Act No. 3 of 2021.
4.5 Properties must obtain guest consent before collecting personal information.

5. FEES & SUBSCRIPTIONS

5.1 The subscription belongs to the registered property (for example, GILNET Lodge). The property is responsible for the subscription fees in ZMW, which are charged to the property's account using its nominated billing contact and payment method.
5.2 Staff and other users registered under a property use GILNET CONNECT on behalf of that property. Their logins are not separate subscriptions, and the property's subscription fees are not charged to staff members' personal accounts. The Property Admin is responsible for managing the property subscription and its billing details.
5.3 Subscription payments help us operate, support, maintain and improve GILNET CONNECT. The property agrees to pay by the due date so we can continue serving it. Non-payment after 7 days may lead to account suspension.
5.4 No refunds are provided for partial-month usage.

6. ACCEPTABLE USE

You agree not to use the app for illegal activities, attempt to hack or reverse-engineer the app, share the APK outside authorized staff, or enter false guest information.

7. SYSTEM AVAILABILITY

7.1 The app works offline and syncs when internet is available.
7.2 We aim for high uptime but do not guarantee 100% availability.
7.3 Report all bugs to support.gilnet.property.manager@gmail.com within 24 hours.

8. LIMITATION OF LIABILITY

GILNET CONNECT is not liable for loss of bookings, revenue, or data due to device loss, staff error, internet or power outage. Maximum liability is limited to 3 months subscription fees paid.

9. TERMINATION

9.1 You may terminate with 30 days written notice via email.
9.2 We may terminate immediately for breach, non-payment or illegal use.
9.3 Data will be available for export for 14 days after termination, then permanently deleted.

10. STAFF RESPONSIBILITY

The Property Admin is fully liable for all actions performed by their staff accounts.

11. APP IP ADDRESS AND LOGO

11.1 App Package Name: com.gilnet.gpmconnect
11.2 Server: supabase.com
11.3 Logo: The GILNET CONNECT logo, icon and brand name are the exclusive intellectual property of GILNET CONNECT, Ndola. No copying or unauthorized use is permitted.
11.4 All data traffic between the app and supabase.com is encrypted.

12. CHANGES TO TERMS

We may update this agreement with 7 days notice via email or in-app notification. Continued use constitutes acceptance.

13. CONTACT

GILNET CONNECT, Ndola, Zambia
Email: support.gilnet.property.manager@gmail.com

By tapping “I AGREE” you confirm you have read, understood and accepted this agreement.$agreement$,
  '1 January 2027'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.gpm_app_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpm_app_content FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.gpm_app_content TO anon, authenticated;
GRANT ALL ON TABLE public.gpm_app_content TO service_role;

CREATE POLICY gpm_app_content_public_read
  ON public.gpm_app_content
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

CREATE OR REPLACE FUNCTION public.admin_hub_save_gpm_app_content(
  target_about_text text,
  target_agreement_text text,
  target_agreement_effective_date text,
  target_updated_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  saved_revision integer;
BEGIN
  IF target_about_text IS NULL OR length(target_about_text) NOT BETWEEN 1 AND 10000
    OR target_agreement_text IS NULL OR length(target_agreement_text) NOT BETWEEN 1 AND 30000
    OR target_agreement_effective_date IS NULL
    OR length(btrim(target_agreement_effective_date)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'GPM content is invalid.';
  END IF;

  INSERT INTO public.gpm_app_content (
    id,
    about_text,
    agreement_text,
    agreement_effective_date,
    updated_at,
    updated_by
  )
  VALUES (
    1,
    target_about_text,
    target_agreement_text,
    btrim(target_agreement_effective_date),
    now(),
    target_updated_by
  )
  ON CONFLICT (id) DO UPDATE
  SET about_text = EXCLUDED.about_text,
      agreement_revision = CASE
        WHEN public.gpm_app_content.agreement_text IS DISTINCT FROM EXCLUDED.agreement_text
          OR public.gpm_app_content.agreement_effective_date
            IS DISTINCT FROM EXCLUDED.agreement_effective_date
          THEN public.gpm_app_content.agreement_revision + 1
        ELSE public.gpm_app_content.agreement_revision
      END,
      agreement_text = EXCLUDED.agreement_text,
      agreement_effective_date = EXCLUDED.agreement_effective_date,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by
  RETURNING agreement_revision INTO saved_revision;

  RETURN saved_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hub_save_gpm_app_content(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hub_save_gpm_app_content(text, text, text, uuid)
  TO service_role;
