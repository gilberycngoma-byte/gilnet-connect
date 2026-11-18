import { describe, expect, it } from "vitest";
import { isMissingStaffMembersTable, recipientsFromProfiles } from "@/lib/staffRecipients";

describe("staff recipient fallback", () => {
  it("uses the profile directory only when staff_members is missing", () => {
    expect(isMissingStaffMembersTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingStaffMembersTable({ code: "42501" })).toBe(false);
  });

  it("excludes the current user and profiles without a property role", () => {
    expect(
      recipientsFromProfiles(
        [
          { id: "current", name: "Current User" },
          { id: "staff-b", name: "  Ben  " },
          { id: "unassigned", name: "Unassigned" },
          { id: "staff-a", name: "" },
        ],
        [{ user_id: "current" }, { user_id: "staff-a" }, { user_id: "staff-b" }],
        "current",
      ),
    ).toEqual([
      { id: "staff-b", name: "Ben", department: "" },
      { id: "staff-a", name: "Staff member", department: "" },
    ]);
  });
});
