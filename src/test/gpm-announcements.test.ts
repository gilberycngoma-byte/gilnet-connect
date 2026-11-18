import { describe, expect, it } from "vitest";
import { isGpmAnnouncementWindow } from "@/lib/gpm-announcements";

describe("GILNET Connect announcement ticker schedule", () => {
  it("runs at five scheduled Lusaka times for ten minutes each", () => {
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T06:00:00.000Z"))).toBe(true);
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T06:09:59.000Z"))).toBe(true);
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T06:10:00.000Z"))).toBe(false);
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T09:00:00.000Z"))).toBe(true);
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T18:00:00.000Z"))).toBe(true);
    expect(isGpmAnnouncementWindow(new Date("2026-11-16T06:30:00.000Z"))).toBe(false);
  });
});
