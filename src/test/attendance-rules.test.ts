import { describe, expect, it } from "vitest";
import {
  attendanceState,
  defaultDepartmentForRole,
  ipMatches,
  isOnCompanyNetwork,
  isLate,
  lateMinutes,
  lusakaParts,
  workedHours,
} from "@/lib/attendance-rules";

describe("attendance rules", () => {
  it("uses Lusaka local date and time independent of device timezone", () => {
    expect(lusakaParts("2026-11-14T05:05:00Z")).toEqual({
      date: "2026-11-14",
      minutes: 425,
    });
  });

  it("applies the reporting-time grace period and calculates minutes late", () => {
    expect(isLate("2026-11-14T05:05:00Z", "07:00", 10)).toBe(false);
    expect(isLate("2026-11-14T05:12:00Z", "07:00", 10)).toBe(true);
    expect(lateMinutes("2026-11-14T05:12:00Z", "07:00")).toBe(12);
  });

  it("reports worked hours only after a check-out", () => {
    expect(workedHours("2026-11-14T04:00:00Z", "2026-11-14T12:30:00Z")).toBe(8.5);
    expect(workedHours("2026-11-14T04:00:00Z", null)).toBe(0);
  });

  it("distinguishes checked-in, checked-out and not-yet-reported staff", () => {
    expect(attendanceState({ check_in: null, check_out: null })).toBe("Not Checked In");
    expect(attendanceState({ check_in: "2026-11-14T04:00:00Z", check_out: null })).toBe(
      "Checked In",
    );
    expect(
      attendanceState({
        check_in: "2026-11-14T04:00:00Z",
        check_out: "2026-11-14T12:00:00Z",
      }),
    ).toBe("Checked Out");
  });

  it("maps roles to a reporting department when no department is assigned", () => {
    expect(defaultDepartmentForRole("Restaurant")).toBe("Food and Beverage");
    expect(defaultDepartmentForRole("Housekeeping")).toBe("Housekeeping");
    expect(defaultDepartmentForRole("Manager")).toBe("Admin");
  });

  it("matches IPv4 exactly and allows phones within the office IPv6 /64", () => {
    expect(ipMatches("41.72.100.5", "41.72.100.5")).toBe(true);
    expect(ipMatches("41.72.100.6", "41.72.100.5")).toBe(false);
    expect(ipMatches("2c0f:fe38:2101:1::abcd", "2c0f:fe38:2101:1:1111:2222:3333:4444")).toBe(true);
    expect(isOnCompanyNetwork(null, ["41.72.100.5"])).toBe(false);
  });
});
