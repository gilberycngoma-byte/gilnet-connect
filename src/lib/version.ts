import { supabase } from "@/integrations/supabase/client";

export const APP_NAME = "GILNET GPM CONNECT - Property Management System";
export const APP_VERSION = "2.5.8";
export const BUILD_DATE = "2026-11-20";
export const MIN_SUPPORTED_VERSION = "2.0.0";
export const SUPPORT_EMAIL = "support.gilnet.property.manager@gmail.com";

export type VersionInfo = {
  latestStable: string;
  releaseNotes: string;
  forced: boolean;
  apkUrl?: string;
  publicUrl?: string;
  fileName?: string;
};

/** Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function fetchLatestVersion(): Promise<VersionInfo | null> {
  try {
    const { data, error } = await supabase
      .from("app_versions")
      .select("version, release_notes, forced, public_url, apk_url, file_name")
      .eq("is_latest", true)
      .maybeSingle();
    if (error) {
      console.error("Could not check Supabase app versions.", error);
      return null;
    }
    if (
      !data ||
      !/^\d+\.\d+\.\d+$/.test(data.version) ||
      typeof data.release_notes !== "string" ||
      typeof data.forced !== "boolean"
    ) {
      console.error("Supabase has no valid latest app version.");
      return null;
    }
    return {
      latestStable: data.version,
      releaseNotes: data.release_notes,
      forced: data.forced,
      ...(data.apk_url ? { apkUrl: data.apk_url } : {}),
      ...(data.public_url ? { publicUrl: data.public_url } : {}),
      ...(data.file_name ? { fileName: data.file_name } : {}),
    };
  } catch (error) {
    console.error("Could not check Supabase app versions.", error);
    return null;
  }
}
