import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const roles = [
  "Admin",
  "Manager",
  "Supervisor",
  "Front Desk",
  "Housekeeping",
  "Maintenance",
  "Restaurant",
] as const;
type StaffRole = (typeof roles)[number];
type Action = "list" | "create" | "update" | "delete" | "reset_pin" | "send_password_reset";
type StaffInput = {
  action: Action;
  id?: string;
  name?: string;
  email?: string;
  loginIdentifier?: string;
  password?: string;
  pin?: string;
  role?: StaffRole;
};
type Caller = {
  id: string;
  propertyCode: string;
  role: StaffRole;
};
type AttendanceRow = {
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
type WorkShift = {
  id: string;
  shift_date: string;
  department: string;
  shift_pattern: "Morning and Night" | "Morning and Afternoon";
  reporting_time: string;
  grace_minutes: number;
};
type AttendanceBoardInput = { date: string; department?: string };
type SaveWorkShiftInput = {
  date: string;
  department: string;
  shift_pattern: "Morning and Night" | "Morning and Afternoon";
  reporting_time: string;
  grace_minutes: number;
};
type AttendanceNetworkInput = { label: string };
type OwnStaffPinInput = {
  currentPin?: string;
  newPin: string;
};
type ApiError = Error & { status: number };
const GILNET_AUTH_CALLBACK = "gilnet://auth/callback?type=recovery";
const attendanceDepartments = [
  "Housekeeping",
  "Food and Beverage",
  "Front Office",
  "Human Resource",
  "Maintenance",
  "Security",
  "Admin",
] as const;
const attendanceShiftPatterns = ["Morning and Night", "Morning and Afternoon"] as const;
function isAttendanceShiftPattern(value: string): value is SaveWorkShiftInput["shift_pattern"] {
  return attendanceShiftPatterns.some((pattern) => pattern === value);
}
const attendanceSelect =
  "id, user_id, staff_name, department, shift_date, check_in, check_out, reporting_time, grace_minutes, is_late, late_minutes";
const shiftSelect = "id, shift_date, department, shift_pattern, reporting_time, grace_minutes";

const departmentForRole: Record<StaffRole, string> = {
  Admin: "Admin",
  Manager: "Admin",
  Supervisor: "Admin",
  "Front Desk": "Front Office",
  Housekeeping: "Housekeeping",
  Maintenance: "Maintenance",
  Restaurant: "Food and Beverage",
};

function apiError(status: number, message: string): ApiError {
  return Object.assign(new Error(message), { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw apiError(400, `${label} must be text.`);
  return value.trim();
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) throw apiError(401, "Please sign in again to continue.");
  return accessToken;
}

function parseAttendanceBoardInput(value: unknown): AttendanceBoardInput {
  if (!isRecord(value)) throw apiError(400, "The attendance request is invalid.");
  const date = optionalString(value["date"], "Attendance date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw apiError(400, "Choose a valid attendance date.");
  }
  const department = optionalString(value["department"], "Department");
  if (department && !(attendanceDepartments as readonly string[]).includes(department)) {
    throw apiError(400, "Choose a valid department.");
  }
  return { date, ...(department ? { department } : {}) };
}

function parseSaveWorkShiftInput(value: unknown): SaveWorkShiftInput {
  if (!isRecord(value)) throw apiError(400, "The reporting-time request is invalid.");
  const date = optionalString(value["date"], "Reporting date");
  const department = optionalString(value["department"], "Department");
  const shiftPattern = optionalString(value["shift_pattern"], "Shift pattern");
  const reportingTime = optionalString(value["reporting_time"], "Reporting time");
  const graceMinutes = value["grace_minutes"];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw apiError(400, "Choose a valid reporting date.");
  }
  if (!department || !(attendanceDepartments as readonly string[]).includes(department)) {
    throw apiError(400, "Choose a valid department.");
  }
  if (!shiftPattern || !isAttendanceShiftPattern(shiftPattern)) {
    throw apiError(400, "Choose a valid shift pattern.");
  }
  if (!reportingTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reportingTime)) {
    throw apiError(400, "Choose a valid reporting time.");
  }
  if (
    typeof graceMinutes !== "number" ||
    !Number.isInteger(graceMinutes) ||
    graceMinutes < 0 ||
    graceMinutes > 240
  ) {
    throw apiError(400, "Grace minutes must be a whole number between 0 and 240.");
  }
  return {
    date,
    department,
    shift_pattern: shiftPattern,
    reporting_time: reportingTime,
    grace_minutes: graceMinutes,
  };
}

function parseDeleteWorkShiftInput(value: unknown) {
  if (!isRecord(value)) throw apiError(400, "The reporting-time request is invalid.");
  const id = optionalString(value["id"], "Shift ID");
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw apiError(400, "The reporting-time ID is invalid.");
  }
  return { id };
}

function parseAttendanceNetworkInput(value: unknown): AttendanceNetworkInput {
  if (!isRecord(value)) throw apiError(400, "The office Wi-Fi request is invalid.");
  const label = optionalString(value["label"], "Network name");
  if (!label || label.length > 60) {
    throw apiError(400, "Enter an office Wi-Fi name between 1 and 60 characters.");
  }
  return { label };
}

function parseAttendanceNetworkId(value: unknown) {
  if (!isRecord(value)) throw apiError(400, "The office Wi-Fi request is invalid.");
  const id = optionalString(value["id"], "Network ID");
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw apiError(400, "The office Wi-Fi ID is invalid.");
  }
  return { id };
}

function parseStaffInput(value: unknown): StaffInput {
  if (!isRecord(value)) throw apiError(400, "The staff request is invalid.");
  const action = value["action"];
  if (
    !["list", "create", "update", "delete", "reset_pin", "send_password_reset"].includes(
      String(action),
    )
  ) {
    throw apiError(400, "The staff action is invalid.");
  }
  const input: StaffInput = { action: action as Action };
  input.id = optionalString(value["id"], "Staff ID");
  input.name = optionalString(value["name"], "Name");
  input.email = optionalString(value["email"], "Company email");
  input.loginIdentifier = optionalString(value["loginIdentifier"], "Sign-in email");
  input.password = optionalString(value["password"], "Password");
  input.pin = optionalString(value["pin"], "PIN");
  const role = value["role"];
  if (role !== undefined) {
    if (typeof role !== "string" || !roles.includes(role as StaffRole)) {
      throw apiError(400, "The permission role is invalid.");
    }
    input.role = role as StaffRole;
  }
  if (
    input.id &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)
  ) {
    throw apiError(400, "The staff ID is invalid.");
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw apiError(400, "Enter a valid company email.");
  }
  if (input.loginIdentifier && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.loginIdentifier)) {
    throw apiError(400, "Staff and management accounts must use an email address.");
  }
  if (input.password && input.password.length < 8) {
    throw apiError(400, "Passwords must contain at least 8 characters.");
  }
  if (input.pin && !/^\d{6}$/.test(input.pin)) {
    throw apiError(400, "Staff PINs must contain exactly 6 digits.");
  }
  return input;
}

function parseOwnStaffPinInput(value: unknown): OwnStaffPinInput {
  if (!isRecord(value)) throw apiError(400, "The PIN request is invalid.");
  const currentPin = optionalString(value["currentPin"], "Current PIN");
  const newPin = optionalString(value["newPin"], "New PIN");
  if (currentPin && !/^\d{6}$/.test(currentPin)) {
    throw apiError(400, "Your current PIN must contain exactly 6 digits.");
  }
  if (!newPin || !/^\d{6}$/.test(newPin)) {
    throw apiError(400, "Your new PIN must contain exactly 6 digits.");
  }
  return { ...(currentPin ? { currentPin } : {}), newPin };
}

function generateStaffPin() {
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  } while (value >= limit);
  return String(value % range).padStart(6, "0");
}

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `Gpm!${random}a9`;
}

function departmentForMessageRole(role: StaffRole) {
  return ["Admin", "Manager", "Supervisor"].includes(role) ? "Management" : role;
}

function isPrivateMessageForStaff(value: unknown, staffId: string) {
  if (!isRecord(value)) return false;
  const isPrivate =
    value["receiver_type"] === "specific" ||
    value["receiver_type"] === "individual" ||
    value["recipient_type"] === "individual";
  return (
    isPrivate && (value["sender_staff_id"] === staffId || value["receiver_staff_id"] === staffId)
  );
}

async function createClients() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    console.error("gpm-mobile-api is missing its Supabase URL or service-role key.");
    throw apiError(500, "Staff services are not configured on the server.");
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return admin;
}

async function getCaller(
  request: Request,
  admin: ReturnType<typeof createClient>,
): Promise<Caller> {
  const accessToken = getAccessToken(request);

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData.user)
    throw apiError(401, "Your session is invalid or has expired. Please sign in again.");

  const { data, error } = await admin
    .from("user_roles")
    .select("property_code, role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !roles.includes(data.role as StaffRole)) {
    throw apiError(403, "This account is not assigned to a property.");
  }
  return { id: authData.user.id, propertyCode: data.property_code, role: data.role as StaffRole };
}

function requireManager(caller: Caller) {
  if (!["Admin", "Manager", "Supervisor"].includes(caller.role)) {
    throw apiError(403, "Only an administrator, manager or supervisor can manage staff.");
  }
}

function requireAttendanceAdmin(caller: Caller) {
  if (caller.role !== "Admin")
    throw apiError(403, "Only the property Admin can manage office Wi-Fi.");
}

function requestClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    "";
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
}

function requiredRequestClientIp(request: Request) {
  const ip = requestClientIp(request);
  if (!ip)
    throw apiError(
      403,
      "Could not detect your network address. Connect to office Wi-Fi and try again.",
    );
  return ip;
}

async function loadAttendanceNetworkStatus(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  request: Request,
) {
  const ip = requestClientIp(request);
  const { count, error: countError } = await admin
    .from("allowed_networks")
    .select("id", { count: "exact", head: true })
    .eq("property_code", caller.propertyCode);
  if (countError) throw countError;
  if (!ip) return { configured: (count ?? 0) > 0, allowed: false };

  const { data: allowed, error } = await admin.rpc("gpm_is_attendance_network_allowed", {
    p_property_code: caller.propertyCode,
    p_client_ip: ip,
  });
  if (error) throw error;
  return { configured: (count ?? 0) > 0, allowed: allowed === true };
}

async function listAttendanceNetworks(admin: ReturnType<typeof createClient>, caller: Caller) {
  requireAttendanceAdmin(caller);
  const { data, error } = await admin
    .from("allowed_networks")
    .select("id,label,ip_address,created_at")
    .eq("property_code", caller.propertyCode)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

async function addAttendanceNetwork(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  request: Request,
  input: AttendanceNetworkInput,
) {
  requireAttendanceAdmin(caller);
  const ip = requiredRequestClientIp(request);
  const { data, error } = await admin
    .from("allowed_networks")
    .insert({
      property_code: caller.propertyCode,
      label: input.label,
      ip_address: ip,
      created_by: caller.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw apiError(409, "This office network is already allowed.");
    throw apiError(400, "Could not save this office Wi-Fi address.");
  }
  return { id: data.id };
}

async function deleteAttendanceNetwork(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  id: string,
) {
  requireAttendanceAdmin(caller);
  const { error } = await admin
    .from("allowed_networks")
    .delete()
    .eq("id", id)
    .eq("property_code", caller.propertyCode);
  if (error) throw error;
  return { ok: true };
}

async function loadAttendanceBoard(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  input: AttendanceBoardInput,
) {
  const canManage = ["Admin", "Manager", "Supervisor"].includes(caller.role);
  let attendanceQuery = admin
    .from("staff_attendance")
    .select(attendanceSelect)
    .eq("property_code", caller.propertyCode)
    .eq("shift_date", input.date)
    .order("check_in");
  if (!canManage) attendanceQuery = attendanceQuery.eq("user_id", caller.id);
  if (canManage && input.department) {
    attendanceQuery = attendanceQuery.eq("department", input.department);
  }

  const shiftsQuery = admin
    .from("work_shifts")
    .select(shiftSelect)
    .eq("property_code", caller.propertyCode)
    .eq("shift_date", input.date)
    .order("department");
  const [attendance, shifts] = await Promise.all([attendanceQuery, shiftsQuery]);
  if (attendance.error) throw attendance.error;
  if (shifts.error) throw shifts.error;

  const profilesQuery = admin
    .from("profiles")
    .select("id, name")
    .eq("property_code", caller.propertyCode);
  const rolesQuery = admin
    .from("user_roles")
    .select("user_id, role")
    .eq("property_code", caller.propertyCode);
  const staffQuery = admin
    .from("staff_members")
    .select("auth_user_id, department")
    .eq("property_code", caller.propertyCode)
    .eq("active", true);
  const [profiles, roleRows, staff] = canManage
    ? await Promise.all([profilesQuery.order("name"), rolesQuery, staffQuery])
    : await Promise.all([
        profilesQuery.eq("id", caller.id),
        rolesQuery.eq("user_id", caller.id),
        staffQuery.eq("auth_user_id", caller.id),
      ]);
  if (profiles.error) throw profiles.error;
  if (roleRows.error) throw roleRows.error;
  if (staff.error) throw staff.error;

  const roleById = new Map((roleRows.data ?? []).map((row) => [row.user_id, row.role]));
  const departmentById = new Map(
    (staff.data ?? []).map((row) => [row.auth_user_id, row.department]),
  );
  const roster = (profiles.data ?? []).map((profile) => {
    const role = roleById.get(profile.id) ?? "Front Desk";
    return {
      id: profile.id,
      name: profile.name,
      role,
      department: departmentById.get(profile.id) ?? departmentForRole[role as StaffRole],
    };
  });

  return {
    date: input.date,
    rows: attendance.data as AttendanceRow[],
    roster:
      canManage && input.department
        ? roster.filter((member) => member.department === input.department)
        : roster,
    shifts: shifts.data as WorkShift[],
    canManage,
  };
}

async function checkAttendanceIn(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  _request: Request,
) {
  const { data, error } = await admin.rpc("gpm_check_in", {
    p_user_id: caller.id,
    p_client_ip: null,
  });
  if (error) throw error;
  return data as AttendanceRow;
}

async function checkAttendanceOut(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  _request: Request,
) {
  const { data, error } = await admin.rpc("gpm_check_out", {
    p_user_id: caller.id,
    p_client_ip: null,
  });
  if (error) throw error;
  return data as AttendanceRow;
}

async function listWorkShifts(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  date: string,
) {
  const { data, error } = await admin
    .from("work_shifts")
    .select(shiftSelect)
    .eq("property_code", caller.propertyCode)
    .eq("shift_date", date)
    .order("department");
  if (error) throw error;
  return data as WorkShift[];
}

async function saveWorkShift(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  input: SaveWorkShiftInput,
) {
  if (!["Admin", "Manager"].includes(caller.role)) {
    throw apiError(403, "Only an administrator or manager can change reporting times.");
  }
  const { error } = await admin.from("work_shifts").upsert(
    {
      property_code: caller.propertyCode,
      shift_date: input.date,
      department: input.department,
      shift_pattern: input.shift_pattern,
      reporting_time: input.reporting_time,
      grace_minutes: input.grace_minutes,
      created_by: caller.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_code,shift_date,department" },
  );
  if (error) throw error;
  return { ok: true };
}

async function deleteWorkShift(admin: ReturnType<typeof createClient>, caller: Caller, id: string) {
  if (!["Admin", "Manager"].includes(caller.role)) {
    throw apiError(403, "Only an administrator or manager can change reporting times.");
  }
  const { error } = await admin
    .from("work_shifts")
    .delete()
    .eq("id", id)
    .eq("property_code", caller.propertyCode);
  if (error) throw error;
  return { ok: true };
}

async function listStaff(admin: ReturnType<typeof createClient>, propertyCode: string) {
  const [profiles, roleRows, members] = await Promise.all([
    admin.from("profiles").select("*").eq("property_code", propertyCode),
    admin.from("user_roles").select("*").eq("property_code", propertyCode),
    admin.from("staff_members").select("*").eq("property_code", propertyCode).eq("active", true),
  ]);
  if (profiles.error || roleRows.error || members.error) {
    throw profiles.error ?? roleRows.error ?? members.error;
  }

  return Promise.all(
    (profiles.data ?? []).map(async (profile) => {
      const role = roleRows.data?.find((row) => row.user_id === profile.id)?.role ?? "Front Desk";
      const member = members.data?.find((row) => row.auth_user_id === profile.id);
      const { data: auth, error } = await admin.auth.admin.getUserById(profile.id);
      if (error) throw error;
      return {
        id: profile.id,
        name: member?.staff_name ?? profile.name,
        username: profile.username,
        email: member?.company_email ?? auth.user?.email ?? "",
        loginIdentifier: auth.user?.phone ?? auth.user?.email ?? "",
        password: "",
        role,
        department: member?.department ?? "",
        isStaffMember: !!member,
      };
    }),
  );
}

async function manageStaff(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  input: StaffInput,
) {
  requireManager(caller);
  if (input.role === "Admin" && caller.role !== "Admin") {
    throw apiError(403, "Only an administrator can assign the Admin role.");
  }
  if (input.action === "update" && input.password) {
    throw apiError(400, "Management passwords must be reset with the email confirmation code.");
  }

  if (input.action === "create") {
    if (!input.name || !input.email || !input.role) {
      throw apiError(400, "Name, email and permission role are required.");
    }
    const isManagement = ["Admin", "Manager", "Supervisor"].includes(input.role);
    const companyEmail = input.email.trim().toLowerCase();
    const email = isManagement ? input.loginIdentifier?.trim().toLowerCase() : companyEmail;
    if (!email) {
      throw apiError(400, "Management accounts must use a login email address.");
    }
    if (
      !isManagement &&
      input.loginIdentifier &&
      input.loginIdentifier.trim().toLowerCase() !== companyEmail
    ) {
      throw apiError(400, "Staff sign-in email must match the staff email.");
    }
    if (isManagement && !input.password) {
      throw apiError(
        400,
        "Management accounts must use an email address and a password of at least 8 characters.",
      );
    }

    const pin = input.pin ?? generateStaffPin();
    const { data: hashedPin, error: hashError } = await admin.rpc("gpm_hash_staff_pin", {
      p_pin: pin,
    });
    if (hashError || !hashedPin) throw hashError ?? new Error("Could not secure the staff PIN.");

    const initialPassword = isManagement ? input.password! : generateTemporaryPassword();
    const { data: created, error: creationError } = await admin.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: !isManagement,
      user_metadata: {
        name: input.name,
        username: email.split("@")[0],
        company_email: companyEmail,
        property_code: caller.propertyCode,
        department: departmentForMessageRole(input.role),
        ...(isManagement ? {} : { initial_password: initialPassword }),
      },
    });
    if (creationError || !created.user)
      throw creationError ?? new Error("Account creation failed.");

    const userId = created.user.id;
    const rollbackCreatedAccount = async () => {
      const membershipRollback = await admin
        .from("staff_members")
        .delete()
        .eq("auth_user_id", userId);
      const roleRollback = await admin.from("user_roles").delete().eq("user_id", userId);
      const accountRollback = await admin.auth.admin.deleteUser(userId);
      return [
        membershipRollback.error?.message,
        roleRollback.error?.message,
        accountRollback.error?.message,
      ].filter((message): message is string => !!message);
    };
    const profile = await admin
      .from("profiles")
      .update({ name: input.name, property_code: caller.propertyCode })
      .eq("id", userId);
    const role = await admin
      .from("user_roles")
      .insert({ user_id: userId, property_code: caller.propertyCode, role: input.role });
    const membership = await admin.from("staff_members").insert({
      auth_user_id: userId,
      property_code: caller.propertyCode,
      company_email: companyEmail,
      staff_name: input.name,
      department: departmentForRole[input.role],
      role: input.role,
      pin_hash: hashedPin,
      pin_setup_required: !isManagement,
    });

    if (profile.error || role.error || membership.error) {
      const cleanupErrors = await rollbackCreatedAccount();
      const cleanupDetail = cleanupErrors.length
        ? ` Account cleanup also failed: ${cleanupErrors.join("; ")}`
        : "";
      if (role.error?.code === "23514" || membership.error?.code === "23514") {
        throw apiError(
          500,
          `The staff role database rules are out of date. Apply drizzle/migrations/0005_staff_role_constraints.sql to Supabase, then try again. ${role.error?.message ?? membership.error?.message}${cleanupDetail}`,
        );
      }
      const assignmentError =
        profile.error ??
        role.error ??
        membership.error ??
        new Error("Could not assign staff account.");
      throw new Error(`${assignmentError.message}${cleanupDetail}`);
    }

    if (isManagement) {
      const { error } = await admin.auth.resend({ type: "signup", email });
      if (error) {
        const cleanupErrors = await rollbackCreatedAccount();
        throw new Error(
          `Could not send the management account confirmation code: ${error.message}${cleanupErrors.length ? ` Account cleanup failed: ${cleanupErrors.join("; ")}` : ""}`,
        );
      }
    } else {
      const { error: emailError } = await admin.auth.resetPasswordForEmail(email);
      if (emailError) {
        const cleanupErrors = await rollbackCreatedAccount();
        throw new Error(
          `Could not send the staff login details: ${emailError.message}${cleanupErrors.length ? ` Account cleanup failed: ${cleanupErrors.join("; ")}` : ""}`,
        );
      }
      const { error: metadataCleanupError } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: { initial_password: null },
      });
      if (metadataCleanupError) {
        const rollbackErrors = await rollbackCreatedAccount();
        throw new Error(
          `Could not remove the emailed password from account metadata. ${rollbackErrors.length ? `Account cleanup also failed: ${rollbackErrors.join("; ")}` : "The staff account was removed; retry creation."}`,
        );
      }
    }
  }

  if (input.action === "delete" || input.action === "update") {
    if (!input.id || input.id === caller.id) {
      throw apiError(400, "You cannot change or delete your own administrator access here.");
    }
    const target = await admin.from("user_roles").select("*").eq("user_id", input.id).maybeSingle();
    if (target.error) throw target.error;
    if (!target.data || target.data.property_code !== caller.propertyCode) {
      throw apiError(404, "Staff account not found.");
    }
    if (target.data.role === "Admin") {
      throw apiError(400, "Administrator accounts cannot be removed or demoted here.");
    }
    if (input.action === "update" && input.role) {
      const wasManagement = ["Admin", "Manager", "Supervisor"].includes(target.data.role);
      const becomesManagement = ["Admin", "Manager", "Supervisor"].includes(input.role);
      if (wasManagement !== becomesManagement) {
        throw apiError(
          400,
          "This change requires different sign-in credentials. Create an account with the new role and matching sign-in method instead.",
        );
      }
    }

    const member = await admin
      .from("staff_members")
      .select("auth_user_id")
      .eq("auth_user_id", input.id)
      .eq("property_code", caller.propertyCode)
      .maybeSingle();
    if (member.error) throw member.error;

    if (input.action === "delete") {
      const result = await admin.auth.admin.deleteUser(input.id);
      if (result.error) throw result.error;
    } else {
      if (input.name) {
        const result = await admin.from("profiles").update({ name: input.name }).eq("id", input.id);
        if (result.error) throw result.error;
        if (member.data) {
          const update = await admin
            .from("staff_members")
            .update({ staff_name: input.name })
            .eq("auth_user_id", input.id);
          if (update.error) throw update.error;
        }
      }
      if (input.role) {
        const result = await admin
          .from("user_roles")
          .update({ role: input.role })
          .eq("user_id", input.id);
        if (result.error) throw result.error;
        if (member.data) {
          const update = await admin
            .from("staff_members")
            .update({ role: input.role, department: departmentForRole[input.role] })
            .eq("auth_user_id", input.id);
          if (update.error) throw update.error;
          const { data: authUser, error } = await admin.auth.admin.getUserById(input.id);
          if (error || !authUser.user) throw error ?? new Error("Could not load staff account.");
          const metadataUpdate = await admin.auth.admin.updateUserById(input.id, {
            user_metadata: {
              ...(authUser.user.user_metadata ?? {}),
              department: departmentForMessageRole(input.role),
            },
          });
          if (metadataUpdate.error) throw metadataUpdate.error;
        }
      }
      if (member.data && input.email) {
        const companyEmail = input.email.trim().toLowerCase();
        const existing = await admin
          .from("staff_members")
          .select("auth_user_id", { count: "exact", head: true })
          .eq("property_code", caller.propertyCode)
          .neq("auth_user_id", input.id)
          .ilike("company_email", companyEmail.replace(/[\\%_]/g, "\\$&"));
        if (existing.error) throw existing.error;
        if ((existing.count ?? 0) >= 7) {
          throw apiError(
            400,
            "This company email already has the maximum of 7 staff for this property.",
          );
        }
        const update = await admin
          .from("staff_members")
          .update({
            company_email: companyEmail,
            ...(input.name ? { staff_name: input.name } : {}),
          })
          .eq("auth_user_id", input.id);
        if (update.error) throw update.error;
        const { data: authUser, error } = await admin.auth.admin.getUserById(input.id);
        if (error || !authUser.user) throw error ?? new Error("Could not load staff account.");
        const metadataUpdate = await admin.auth.admin.updateUserById(input.id, {
          user_metadata: {
            ...(authUser.user.user_metadata ?? {}),
            company_email: companyEmail,
            username: companyEmail.split("@")[0],
          },
        });
        if (metadataUpdate.error) throw metadataUpdate.error;
      }
    }
  }

  if (input.action === "reset_pin" || input.action === "send_password_reset") {
    if (!input.id || input.id === caller.id)
      throw apiError(400, "Choose another property account to reset.");
    const target = await admin
      .from("user_roles")
      .select("*")
      .eq("user_id", input.id)
      .eq("property_code", caller.propertyCode)
      .maybeSingle();
    if (target.error) throw target.error;
    if (!target.data) throw apiError(404, "Property account not found.");
    const isManagement = ["Admin", "Manager", "Supervisor"].includes(target.data.role);

    if (input.action === "reset_pin") {
      if (isManagement)
        throw apiError(400, "A PIN reset link can only be sent for a staff account.");
      const member = await admin
        .from("staff_members")
        .select("auth_user_id, pin_setup_required")
        .eq("auth_user_id", input.id)
        .eq("property_code", caller.propertyCode)
        .eq("active", true)
        .maybeSingle();
      if (member.error) throw member.error;
      if (!member.data) throw apiError(404, "Staff account not found.");
      const setupRequired = await admin
        .from("staff_members")
        .update({ pin_setup_required: true })
        .eq("auth_user_id", input.id)
        .eq("property_code", caller.propertyCode);
      if (setupRequired.error) throw setupRequired.error;
      const { data: authUser, error: authLookupError } = await admin.auth.admin.getUserById(
        input.id,
      );
      if (authLookupError || !authUser.user?.email) {
        const rollback = await admin
          .from("staff_members")
          .update({ pin_setup_required: member.data.pin_setup_required })
          .eq("auth_user_id", input.id)
          .eq("property_code", caller.propertyCode);
        if (rollback.error)
          throw new Error(
            `Could not find the staff login email: ${authLookupError?.message ?? "email is missing"}. The PIN setup state could not be restored: ${rollback.error.message}`,
          );
        throw authLookupError ?? apiError(400, "The staff account has no login email.");
      }
      const reset = await admin.auth.resetPasswordForEmail(authUser.user.email, {
        redirectTo: GILNET_AUTH_CALLBACK,
      });
      if (reset.error) {
        const rollback = await admin
          .from("staff_members")
          .update({ pin_setup_required: member.data.pin_setup_required })
          .eq("auth_user_id", input.id)
          .eq("property_code", caller.propertyCode);
        if (rollback.error) {
          throw new Error(
            `Could not send the PIN reset link: ${reset.error.message}. The PIN setup state could not be restored: ${rollback.error.message}`,
          );
        }
        throw new Error(`Could not send the PIN reset link: ${reset.error.message}`);
      }
    } else {
      const { data: authUser, error } = await admin.auth.admin.getUserById(input.id);
      if (error || !authUser.user?.email) {
        throw error ?? apiError(400, "The account does not have a resettable email address.");
      }
      if (isManagement) {
        if (caller.role !== "Admin") {
          throw apiError(403, "Only an administrator can initiate a management password reset.");
        }
        if (authUser.user.email.endsWith("@users.gilnet.app")) {
          throw apiError(
            400,
            "This older management account has no login email. Create a replacement management account with a unique email address.",
          );
        }
        if (!authUser.user.email_confirmed_at) {
          throw apiError(
            400,
            "The management user must confirm their email before a password reset can be sent.",
          );
        }
      } else {
        const member = await admin
          .from("staff_members")
          .select("auth_user_id")
          .eq("auth_user_id", input.id)
          .eq("property_code", caller.propertyCode)
          .eq("active", true)
          .maybeSingle();
        if (member.error) throw member.error;
        if (!member.data) throw apiError(404, "Staff account not found.");
      }
      const reset = await admin.auth.resetPasswordForEmail(authUser.user.email, {
        redirectTo: GILNET_AUTH_CALLBACK,
      });
      if (reset.error) throw reset.error;
    }
  }

  return listStaff(admin, caller.propertyCode);
}

async function changeOwnStaffPin(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  input: OwnStaffPinInput,
) {
  if (["Admin", "Manager", "Supervisor"].includes(caller.role)) {
    throw apiError(403, "Management accounts use Change Password, not a staff PIN.");
  }
  if (input.currentPin === input.newPin) {
    throw apiError(400, "Choose a different PIN from your current PIN.");
  }

  const member = await admin
    .from("staff_members")
    .select("pin_hash, pin_setup_required")
    .eq("auth_user_id", caller.id)
    .eq("property_code", caller.propertyCode)
    .eq("active", true)
    .maybeSingle();
  if (member.error) throw member.error;
  if (!member.data) throw apiError(404, "Active staff account not found.");

  if (!member.data.pin_setup_required) {
    if (!input.currentPin) throw apiError(400, "Enter your current PIN before changing it.");
    const verified = await admin.rpc("gpm_verify_staff_pin", {
      p_user_id: caller.id,
      p_pin: input.currentPin,
    });
    if (verified.error) throw verified.error;
    if (!verified.data) {
      throw apiError(400, "The current PIN is incorrect or temporarily locked.");
    }
  }

  const { data: pinHash, error: hashError } = await admin.rpc("gpm_hash_staff_pin", {
    p_pin: input.newPin,
  });
  if (hashError || !pinHash) {
    throw hashError ?? new Error("Could not secure the new PIN.");
  }
  const pinUpdate = await admin
    .from("staff_members")
    .update({ pin_hash: pinHash, pin_setup_required: false })
    .eq("auth_user_id", caller.id)
    .eq("property_code", caller.propertyCode)
    .eq("active", true)
    .select("auth_user_id")
    .maybeSingle();
  if (pinUpdate.error) throw pinUpdate.error;
  if (!pinUpdate.data) throw apiError(404, "Active staff account not found.");

  return true;
}

async function listStaffRecipients(admin: ReturnType<typeof createClient>, caller: Caller) {
  const result = await admin
    .from("staff_members")
    .select("auth_user_id, staff_name, department")
    .eq("property_code", caller.propertyCode)
    .eq("active", true)
    .neq("auth_user_id", caller.id)
    .order("staff_name");
  if (!result.error) {
    return (result.data ?? []).map((member) => ({
      id: member.auth_user_id,
      name: member.staff_name,
      department: member.department,
    }));
  }
  if (result.error.code !== "PGRST205") throw result.error;

  const [profiles, propertyRoles] = await Promise.all([
    admin.from("profiles").select("id, name").eq("property_code", caller.propertyCode),
    admin.from("user_roles").select("user_id").eq("property_code", caller.propertyCode),
  ]);
  if (profiles.error) throw profiles.error;
  if (propertyRoles.error) throw propertyRoles.error;
  const propertyUserIds = new Set((propertyRoles.data ?? []).map((role) => role.user_id));
  return (profiles.data ?? [])
    .filter((profile) => profile.id !== caller.id && propertyUserIds.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      name: profile.name.trim() || "Staff member",
      department: "",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listPrivateMessages(admin: ReturnType<typeof createClient>, caller: Caller) {
  const loadRows = async (direction: "sent" | "received") => {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 1000) {
      let query = admin
        .from("operation_rows")
        .select("id, kind, payload, revision, deleted, receiver_staff_id, is_private")
        .eq("property_code", caller.propertyCode)
        .eq("kind", "messages")
        .eq("is_private", true);
      query =
        direction === "received"
          ? query.eq("receiver_staff_id", caller.id)
          : query.filter("payload->>sender_staff_id", "eq", caller.id);
      const { data, error } = await query.order("id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  };
  const [sent, received] = await Promise.all([loadRows("sent"), loadRows("received")]);
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of [...sent, ...received]) {
    if (row["is_private"] === true && isPrivateMessageForStaff(row["payload"], caller.id)) {
      unique.set(String(row["id"]), row);
    }
  }
  return [...unique.values()];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return response(405, { error: "Only POST requests are supported." });

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw apiError(400, "A valid JSON request body is required.");
    }
    if (!isRecord(body) || typeof body["action"] !== "string") {
      throw apiError(400, "The request is invalid.");
    }
    const admin = await createClients();
    const caller = await getCaller(request, admin);
    let result: unknown;

    if (body["action"] === "manage_staff") {
      result = await manageStaff(admin, caller, parseStaffInput(body["data"]));
    } else if (body["action"] === "change_own_staff_pin") {
      result = await changeOwnStaffPin(admin, caller, parseOwnStaffPinInput(body["data"]));
    } else if (body["action"] === "attendance_board") {
      result = await loadAttendanceBoard(admin, caller, parseAttendanceBoardInput(body["data"]));
    } else if (body["action"] === "attendance_check_in") {
      result = await checkAttendanceIn(admin, caller, request);
    } else if (body["action"] === "attendance_check_out") {
      result = await checkAttendanceOut(admin, caller, request);
    } else if (body["action"] === "attendance_network_status") {
      result = await loadAttendanceNetworkStatus(admin, caller, request);
    } else if (body["action"] === "list_attendance_networks") {
      result = await listAttendanceNetworks(admin, caller);
    } else if (body["action"] === "current_attendance_network_ip") {
      requireAttendanceAdmin(caller);
      result = { ip: requestClientIp(request) };
    } else if (body["action"] === "add_attendance_network") {
      result = await addAttendanceNetwork(
        admin,
        caller,
        request,
        parseAttendanceNetworkInput(body["data"]),
      );
    } else if (body["action"] === "delete_attendance_network") {
      const { id } = parseAttendanceNetworkId(body["data"]);
      result = await deleteAttendanceNetwork(admin, caller, id);
    } else if (body["action"] === "list_work_shifts") {
      const { date } = parseAttendanceBoardInput(body["data"]);
      result = await listWorkShifts(admin, caller, date);
    } else if (body["action"] === "save_work_shift") {
      result = await saveWorkShift(admin, caller, parseSaveWorkShiftInput(body["data"]));
    } else if (body["action"] === "delete_work_shift") {
      const { id } = parseDeleteWorkShiftInput(body["data"]);
      result = await deleteWorkShift(admin, caller, id);
    } else if (body["action"] === "list_staff_recipients") {
      result = await listStaffRecipients(admin, caller);
    } else if (body["action"] === "list_private_messages") {
      result = await listPrivateMessages(admin, caller);
    } else {
      throw apiError(400, "The requested GILNET action is not supported.");
    }
    return response(200, result);
  } catch (error) {
    const status = isRecord(error) && typeof error["status"] === "number" ? error["status"] : 500;
    const message =
      error instanceof Error
        ? error.message
        : isRecord(error) && typeof error["message"] === "string"
          ? error["message"]
          : "The request could not be completed.";
    if (status >= 500) console.error("gpm-mobile-api request failed", error);
    return response(status, { error: message });
  }
});
