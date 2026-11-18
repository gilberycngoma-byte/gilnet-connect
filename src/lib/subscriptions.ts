import type { SupabaseClient } from "@supabase/supabase-js";

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: "ZMW";
  billing_interval: "monthly" | "quarterly" | "yearly";
  description: string;
  features: string[];
  recommended: boolean;
}

export interface PropertySubscriptionData {
  property: { code: string; name: string; billingEmail: string | null };
  plans: SubscriptionPlan[];
  subscription: { plan_id: string; status: string; selected_at: string } | null;
}

export async function fetchPropertySubscription(
  client: SupabaseClient,
): Promise<PropertySubscriptionData> {
  const { data, error } = await client.functions.invoke<unknown>("gpm-property-subscriptions", {
    body: { action: "list" },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!isPropertySubscriptionData(data)) {
    throw new Error("The subscription service returned an invalid response.");
  }
  return data;
}

export async function selectPropertySubscriptionPlan(
  client: SupabaseClient,
  planId: string,
): Promise<void> {
  const { data, error } = await client.functions.invoke<unknown>("gpm-property-subscriptions", {
    body: { action: "select", planId },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!isRecord(data) || data["ok"] !== true || data["status"] !== "pending_payment") {
    throw new Error("The property plan selection could not be confirmed.");
  }
}

async function getFunctionErrorMessage(error: { message: string } & object): Promise<string> {
  if ("context" in error && error.context instanceof Response) {
    const body: unknown = await error.context
      .clone()
      .json()
      .catch(() => undefined);
    if (
      isRecord(body) &&
      typeof body["error"] === "string"
    ) {
      return body["error"];
    }
  }
  return error.message;
}

function isPropertySubscriptionData(value: unknown): value is PropertySubscriptionData {
  return (
    isRecord(value) &&
    isRecord(value["property"]) &&
    typeof value["property"]["code"] === "string" &&
    typeof value["property"]["name"] === "string" &&
    (typeof value["property"]["billingEmail"] === "string" ||
      value["property"]["billingEmail"] === null) &&
    Array.isArray(value["plans"]) &&
    value["plans"].every(isSubscriptionPlan) &&
    (value["subscription"] === null || isSubscription(value["subscription"]))
  );
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["price"] === "number" &&
    value["currency"] === "ZMW" &&
    (value["billing_interval"] === "monthly" ||
      value["billing_interval"] === "quarterly" ||
      value["billing_interval"] === "yearly") &&
    typeof value["description"] === "string" &&
    Array.isArray(value["features"]) &&
    value["features"].every((feature) => typeof feature === "string") &&
    typeof value["recommended"] === "boolean"
  );
}

function isSubscription(value: unknown): value is NonNullable<PropertySubscriptionData["subscription"]> {
  return (
    isRecord(value) &&
    typeof value["plan_id"] === "string" &&
    typeof value["status"] === "string" &&
    typeof value["selected_at"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
