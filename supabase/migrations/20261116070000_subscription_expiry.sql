ALTER TABLE public.property_subscriptions
ADD COLUMN IF NOT EXISTS expires_on date;
