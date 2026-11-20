import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.2.2";
import { hashLoginIdentifier } from "../_shared/auth-lockout.ts";

type PasskeyContext = { origin: string; rpId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw Object.assign(new Error(`The ${label} is invalid.`), { status: 400 });
  }
  return value.trim();
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function getPasskeyContext(request: Request): PasskeyContext | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.username || url.password) return null;

  const isLocalOrigin =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname.toLowerCase() === "localhost";
  const allowedOrigins = (Deno.env.get("WEBAUTHN_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!isLocalOrigin && (url.protocol !== "https:" || !allowedOrigins.includes(origin))) {
    return null;
  }

  const configuredRpId = Deno.env.get("WEBAUTHN_RP_ID")?.trim().toLowerCase();
  const rpId = isLocalOrigin ? "localhost" : configuredRpId || url.hostname.toLowerCase();
  if (
    !isLocalOrigin &&
    url.hostname.toLowerCase() !== rpId &&
    !url.hostname.toLowerCase().endsWith(`.${rpId}`)
  ) {
    return null;
  }
  return { origin, rpId };
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function response(status: number, body: unknown, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      Vary: "Origin",
    },
  });
}

Deno.serve(async (request) => {
  const context = getPasskeyContext(request);
  if (!context) {
    return new Response("Passkey requests must come from an approved secure origin.", {
      status: 403,
    });
  }
  if (request.method === "OPTIONS") {
    return response(200, { ok: true }, context.origin);
  }
  if (request.method !== "POST") {
    return response(405, { error: "Method not allowed." }, context.origin);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) {
      console.error("gpm-passkeys: Supabase service configuration is missing.");
      fail(503, "Passkey sign-in is temporarily unavailable.");
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      fail(400, "The passkey request is invalid.");
    }
    if (!isRecord(input)) fail(400, "The passkey request is invalid.");

    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const recordFailedPasskeyAttempt = async (loginHash: string) => {
      const { data: retryAfter, error } = await admin.rpc("gpm_auth_record_login_failure", {
        p_login_hash: loginHash,
      });
      if (error || typeof retryAfter !== "number") {
        console.error("gpm-passkeys: failed attempt could not be recorded.", error);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      if (retryAfter > 0) fail(429, "Passkey sign-in is temporarily locked. Try again later.");
    };
    const action = requiredString(input["action"], "passkey action", 40);
    const cleanup = await admin
      .from("gpm_passkey_challenges")
      .delete()
      .lt("expires_at", new Date().toISOString());
    if (cleanup.error) {
      console.error("gpm-passkeys: expired challenges could not be removed.", cleanup.error);
      fail(503, "Passkey sign-in is temporarily unavailable.");
    }

    const requireSignedInUser = async () => {
      const authorization = request.headers.get("authorization") ?? "";
      const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!accessToken) fail(401, "Sign in with your password before setting up a passkey.");
      const { data, error } = await admin.auth.getUser(accessToken);
      if (error || !data.user) fail(401, "Your session has expired. Sign in again.");
      const { data: role, error: roleError } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleError || !role) fail(403, "This account is not assigned to a property.");
      return data.user;
    };

    const saveChallenge = async (
      purpose: "registration" | "authentication",
      challenge: string,
      userId: string | null,
    ) => {
      const { data, error } = await admin
        .from("gpm_passkey_challenges")
        .insert({
          purpose,
          challenge,
          user_id: userId,
          rp_id: context.rpId,
          origin: context.origin,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("gpm-passkeys: challenge could not be saved.", error);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      return data.id;
    };

    const consumeChallenge = async (
      challengeId: string,
      purpose: "registration" | "authentication",
      userId?: string,
    ) => {
      const query = admin
        .from("gpm_passkey_challenges")
        .delete()
        .eq("id", challengeId)
        .eq("purpose", purpose)
        .gt("expires_at", new Date().toISOString());
      const { data, error } = await (userId ? query.eq("user_id", userId) : query)
        .select("challenge, rp_id, origin")
        .maybeSingle();
      if (error) {
        console.error("gpm-passkeys: challenge could not be consumed.", error);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      if (!data || data.origin !== context.origin || data.rp_id !== context.rpId) {
        fail(400, "This passkey request expired. Please try again.");
      }
      return data;
    };

    if (action === "list") {
      const user = await requireSignedInUser();
      const { data, error } = await admin
        .from("gpm_passkey_credentials")
        .select("id, device_name, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("gpm-passkeys: credentials could not be listed.", error);
        fail(503, "Passkeys could not be loaded.");
      }
      return response(200, { credentials: data ?? [] }, context.origin);
    }

    if (action === "register-options") {
      const user = await requireSignedInUser();
      if (!user.email) fail(400, "This account needs an email address before adding a passkey.");
      const { data: existing, error } = await admin
        .from("gpm_passkey_credentials")
        .select("credential_id, transports")
        .eq("user_id", user.id);
      if (error) {
        console.error("gpm-passkeys: existing credentials could not be loaded.", error);
        fail(503, "Passkey setup is temporarily unavailable.");
      }
      const { data: profile } = await admin
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();
      const options = await generateRegistrationOptions({
        rpName: Deno.env.get("WEBAUTHN_RP_NAME") ?? "GILNET GPM CONNECT",
        rpID: context.rpId,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        userDisplayName: profile?.name || user.email,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        excludeCredentials: (existing ?? []).map((credential) => ({
          id: credential.credential_id,
          transports: credential.transports,
        })),
      });
      const challengeId = await saveChallenge("registration", options.challenge, user.id);
      return response(200, { challenge_id: challengeId, options }, context.origin);
    }

    if (action === "register-finish") {
      const user = await requireSignedInUser();
      const challengeId = requiredString(input["challenge_id"], "challenge ID", 64);
      const deviceName = requiredString(input["device_name"], "passkey name", 64);
      if (!isRecord(input["response"])) fail(400, "The passkey response is invalid.");
      const challenge = await consumeChallenge(challengeId, "registration", user.id);
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verifyRegistrationResponse({
          response: input["response"] as Parameters<
            typeof verifyRegistrationResponse
          >[0]["response"],
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rp_id,
          requireUserVerification: true,
        });
      } catch (error) {
        console.warn("gpm-passkeys: registration response was rejected.", error);
        fail(400, "The passkey could not be verified. Please try again.");
      }
      if (!verification.verified || !verification.registrationInfo) {
        fail(400, "The passkey could not be verified. Please try again.");
      }

      const credential = verification.registrationInfo.credential;
      const { error } = await admin.from("gpm_passkey_credentials").insert({
        user_id: user.id,
        credential_id: credential.id,
        public_key: bytesToBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        device_name: deviceName,
      });
      if (error) {
        if (error.code === "23505") {
          fail(409, "This passkey is already registered to an account.");
        }
        console.error("gpm-passkeys: verified credential could not be saved.", error);
        fail(503, "Passkey setup could not be completed.");
      }
      return response(200, { ok: true }, context.origin);
    }

    if (action === "authentication-options") {
      const options = await generateAuthenticationOptions({
        rpID: context.rpId,
        userVerification: "required",
      });
      const challengeId = await saveChallenge("authentication", options.challenge, null);
      return response(200, { challenge_id: challengeId, options }, context.origin);
    }

    if (action === "authentication-finish") {
      const challengeId = requiredString(input["challenge_id"], "challenge ID", 64);
      if (!isRecord(input["response"]) || typeof input["response"]["id"] !== "string") {
        fail(400, "The passkey response is invalid.");
      }
      const passkeyResponse = input["response"] as Parameters<
        typeof verifyAuthenticationResponse
      >[0]["response"];
      const challenge = await consumeChallenge(challengeId, "authentication");
      const loginHash = await hashLoginIdentifier(`passkey:${passkeyResponse.id}`, serviceRoleKey);
      const { data: lockSeconds, error: lockError } = await admin.rpc(
        "gpm_auth_login_lockout_seconds",
        { p_login_hash: loginHash },
      );
      if (lockError || typeof lockSeconds !== "number") {
        console.error("gpm-passkeys: account lockout could not be checked.", lockError);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      if (lockSeconds > 0) fail(429, "Passkey sign-in is temporarily locked. Try again later.");

      const { data: credential, error: credentialError } = await admin
        .from("gpm_passkey_credentials")
        .select("id, user_id, credential_id, public_key, counter, transports")
        .eq("credential_id", passkeyResponse.id)
        .maybeSingle();
      if (credentialError) {
        console.error("gpm-passkeys: matching credential could not be loaded.", credentialError);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      if (!credential) {
        await recordFailedPasskeyAttempt(loginHash);
        fail(401, "No matching passkey was found. Sign in with your email and password.");
      }

      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verifyAuthenticationResponse({
          response: passkeyResponse,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rp_id,
          credential: {
            id: credential.credential_id,
            publicKey: base64UrlToBytes(credential.public_key),
            counter: Number(credential.counter),
            transports: credential.transports,
          },
          requireUserVerification: true,
        });
      } catch (error) {
        console.warn("gpm-passkeys: authentication response was rejected.", error);
        await recordFailedPasskeyAttempt(loginHash);
        fail(401, "The passkey could not be verified. Try again or sign in with your password.");
      }
      if (!verification.verified) {
        await recordFailedPasskeyAttempt(loginHash);
        fail(401, "The passkey could not be verified. Try again or sign in with your password.");
      }

      const { error: counterError } = await admin
        .from("gpm_passkey_credentials")
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq("id", credential.id);
      if (counterError) {
        console.error("gpm-passkeys: authenticator counter could not be updated.", counterError);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      const { error: resetError } = await admin.rpc("gpm_auth_reset_login_failures", {
        p_login_hash: loginHash,
      });
      if (resetError) {
        console.error(
          "gpm-passkeys: successful sign-in could not reset the failure counter.",
          resetError,
        );
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }

      const { data: authUser, error: userError } = await admin.auth.admin.getUserById(
        credential.user_id,
      );
      if (userError || !authUser.user?.email) {
        console.error("gpm-passkeys: credential owner could not be loaded.", userError);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: authUser.user.email,
      });
      const tokenHash = link?.properties?.hashed_token;
      if (linkError || !tokenHash) {
        console.error("gpm-passkeys: one-time session could not be created.", linkError);
        fail(503, "Passkey sign-in is temporarily unavailable.");
      }
      return response(200, { token_hash: tokenHash }, context.origin);
    }

    if (action === "remove") {
      const user = await requireSignedInUser();
      const id = requiredString(input["id"], "passkey ID", 64);
      const { error } = await admin
        .from("gpm_passkey_credentials")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) {
        console.error("gpm-passkeys: credential could not be removed.", error);
        fail(503, "Passkey could not be removed.");
      }
      return response(200, { ok: true }, context.origin);
    }

    fail(400, "The passkey action is not supported.");
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    if (status === 500) console.error("gpm-passkeys: request failed.", error);
    const message =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      error instanceof Error
        ? error.message
        : "Passkey request could not be completed.";
    return response(status, { error: message }, context.origin);
  }
});
