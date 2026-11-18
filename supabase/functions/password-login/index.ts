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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord(input)) {
    return respond(400, { error: "The sign-in request is invalid." });
  }

  const email = typeof input["email"] === "string" ? input["email"].trim().toLowerCase() : "";
  const phone = typeof input["phone"] === "string" ? input["phone"].trim() : "";
  const password = typeof input["password"] === "string" ? input["password"] : "";
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validPhone = /^\+[1-9]\d{7,14}$/.test(phone);
  if ((!validEmail && !validPhone) || !password || password.length > 4096) {
    return respond(400, { error: "The sign-in request is invalid." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = request.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey || !apiKey) {
    console.error("password-login: Supabase service configuration is missing.");
    return respond(503, { error: "Password sign-in is temporarily unavailable." });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const loginHash = await hashLoginIdentifier(
    validEmail ? `email:${email}` : `phone:${phone}`,
    serviceRoleKey,
  );
  const { data: lockSeconds, error: lockError } = await admin.rpc(
    "gpm_auth_login_lockout_seconds",
    { p_login_hash: loginHash },
  );
  if (lockError || typeof lockSeconds !== "number") {
    console.error("password-login: could not check the account lockout.", lockError);
    return respond(503, { error: "Password sign-in is temporarily unavailable." });
  }
  if (lockSeconds > 0) {
    return respond(
      429,
      {
        error: "Too many incorrect password attempts.",
        locked: true,
        retry_after_seconds: lockSeconds,
      },
      { "Retry-After": String(lockSeconds) },
    );
  }

  let authResponse: Response;
  try {
    const authPayload = validEmail ? { email, password } : { phone, password };
    authResponse = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(authPayload),
    });
  } catch (error) {
    console.error("password-login: the Supabase Auth service could not be reached.", error);
    return respond(503, { error: "Password sign-in is temporarily unavailable." });
  }

  const authData: unknown = await authResponse.json().catch(() => undefined);
  if (authResponse.ok) {
    if (
      !isRecord(authData) ||
      typeof authData["access_token"] !== "string" ||
      typeof authData["refresh_token"] !== "string"
    ) {
      console.error("password-login: Supabase Auth returned an invalid session response.");
      return respond(503, { error: "Password sign-in is temporarily unavailable." });
    }

    const { error: resetError } = await admin.rpc("gpm_auth_reset_login_failures", {
      p_login_hash: loginHash,
    });
    if (resetError) {
      console.error("password-login: could not reset the account failure counter.", resetError);
      return respond(503, { error: "Password sign-in is temporarily unavailable." });
    }
    return respond(200, authData);
  }

  const authMessage = isRecord(authData)
    ? [authData["message"], authData["msg"], authData["error_description"]]
        .find((value) => typeof value === "string")
    : undefined;
  const authCode = isRecord(authData) ? authData["code"] : undefined;
  const invalidCredentials =
    authCode === "invalid_credentials" ||
    (typeof authMessage === "string" && /invalid login credentials/i.test(authMessage));

  if (invalidCredentials) {
    const { data: retryAfter, error: failureError } = await admin.rpc(
      "gpm_auth_record_login_failure",
      { p_login_hash: loginHash },
    );
    if (failureError || typeof retryAfter !== "number") {
      console.error("password-login: could not record the failed attempt.", failureError);
      return respond(503, { error: "Password sign-in is temporarily unavailable." });
    }
    if (retryAfter > 0) {
      return respond(
        429,
        {
          error: "Too many incorrect password attempts.",
          locked: true,
          retry_after_seconds: retryAfter,
        },
        { "Retry-After": String(retryAfter) },
      );
    }
    return respond(401, { error: "Invalid email or password." });
  }

  if (
    authResponse.status === 400 &&
    typeof authMessage === "string" &&
    /email not confirmed/i.test(authMessage)
  ) {
    return respond(400, { error: "Email not confirmed" });
  }
  if (authResponse.status === 429) {
    return respond(429, { error: "Too many sign-in requests. Please try again later." });
  }
  if (authResponse.status === 400) {
    return respond(401, { error: "Invalid email or password." });
  }

  console.error("password-login: Supabase Auth rejected the sign-in request.", authResponse.status);
  return respond(503, { error: "Password sign-in is temporarily unavailable." });
});
