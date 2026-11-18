import { createClient } from "npm:@supabase/supabase-js@2";
import { hashLoginIdentifier } from "../_shared/auth-lockout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond(405, { error: "Method not allowed." });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return respond(400, { error: "The sign-in request is invalid." });
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return respond(400, { error: "The sign-in request is invalid." });
  }

  const body = input as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  const propertyCode =
    typeof body["property_code"] === "string" ? body["property_code"].trim().toUpperCase() : "";
  const pin = typeof body["pin"] === "string" ? body["pin"] : "";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^[A-Z0-9_-]{2,32}$/.test(propertyCode) ||
    !/^\d{6}$/.test(pin)
  ) {
    return respond(401, { error: "Invalid staff email or PIN." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    console.error("staff-pin-login: Supabase service configuration is missing.");
    return respond(500, { error: "Staff PIN sign-in is temporarily unavailable." });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const loginHash = await hashLoginIdentifier(`email:${email}`, serviceRoleKey);
  const { data: lockSeconds, error: lockError } = await admin.rpc(
    "gpm_auth_login_lockout_seconds",
    { p_login_hash: loginHash },
  );
  if (lockError || typeof lockSeconds !== "number") {
    console.error("staff-pin-login: could not check the account lockout.", lockError);
    return respond(503, { error: "Staff PIN sign-in is temporarily unavailable." });
  }
  if (lockSeconds > 0) {
    return respond(
      429,
      {
        error: "Too many incorrect sign-in attempts.",
        locked: true,
        credential: "PIN",
        retry_after_seconds: lockSeconds,
      },
      { "Retry-After": String(lockSeconds) },
    );
  }

  const { data: userId, error: verifyError } = await admin.rpc("gpm_authenticate_staff_pin", {
    p_email: email,
    p_property_code: propertyCode,
    p_pin: pin,
  });
  if (verifyError) {
    console.error("staff-pin-login: PIN verification failed.", verifyError);
    return respond(500, { error: "Staff PIN sign-in is temporarily unavailable." });
  }
  if (typeof userId !== "string") {
    const { data: retryAfter, error: failureError } = await admin.rpc(
      "gpm_auth_record_login_failure",
      { p_login_hash: loginHash },
    );
    if (failureError || typeof retryAfter !== "number") {
      console.error("staff-pin-login: could not record the failed attempt.", failureError);
      return respond(503, { error: "Staff PIN sign-in is temporarily unavailable." });
    }
    if (retryAfter > 0) {
      return respond(
        429,
        {
          error: "Too many incorrect sign-in attempts.",
          locked: true,
          credential: "PIN",
          retry_after_seconds: retryAfter,
        },
        { "Retry-After": String(retryAfter) },
      );
    }
    return respond(401, { error: "Invalid staff email or PIN." });
  }

  const { error: resetError } = await admin.rpc("gpm_auth_reset_login_failures", {
    p_login_hash: loginHash,
  });
  if (resetError) {
    console.error("staff-pin-login: could not reset the account failure counter.", resetError);
    return respond(500, { error: "Staff PIN sign-in is temporarily unavailable." });
  }

  const { data: authUser, error: lookupError } = await admin.auth.admin.getUserById(userId);
  if (lookupError || !authUser.user?.email) {
    console.error("staff-pin-login: could not load the authenticated staff account.", lookupError);
    return respond(500, { error: "Staff PIN sign-in is temporarily unavailable." });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("staff-pin-login: could not create the one-time session.", linkError);
    return respond(500, { error: "Staff PIN sign-in is temporarily unavailable." });
  }

  return respond(200, { token_hash: tokenHash });
});
