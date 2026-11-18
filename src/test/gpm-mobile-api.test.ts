import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession }, functions: { invoke } },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

import { invokeGpmMobileApi } from "@/lib/gpmMobileApi";
import {
  attendanceBoard,
  checkIn,
  checkOut,
  deleteWorkShift,
  listWorkShifts,
  saveWorkShift,
} from "@/lib/attendance.functions";
import { manageStaff } from "@/lib/staff.functions";

beforeEach(() => {
  invoke.mockReset();
  getSession.mockReset().mockResolvedValue({
    data: { session: { access_token: "test-access-token" } },
    error: null,
  });
});

describe("GILNET mobile API errors", () => {
  it("surfaces the Supabase gateway message when the Edge Function is unavailable", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ code: "NOT_FOUND", message: "Function not found" }),
          {
            status: 404,
          },
        ),
      },
    });

    await expect(invokeGpmMobileApi({ action: "list_private_messages" })).rejects.toThrow(
      "Function not found",
    );
  });

  it("routes native attendance operations through the authenticated Edge Function", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const boardInput = { date: "2026-11-16", department: "Maintenance" };
    const shiftInput = {
      date: "2026-11-16",
      department: "Maintenance" as const,
      shift_pattern: "Morning and Night" as const,
      reporting_time: "07:00",
      grace_minutes: 10,
    };

    await attendanceBoard({ data: boardInput });
    await checkIn();
    await checkOut();
    await listWorkShifts({ data: { date: boardInput.date } });
    await saveWorkShift({ data: shiftInput });
    await deleteWorkShift({ data: { id: "00000000-0000-4000-8000-000000000001" } });

    expect(invoke.mock.calls.map(([, options]) => options.body.action)).toEqual([
      "attendance_board",
      "attendance_check_in",
      "attendance_check_out",
      "list_work_shifts",
      "save_work_shift",
      "delete_work_shift",
    ]);
    expect(invoke).toHaveBeenCalledWith("gpm-mobile-api", {
      body: { action: "save_work_shift", data: shiftInput },
      headers: { Authorization: "Bearer test-access-token" },
    });
  });

  it("uses the authenticated Edge Function for browser staff management", async () => {
    const data = {
      action: "create" as const,
      name: "Amina Banda",
      email: "staff@company.example",
      role: "Maintenance" as const,
    };
    invoke.mockResolvedValue({ data: [], error: null });

    await expect(manageStaff({ data })).resolves.toEqual([]);

    expect(invoke).toHaveBeenCalledWith("gpm-mobile-api", {
      body: { action: "manage_staff", data },
      headers: { Authorization: "Bearer test-access-token" },
    });
  });

  it("requires a signed-in Supabase session before invoking the Edge Function", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(invokeGpmMobileApi({ action: "list_private_messages" })).rejects.toThrow(
      "Please sign in again to continue.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
