import { describe, expect, it } from "vitest";
import { daysUntilLusakaDate } from "../../supabase/functions/_shared/subscription-expiry";
import { parseGpmSubscriptionExpiryReminderResponse } from "@/lib/gpm-announcements";

describe("subscription reminder date window", () => {
  it("uses the current calendar date in Africa/Lusaka", () => {
    expect(daysUntilLusakaDate("2026-11-17", new Date("2026-11-16T21:59:59.000Z"))).toBe(1);
    expect(daysUntilLusakaDate("2026-11-17", new Date("2026-11-16T22:00:00.000Z"))).toBe(0);
  });

  it("returns negative and out-of-range day counts for expired and distant dates", () => {
    expect(daysUntilLusakaDate("2026-11-16", new Date("2026-11-16T10:00:00.000Z"))).toBe(0);
    expect(daysUntilLusakaDate("2026-11-16", new Date("2026-11-17T10:00:00.000Z"))).toBe(-1);
    expect(daysUntilLusakaDate("2026-11-25", new Date("2026-11-16T10:00:00.000Z"))).toBe(9);
  });

  it("rejects malformed expiry dates", () => {
    expect(Number.isNaN(daysUntilLusakaDate("not-a-date", new Date()))).toBe(true);
  });

  it("accepts only a valid targeted reminder or null", () => {
    const reminder = {
      propertyCode: "LUS001",
      propertyName: "Example Lodge",
      planName: "Professional",
      expiresOn: "2026-11-17",
      daysRemaining: 1,
      message: "Your subscription ends tomorrow.",
    };

    expect(parseGpmSubscriptionExpiryReminderResponse({ reminder })).toEqual(reminder);
    expect(parseGpmSubscriptionExpiryReminderResponse({ reminder: null })).toBeNull();
    expect(() =>
      parseGpmSubscriptionExpiryReminderResponse({
        reminder: { ...reminder, daysRemaining: 12 },
      }),
    ).toThrow("The subscription reminder service returned invalid reminder data.");
  });
});
