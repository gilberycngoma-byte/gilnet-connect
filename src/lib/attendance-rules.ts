export const LUSAKA_OFFSET_MINUTES = 120;
export const DEFAULT_REPORTING_TIME = "07:00";
export const DEFAULT_GRACE_MINUTES = 10;

export function lusakaParts(iso: string): { date: string; minutes: number } {
  const shifted = new Date(new Date(iso).getTime() + LUSAKA_OFFSET_MINUTES * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function timeToMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const [hours, minutes] = value.split(":");
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

export function isLate(checkIn: string, reportingTime: string, graceMinutes: number): boolean {
  return lusakaParts(checkIn).minutes > timeToMinutes(reportingTime) + Math.max(0, graceMinutes);
}

export function lateMinutes(checkIn: string, reportingTime: string): number {
  return Math.max(0, lusakaParts(checkIn).minutes - timeToMinutes(reportingTime));
}

export function workedHours(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const elapsed = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return elapsed <= 0 ? 0 : Math.round((elapsed / 3_600_000) * 10) / 10;
}

export type AttendanceState = "Checked In" | "Checked Out" | "Not Checked In";

export function attendanceState(row: {
  check_in: string | null;
  check_out: string | null;
}): AttendanceState {
  if (row.check_out) return "Checked Out";
  if (row.check_in) return "Checked In";
  return "Not Checked In";
}

export function defaultDepartmentForRole(role?: string | null): string {
  switch (role) {
    case "Admin":
    case "Manager":
    case "Supervisor":
      return "Admin";
    case "Housekeeping":
      return "Housekeeping";
    case "Maintenance":
      return "Maintenance";
    case "Restaurant":
      return "Food and Beverage";
    default:
      return "Front Office";
  }
}

function expandIpv6(ip: string): string[] | null {
  const [head = "", tail, extra] = ip.split("::");
  if (extra !== undefined) return null;
  const leading = head ? head.split(":") : [];
  const trailing = tail ? tail.split(":") : [];
  const missing = 8 - leading.length - trailing.length;
  if (tail === undefined ? leading.length !== 8 : missing < 0) return null;
  return [...leading, ...Array(tail === undefined ? 0 : missing).fill("0"), ...trailing].map(
    (part) => part.padStart(4, "0"),
  );
}

function normalizeIp(ip: string) {
  const normalized = ip.trim().toLowerCase();
  return normalized.startsWith("::ffff:") && normalized.includes(".")
    ? normalized.slice(7)
    : normalized;
}

export function ipMatches(clientIp: string, allowedIp: string) {
  const client = normalizeIp(clientIp);
  const allowed = normalizeIp(allowedIp);
  if (!client || !allowed) return false;
  if (client === allowed) return true;
  if (!client.includes(":") || !allowed.includes(":")) return false;
  const clientGroups = expandIpv6(client);
  const allowedGroups = expandIpv6(allowed);
  return (
    !!clientGroups &&
    !!allowedGroups &&
    clientGroups.slice(0, 4).join(":") === allowedGroups.slice(0, 4).join(":")
  );
}

export function isOnCompanyNetwork(clientIp: string | null, allowedIps: string[]) {
  return !!clientIp && allowedIps.some((allowedIp) => ipMatches(clientIp, allowedIp));
}
