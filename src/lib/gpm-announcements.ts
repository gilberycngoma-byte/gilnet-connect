import { supabase } from "@/integrations/supabase/client";

export interface GpmAnnouncement {
  id: string;
  message: string;
}

export interface GpmSubscriptionExpiryReminder {
  propertyCode: string;
  propertyName: string;
  planName: string;
  expiresOn: string;
  daysRemaining: number;
  message: string;
}

const tickerWindows = [8 * 60, 11 * 60, 14 * 60, 17 * 60, 20 * 60];

export function isGpmAnnouncementWindow(date: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lusaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;

  const currentMinute = hour * 60 + minute;
  return tickerWindows.some(
    (startMinute) => currentMinute >= startMinute && currentMinute < startMinute + 10,
  );
}

export async function fetchLatestGpmAnnouncement(): Promise<GpmAnnouncement | null> {
  const { data, error } = await supabase.functions.invoke<unknown>("gpm-announcements", {
    body: { action: "latest" },
  });
  if (error) {
    let message = error.message;
    if (error.context instanceof Response) {
      const body: unknown = await error.context
        .clone()
        .json()
        .catch(() => undefined);
      if (isRecord(body) && typeof body["error"] === "string") message = body["error"];
    }
    throw new Error(message);
  }
  if (!isRecord(data) || !(data["announcement"] === null || isAnnouncement(data["announcement"]))) {
    throw new Error("The GILNET server returned an invalid announcement response.");
  }
  return data["announcement"];
}

export async function fetchGpmSubscriptionExpiryReminder(): Promise<GpmSubscriptionExpiryReminder | null> {
  const { data, error } = await supabase.functions.invoke<unknown>("gpm-announcements", {
    body: { action: "subscription_reminder" },
  });
  if (error) {
    let message = error.message;
    if ("context" in error && error.context instanceof Response) {
      const body: unknown = await error.context
        .clone()
        .json()
        .catch(() => undefined);
      if (isRecord(body) && typeof body["error"] === "string") {
        message = body["error"];
      }
    }
    throw new Error(message);
  }
  return parseGpmSubscriptionExpiryReminderResponse(data);
}

export function parseGpmSubscriptionExpiryReminderResponse(
  value: unknown,
): GpmSubscriptionExpiryReminder | null {
  if (!isRecord(value) || !("reminder" in value)) {
    throw new Error("The subscription reminder service returned an invalid response.");
  }
  if (value["reminder"] === null) return null;
  const reminder = value["reminder"];
  if (
    !isRecord(reminder) ||
    typeof reminder["propertyCode"] !== "string" ||
    typeof reminder["propertyName"] !== "string" ||
    typeof reminder["planName"] !== "string" ||
    typeof reminder["expiresOn"] !== "string" ||
    typeof reminder["daysRemaining"] !== "number" ||
    !Number.isInteger(reminder["daysRemaining"]) ||
    reminder["daysRemaining"] < 0 ||
    reminder["daysRemaining"] > 7 ||
    typeof reminder["message"] !== "string"
  ) {
    throw new Error("The subscription reminder service returned invalid reminder data.");
  }
  return {
    propertyCode: reminder["propertyCode"],
    propertyName: reminder["propertyName"],
    planName: reminder["planName"],
    expiresOn: reminder["expiresOn"],
    daysRemaining: reminder["daysRemaining"],
    message: reminder["message"],
  };
}

function isAnnouncement(value: unknown): value is GpmAnnouncement {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["message"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
