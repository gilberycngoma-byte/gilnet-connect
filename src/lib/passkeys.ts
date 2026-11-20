import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { supabase } from "@/integrations/supabase/client";

type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export type PasskeyCredential = {
  id: string;
  device_name: string;
  created_at: string;
};

async function invokePasskeys<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("gpm-passkeys", { body });
  if (error) {
    if (error.context instanceof Response) {
      let payload: unknown;
      try {
        payload = await error.context.clone().json();
      } catch {
        payload = undefined;
      }
      if (
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload) &&
        "error" in payload &&
        typeof payload.error === "string"
      ) {
        throw new Error(payload.error);
      }
    }
    throw error;
  }
  if (!data) throw new Error("The passkey service returned an empty response.");
  return data;
}

function isRequestCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  );
}

export function canUsePasskeys(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "PublicKeyCredential" in window &&
    !!navigator.credentials
  );
}

export async function listPasskeys(): Promise<PasskeyCredential[]> {
  const result = await invokePasskeys<{ credentials: PasskeyCredential[] }>({ action: "list" });
  if (!Array.isArray(result.credentials)) {
    throw new Error("The passkey service returned an invalid credential list.");
  }
  return result.credentials;
}

export async function registerPasskey(deviceName: string): Promise<void> {
  if (!canUsePasskeys()) {
    throw new Error("This device or browser does not support passkeys on this connection.");
  }
  const name = deviceName.trim();
  if (!name || name.length > 64) throw new Error("Enter a passkey name of 1 to 64 characters.");

  const setup = await invokePasskeys<{
    challenge_id: string;
    options: RegistrationOptionsJSON;
  }>({ action: "register-options" });
  let credential: Awaited<ReturnType<typeof startRegistration>>;
  try {
    credential = await startRegistration({ optionsJSON: setup.options });
  } catch (error) {
    if (isRequestCancelled(error)) throw new Error("Passkey setup was canceled or timed out.");
    throw error;
  }
  await invokePasskeys({
    action: "register-finish",
    challenge_id: setup.challenge_id,
    device_name: name,
    response: credential,
  });
}

export async function removePasskey(id: string): Promise<void> {
  await invokePasskeys({ action: "remove", id });
}

export async function authenticateWithPasskey(): Promise<string> {
  if (!canUsePasskeys()) {
    throw new Error("This device or browser does not support passkeys on this connection.");
  }
  const setup = await invokePasskeys<{
    challenge_id: string;
    options: AuthenticationOptionsJSON;
  }>({ action: "authentication-options" });
  let assertion: Awaited<ReturnType<typeof startAuthentication>>;
  try {
    assertion = await startAuthentication({ optionsJSON: setup.options });
  } catch (error) {
    if (isRequestCancelled(error)) throw new Error("Passkey sign-in was canceled or timed out.");
    throw error;
  }
  const result = await invokePasskeys<{ token_hash: string }>({
    action: "authentication-finish",
    challenge_id: setup.challenge_id,
    response: assertion,
  });
  if (typeof result.token_hash !== "string" || !result.token_hash) {
    throw new Error("The passkey service did not return a sign-in token.");
  }
  return result.token_hash;
}
