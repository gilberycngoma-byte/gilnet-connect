import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = { action: "list" } | { action: "select"; planId: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(value: unknown): RequestBody | null {
  if (!isRecord(value)) return null;
  if (value["action"] === "list") return { action: "list" };
  if (
    value["action"] === "select" &&
    typeof value["planId"] === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value["planId"],
    )
  ) {
    return { action: "select", planId: value["planId"] };
  }
  return null;
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
  const input = parseRequest(body);
  if (!input) return jsonResponse({ error: "Invalid subscription request." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase URL or server-side service-role key is not configured.");
    return jsonResponse({ error: "The subscription service is not configured." }, 500);
  }

  try {
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
      console.error("Property subscription role lookup failed.", roleError);
      return jsonResponse({ error: "Your property access could not be verified." }, 500);
    }
    if (!role || !["Admin", "Manager", "Supervisor"].includes(role.role)) {
      return jsonResponse(
        { error: "Only property Admins, Managers, and Supervisors can view subscription status." },
        403,
      );
    }
    if (input.action === "select" && role.role !== "Admin") {
      return jsonResponse(
        { error: "Only the property Admin can select a subscription plan." },
        403,
      );
    }

    const { data: property, error: propertyError } = await adminClient
      .from("properties")
      .select("code,name,billing_email")
      .eq("code", role.property_code)
      .maybeSingle();
    if (propertyError || !property) {
      console.error("Property subscription profile lookup failed.", propertyError);
      return jsonResponse({ error: "The property account could not be loaded." }, 500);
    }
    if (input.action === "list") {
      const { data: subscription, error: subscriptionError } = await adminClient
        .from("property_subscriptions")
        .select("plan_id,status,selected_at")
        .eq("property_code", property.code)
        .maybeSingle();
      if (subscriptionError) {
        console.error("Property subscription status lookup failed.", subscriptionError);
        return jsonResponse(
          { error: "The property subscription status could not be loaded." },
          500,
        );
      }

      if (role.role !== "Admin") {
        return jsonResponse({
          property: { code: property.code, name: property.name, billingEmail: null },
          plans: [],
          subscription,
        });
      }

      if (!property.billing_email) {
        return jsonResponse(
          { error: "Set a property billing email before viewing subscription plans." },
          409,
        );
      }

      const { data: plans, error: plansError } = await adminClient
        .from("subscription_plans")
        .select("id,name,price,currency,billing_interval,description,features,recommended")
        .eq("active", true)
        .order("price");
      if (plansError) {
        console.error("Property subscription plan lookup failed.", plansError);
        return jsonResponse({ error: "Subscription plans could not be loaded." }, 500);
      }

      return jsonResponse({
        property: {
          code: property.code,
          name: property.name,
          billingEmail: property.billing_email,
        },
        plans: plans ?? [],
        subscription,
      });
    }

    if (!property.billing_email) {
      return jsonResponse(
        { error: "Set a property billing email before selecting a subscription plan." },
        409,
      );
    }

    const { data: plan, error: planError } = await adminClient
      .from("subscription_plans")
      .select("id")
      .eq("id", input.planId)
      .eq("active", true)
      .maybeSingle();
    if (planError || !plan) {
      return jsonResponse({ error: "Choose an available subscription plan." }, 400);
    }

    const { error: upsertError } = await adminClient.from("property_subscriptions").upsert(
      {
        property_code: property.code,
        plan_id: plan.id,
        status: "pending_payment",
        selected_by: authData.user.id,
        selected_at: new Date().toISOString(),
      },
      { onConflict: "property_code" },
    );
    if (upsertError) {
      console.error("Property subscription selection failed.", upsertError);
      return jsonResponse({ error: "The property plan selection could not be saved." }, 500);
    }

    return jsonResponse({ ok: true, status: "pending_payment" });
  } catch (error) {
    console.error("Property subscription request failed unexpectedly.", error);
    return jsonResponse(
      { error: "The subscription service encountered an unexpected error." },
      500,
    );
  }
});
