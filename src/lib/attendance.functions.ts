import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { invokeGpmMobileApi, usesGpmMobileApi } from "@/lib/gpmMobileApi";
import { STAFF_DEPARTMENTS } from "./types";
import { defaultDepartmentForRole, lusakaParts } from "./attendance-rules";
import { z } from "zod";

export const ATTENDANCE_SHIFT_PATTERNS = ["Morning and Night", "Morning and Afternoon"] as const;
export type AttendanceShiftPattern = (typeof ATTENDANCE_SHIFT_PATTERNS)[number];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid reporting time.");
const MANAGERS = ["Admin", "Manager", "Supervisor"];

async function getCaller(
  supabase: typeof import("@/integrations/supabase/client").supabase,
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("property_code, role")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

export type AttendanceRow = {
  id: string;
  user_id: string;
  staff_name: string;
  department: string;
  shift_date: string;
  check_in: string;
  check_out: string | null;
  reporting_time: string;
  grace_minutes: number;
  is_late: boolean;
  late_minutes: number;
};

export type AttendanceRosterMember = {
  id: string;
  name: string;
  department: string;
  role: string;
};

export type WorkShift = {
  id: string;
  shift_date: string;
  department: string;
  shift_pattern: AttendanceShiftPattern;
  reporting_time: string;
  grace_minutes: number;
};

export type AttendanceBoard = {
  date: string;
  rows: AttendanceRow[];
  roster: AttendanceRosterMember[];
  shifts: WorkShift[];
  canManage: boolean;
};

const attendanceSelect =
  "id, user_id, staff_name, department, shift_date, check_in, check_out, reporting_time, grace_minutes, is_late, late_minutes";
const shiftSelect = "id, shift_date, department, shift_pattern, reporting_time, grace_minutes";

const attendanceBoardServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ date: DATE, department: z.string().optional() }).parse(input))
  .handler(async ({ data, context }): Promise<AttendanceBoard> => {
    const caller = await getCaller(context.supabase, context.userId);
    const canManage = MANAGERS.includes(caller.role);
    let rowsQuery = context.supabase
      .from("staff_attendance")
      .select(attendanceSelect)
      .eq("property_code", caller.property_code)
      .eq("shift_date", data.date)
      .order("check_in");
    if (!canManage) rowsQuery = rowsQuery.eq("user_id", context.userId);
    if (canManage && data.department) rowsQuery = rowsQuery.eq("department", data.department);

    const shiftsQuery = context.supabase
      .from("work_shifts")
      .select(shiftSelect)
      .eq("property_code", caller.property_code)
      .eq("shift_date", data.date)
      .order("department");
    const [attendance, shifts] = await Promise.all([rowsQuery, shiftsQuery]);
    if (attendance.error) throw attendance.error;
    if (shifts.error) throw shifts.error;

    const [profiles, roles, staff] = canManage
      ? await Promise.all([
          context.supabase
            .from("profiles")
            .select("id, name")
            .eq("property_code", caller.property_code)
            .order("name"),
          context.supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("property_code", caller.property_code),
          context.supabase
            .from("staff_members")
            .select("auth_user_id, department")
            .eq("property_code", caller.property_code)
            .eq("active", true),
        ])
      : await Promise.all([
          context.supabase
            .from("profiles")
            .select("id, name")
            .eq("id", context.userId)
            .eq("property_code", caller.property_code),
          context.supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("user_id", context.userId)
            .eq("property_code", caller.property_code),
          context.supabase
            .from("staff_members")
            .select("auth_user_id, department")
            .eq("auth_user_id", context.userId)
            .eq("property_code", caller.property_code)
            .eq("active", true),
        ]);
    if (profiles.error) throw profiles.error;
    if (roles.error) throw roles.error;
    if (staff.error) throw staff.error;

    const roleById = new Map(roles.data.map((row) => [row.user_id, row.role]));
    const departmentById = new Map(staff.data.map((row) => [row.auth_user_id, row.department]));
    const roster = profiles.data.map((profile) => {
      const role = roleById.get(profile.id) ?? "Front Desk";
      return {
        id: profile.id,
        name: profile.name,
        role,
        department: departmentById.get(profile.id) ?? defaultDepartmentForRole(role),
      };
    });

    return {
      date: data.date,
      rows: attendance.data as AttendanceRow[],
      roster: canManage
        ? data.department
          ? roster.filter((member) => member.department === data.department)
          : roster
        : roster,
      shifts: shifts.data as WorkShift[],
      canManage,
    };
  });

const checkInServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceRow> => {
    const { data, error } = await context.supabase.rpc("gpm_check_in");
    if (error) throw error;
    return data as AttendanceRow;
  });

const checkOutServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceRow> => {
    const { data, error } = await context.supabase.rpc("gpm_check_out");
    if (error) throw error;
    return data as AttendanceRow;
  });

const listWorkShiftsServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ date: DATE }).parse(input))
  .handler(async ({ data, context }): Promise<WorkShift[]> => {
    const caller = await getCaller(context.supabase, context.userId);
    const { data: shifts, error } = await context.supabase
      .from("work_shifts")
      .select(shiftSelect)
      .eq("property_code", caller.property_code)
      .eq("shift_date", data.date)
      .order("department");
    if (error) throw error;
    return shifts as WorkShift[];
  });

const saveWorkShiftServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        date: DATE,
        department: z.enum(STAFF_DEPARTMENTS),
        shift_pattern: z.enum(ATTENDANCE_SHIFT_PATTERNS),
        reporting_time: TIME,
        grace_minutes: z.number().int().min(0).max(240),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    if (!["Admin", "Manager"].includes(caller.role)) {
      throw new Error("Only an administrator or manager can change reporting times.");
    }
    const { error } = await context.supabase.from("work_shifts").upsert(
      {
        property_code: caller.property_code,
        shift_date: data.date,
        department: data.department,
        shift_pattern: data.shift_pattern,
        reporting_time: data.reporting_time,
        grace_minutes: data.grace_minutes,
        created_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "property_code,shift_date,department" },
    );
    if (error) throw error;
    return { ok: true };
  });

const deleteWorkShiftServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await getCaller(context.supabase, context.userId);
    if (!["Admin", "Manager"].includes(caller.role)) {
      throw new Error("Only an administrator or manager can change reporting times.");
    }
    const { error } = await context.supabase
      .from("work_shifts")
      .delete()
      .eq("id", data.id)
      .eq("property_code", caller.property_code);
    if (error) throw error;
    return { ok: true };
  });

export async function attendanceBoard({
  data,
}: {
  data: { date: string; department?: string };
}): Promise<AttendanceBoard> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<AttendanceBoard>({ action: "attendance_board", data });
  }
  return attendanceBoardServer({ data });
}

export async function checkIn(): Promise<AttendanceRow> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<AttendanceRow>({ action: "attendance_check_in" });
  }
  return checkInServer();
}

export async function checkOut(): Promise<AttendanceRow> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<AttendanceRow>({ action: "attendance_check_out" });
  }
  return checkOutServer();
}

export async function listWorkShifts({ data }: { data: { date: string } }): Promise<WorkShift[]> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<WorkShift[]>({ action: "list_work_shifts", data });
  }
  return listWorkShiftsServer({ data });
}

export async function saveWorkShift({
  data,
}: {
  data: {
    date: string;
    department: (typeof STAFF_DEPARTMENTS)[number];
    shift_pattern: AttendanceShiftPattern;
    reporting_time: string;
    grace_minutes: number;
  };
}): Promise<{ ok: true }> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<{ ok: true }>({ action: "save_work_shift", data });
  }
  return saveWorkShiftServer({ data });
}

export async function deleteWorkShift({ data }: { data: { id: string } }): Promise<{ ok: true }> {
  if (usesGpmMobileApi()) {
    return invokeGpmMobileApi<{ ok: true }>({ action: "delete_work_shift", data });
  }
  return deleteWorkShiftServer({ data });
}

export const currentAttendanceDate = () => lusakaParts(new Date().toISOString()).date;
