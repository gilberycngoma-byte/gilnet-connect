import { createClient } from "npm:@supabase/supabase-js@2";
import { daysUntilLusakaDate } from "../_shared/subscription-expiry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonResponse({ error: "Sign in to continue." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "A valid JSON request body is required." }, 400);
  }
  if (
    !isRecord(body) ||
    (body["action"] !== "latest" && body["action"] !== "subscription_reminder")
  ) {
    return jsonResponse({ error: "Invalid announcement request." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase URL or server-side service-role key is not configured.");
    return jsonResponse({ error: "The announcement service is not configured." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !authData.user) {
    return jsonResponse({ error: "Your session is invalid or has expired. Sign in again." }, 401);
  }

  const { data: role, error: roleError } = await adminClient
    .from("user_roles")
    .select("property_code,role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (roleError) {
    console.error("GILNET announcement property access lookup failed.", roleError);
    return jsonResponse({ error: "Your property access could not be verified." }, 500);
  }
  if (!role?.property_code) {
    return jsonResponse({ error: "A registered property account is required." }, 403);
  }

  if (body["action"] === "subscription_reminder") {
    if (role.role !== "Admin") {
      return jsonResponse({ reminder: null });
    }

    const { data: subscription, error: subscriptionError } = await adminClient
      .from("property_subscriptions")
      .select("status,expires_on,plan_id")
      .eq("property_code", role.property_code)
      .maybeSingle();
    if (subscriptionError) {
      console.error("GILNET subscription expiry lookup failed.", subscriptionError);
      return jsonResponse({ error: "The subscription reminder could not be loaded." }, 500);
    }
    if (
      !subscription ||
      subscription.status !== "active" ||
      typeof subscription.expires_on !== "string"
    ) {
      return jsonResponse({ reminder: null });
    }

    const daysRemaining = daysUntilLusakaDate(subscription.expires_on, new Date());
    if (!Number.isInteger(daysRemaining) || daysRemaining < 0 || daysRemaining > 7) {
      return jsonResponse({ reminder: null });
    }
    const [{ data: property, error: propertyError }, { data: plan, error: planError }] =
      await Promise.all([
        adminClient.from("properties").select("name").eq("code", role.property_code).maybeSingle(),
        adminClient
          .from("subscription_plans")
          .select("name")
          .eq("id", subscription.plan_id)
          .maybeSingle(),
      ]);
    if (propertyError || planError || !property || !plan) {
      console.error(
        "GILNET subscription reminder details lookup failed.",
        propertyError ?? planError,
      );
      return jsonResponse({ error: "The subscription reminder details could not be loaded." }, 500);
    }

    const dayLabel = daysRemaining === 1 ? "day" : "days";
    return jsonResponse({
      reminder: {
        propertyCode: role.property_code,
        propertyName: property.name,
        planName: plan.name,
        expiresOn: subscription.expires_on,
        daysRemaining,
        message: `Your ${plan.name} subscription for ${property.name} ends on ${subscription.expires_on} (${daysRemaining} ${dayLabel} remaining). Please contact GILNET support to renew.`,
      },
    });
  }

  const now = new Date().toISOString();
  const [propertyAnnouncementResult, globalAnnouncementResult] = await Promise.all([
    adminClient
      .from("gpm_announcements")
      .select("id,message,created_at")
      .eq("property_code", role.property_code)
      .eq("active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("gpm_announcements")
      .select("id,message,created_at")
      .is("property_code", null)
      .eq("active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (propertyAnnouncementResult.error || globalAnnouncementResult.error) {
    console.error(
      "GILNET announcement lookup failed.",
      propertyAnnouncementResult.error ?? globalAnnouncementResult.error,
    );
    return jsonResponse({ error: "The announcement could not be loaded." }, 500);
  }

  const announcement = [propertyAnnouncementResult.data, globalAnnouncementResult.data]
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  return jsonResponse({
    announcement: announcement ? { id: announcement.id, message: announcement.message } : null,
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
