import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { getElectronBridge } from "./electron";

type GpmMobileAction = {
  action: string;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function usesGpmMobileApi() {
  return Capacitor.isNativePlatform() || Boolean(getElectronBridge());
}

export async function invokeGpmMobileApi<T>(body: GpmMobileAction): Promise<T> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session?.access_token) throw new Error("Please sign in again to continue.");

  const { data, error } = await supabase.functions.invoke("gpm-mobile-api", {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let message = error.message;
    const context: unknown = error.context;
    if (typeof Response !== "undefined" && context instanceof Response) {
      try {
        const detail: unknown = await context.clone().json();
        if (isRecord(detail)) {
          if (typeof detail["error"] === "string") {
            message = detail["error"];
          } else if (typeof detail["message"] === "string") {
            message = detail["message"];
          }
        }
      } catch {
        // Keep the Functions SDK error when the response is not JSON.
      }
    }
    throw new Error(message);
  }
  if (data === null) throw new Error("The GILNET server returned an empty response.");
  return data as T;
}
