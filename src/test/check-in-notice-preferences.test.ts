import { afterEach, describe, expect, it } from "vitest";
import { visibleNoticesFor } from "@/components/gpm/notices";
import {
  getAppPreferences,
  getDefaultAppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import { countUnreadNotices } from "@/lib/notice-visibility";
import type { Notice } from "@/lib/types";

const notices: Notice[] = [
  {
    id: "check-in",
    number: 1,
    property_code: "HOTEL1",
    title: "Guest check-in",
    message: "A guest checked in.",
    type: "Info",
    to_department: "All Staff",
    from_user: "Front Desk",
    from_department: "Front Desk",
    priority: "Low",
    is_pinned: false,
    is_completed: false,
    completed_by: null,
    completed_photo: null,
    audio_url: null,
    photo: null,
    expiry_date: null,
    seen_by: [],
    created_at: "2026-11-16T12:00:00.000Z",
    is_check_in_notice: true,
  },
  {
    id: "general",
    number: 2,
    property_code: "HOTEL1",
    title: "General update",
    message: "A general update.",
    type: "Info",
    to_department: "All Staff",
    from_user: "Manager",
    from_department: "Management",
    priority: "Low",
    is_pinned: false,
    is_completed: false,
    completed_by: null,
    completed_photo: null,
    audio_url: null,
    photo: null,
    expiry_date: null,
    seen_by: [],
    created_at: "2026-11-16T12:00:00.000Z",
  },
];

afterEach(() => {
  localStorage.clear();
});

describe("check-in notice preferences", () => {
  it("defaults reception and management roles on, and other roles off", () => {
    for (const role of ["Front Desk", "Admin", "Manager", "Supervisor"] as const) {
      expect(getDefaultAppPreferences(role).checkInNotices).toBe(true);
    }
    for (const role of ["Housekeeping", "Maintenance", "Restaurant"] as const) {
      expect(getDefaultAppPreferences(role).checkInNotices).toBe(false);
    }
  });

  it("hides check-in notices unless a staff member opts in", () => {
    expect(visibleNoticesFor(notices, "Housekeeping", false).map((notice) => notice.id)).toEqual([
      "general",
    ]);
    expect(visibleNoticesFor(notices, "Housekeeping", true).map((notice) => notice.id)).toEqual([
      "check-in",
      "general",
    ]);
  });

  it("counts only visible, incomplete notices the current staff member has not seen", () => {
    const seenNotice = { ...notices[1], seen_by: ["staff@example.com"] };
    expect(
      countUnreadNotices([notices[0], seenNotice], "Housekeeping", false, "staff@example.com"),
    ).toBe(0);
    expect(countUnreadNotices(notices, "Housekeeping", true, "staff@example.com")).toBe(2);
  });

  it("enables floating bubbles by default and stores each staff member's choice", () => {
    expect(getDefaultAppPreferences("Admin")).toMatchObject({
      floatingAttendanceBubble: true,
      floatingMessagesBubble: true,
      floatingNoticesBubble: true,
    });

    updateAppPreferences("HOTEL1", "staff-1", { floatingMessagesBubble: false }, "Admin");

    expect(getAppPreferences("HOTEL1", "staff-1", "Admin")).toMatchObject({
      floatingAttendanceBubble: true,
      floatingMessagesBubble: false,
      floatingNoticesBubble: true,
    });
  });
});
