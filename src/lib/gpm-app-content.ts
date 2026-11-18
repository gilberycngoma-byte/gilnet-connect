export interface GpmAppContent {
  about_text: string;
  agreement_text: string;
  agreement_effective_date: string;
  agreement_revision: number;
}

export async function fetchGpmAppContent(): Promise<GpmAppContent | null> {
  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) {
    throw new Error("GPM Connect content cannot load without its Supabase configuration.");
  }

  const endpoint = new URL("rest/v1/gpm_app_content", `${supabaseUrl.replace(/\/+$/, "")}/`);
  endpoint.searchParams.set(
    "select",
    "about_text,agreement_text,agreement_effective_date,agreement_revision",
  );
  endpoint.searchParams.set("id", "eq.1");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`GPM Connect content could not be loaded (HTTP ${response.status}).`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body) || body.length > 1) {
    throw new Error("GPM Connect returned an invalid content response.");
  }
  if (body.length === 0) return null;

  const content = body[0];
  if (
    !isRecord(content) ||
    typeof content["about_text"] !== "string" ||
    typeof content["agreement_text"] !== "string" ||
    typeof content["agreement_effective_date"] !== "string" ||
    typeof content["agreement_revision"] !== "number" ||
    !Number.isSafeInteger(content["agreement_revision"]) ||
    content["agreement_revision"] < 1
  ) {
    throw new Error("GPM Connect returned invalid app content.");
  }

  return {
    about_text: content["about_text"],
    agreement_text: content["agreement_text"],
    agreement_effective_date: content["agreement_effective_date"],
    agreement_revision: content["agreement_revision"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
