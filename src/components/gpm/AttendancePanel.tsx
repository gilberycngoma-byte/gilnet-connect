import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/auth";
import { addNotice } from "@/lib/actions";
import {
  attendanceBoard,
  checkIn,
  checkOut,
  currentAttendanceDate,
  type AttendanceRow,
} from "@/lib/attendance.functions";
import {
  attendanceState,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_REPORTING_TIME,
  defaultDepartmentForRole,
  workedHours,
} from "@/lib/attendance-rules";
import { STAFF_DEPARTMENTS } from "@/lib/types";

const ALL_DEPARTMENTS = "all";

function clock(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    timeZone: "Africa/Lusaka",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttendancePanel() {
  const session = useSession();
  const staffId = session?.staff_id ?? session?.token ?? "";
  const [date, setDate] = useState(currentAttendanceDate);
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [busy, setBusy] = useState(false);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["staff-attendance", date, department],
    queryFn: () =>
      attendanceBoard({
        data: {
          date,
          ...(department === ALL_DEPARTMENTS ? {} : { department }),
        },
      }),
  });
  const ownAttendance = data?.rows.find((row) => row.user_id === staffId);
  const isToday = date === currentAttendanceDate();
  const ownDepartment =
    data?.roster.find((member) => member.id === staffId)?.department ??
    defaultDepartmentForRole(session?.role);
  const reportTime = data?.shifts.find((shift) => shift.department === ownDepartment);
  const canPunch = isToday && (department === ALL_DEPARTMENTS || department === ownDepartment);
  const roster = data?.canManage
    ? data.roster
    : data?.roster.length
      ? data.roster
      : session
        ? [
            {
              id: staffId,
              name: session.user_name,
              department: ownDepartment,
              role: session.role,
            },
          ]
        : [];
  const visibleRows = roster.map((member) => ({
    member,
    attendance: data?.rows.find((row) => row.user_id === member.id) ?? null,
    shift: data?.shifts.find((shift) => shift.department === member.department),
  }));
  const reportedCount = data?.canManage
    ? visibleRows.filter(({ attendance }) => attendance?.check_in).length
    : null;

  const run = async (action: "checkIn" | "checkOut") => {
    setBusy(true);
    try {
      if (action === "checkIn") {
        const attendance = await checkIn();
        if (!ownAttendance) {
          addNotice({
            id: `staff-check-in-${attendance.id}`,
            title: `Staff Check-In: ${attendance.staff_name}`,
            message: `${attendance.staff_name} checked in to ${attendance.department} on ${attendance.shift_date} at ${clock(attendance.check_in)}.`,
            type: "Info",
            to_department: "All Staff",
            priority: "Low",
            silent: true,
            suppressChatAlert: true,
            is_check_in_notice: true,
          });
        }
      } else await checkOut();
      await refetch();
      toast.success(action === "checkIn" ? "Attendance recorded." : "Check-out recorded.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update attendance.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-brand-border bg-brand-soft p-4">
        <div>
          <label htmlFor="attendance-date" className="text-xs font-semibold text-muted-foreground">
            Attendance date
          </label>
          <Input
            id="attendance-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 w-44"
          />
        </div>
        {data?.canManage && (
          <div>
            <label
              htmlFor="attendance-department"
              className="text-xs font-semibold text-muted-foreground"
            >
              Department
            </label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger id="attendance-department" className="mt-1 w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEPARTMENTS}>All departments</SelectItem>
                {[...STAFF_DEPARTMENTS].sort().map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {data?.canManage && reportedCount !== null && (
          <p className="pb-2 text-sm font-semibold">
            {reportedCount} of {visibleRows.length} staff reported
          </p>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            className="rounded-full"
            disabled={
              busy ||
              isPending ||
              !canPunch ||
              !!ownAttendance
            }
            onClick={() => void run("checkIn")}
          >
            <LogIn className="mr-1 h-4 w-4" />
            {ownAttendance ? "Reported today" : "Check In"}
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            disabled={
              busy ||
              !canPunch ||
              !ownAttendance ||
              !!ownAttendance.check_out
            }
            onClick={() => void run("checkOut")}
          >
            <LogOut className="mr-1 h-4 w-4" />
            Check Out
          </Button>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load attendance. {error.message}
        </p>
      )}
      {!data?.canManage && (
        <p className="rounded-xl border border-brand-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Your department reports at {reportTime?.reporting_time ?? DEFAULT_REPORTING_TIME} with{" "}
          {reportTime?.grace_minutes ?? DEFAULT_GRACE_MINUTES} minutes grace. Check in when you
          report to work; your time is recorded by the server.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-brand-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-brand-soft text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {[
                "Staff",
                "Department",
                "Check In",
                "Check Out",
                "Hours",
                "Late",
                "Status",
                "Reporting",
              ].map((heading) => (
                <th key={heading} className="whitespace-nowrap px-3 py-2 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Loading attendance…
                </td>
              </tr>
            )}
            {!isPending && visibleRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No staff are registered for this property.
                </td>
              </tr>
            )}
            {!isPending &&
              visibleRows.map(({ member, attendance, shift }) => (
                <tr
                  key={member.id}
                  className={`border-b last:border-0 ${attendance?.is_late ? "bg-status-cancelled text-destructive" : ""}`}
                >
                  <td className="px-3 py-2 font-semibold">{member.name}</td>
                  <td className="px-3 py-2">{member.department}</td>
                  <td className="px-3 py-2">{clock(attendance?.check_in)}</td>
                  <td className="px-3 py-2">{clock(attendance?.check_out)}</td>
                  <td className="px-3 py-2">
                    {attendance
                      ? workedHours(attendance.check_in, attendance.check_out) || "—"
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {!attendance
                      ? "—"
                      : attendance.is_late
                        ? `Late ${attendance.late_minutes}m`
                        : "On time"}
                  </td>
                  <td className="px-3 py-2">
                    {attendanceState({
                      check_in: attendance?.check_in ?? null,
                      check_out: attendance?.check_out ?? null,
                    })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {shift?.shift_pattern ? `${shift.shift_pattern} · ` : ""}
                    {shift?.reporting_time ?? DEFAULT_REPORTING_TIME} (+
                    {shift?.grace_minutes ?? DEFAULT_GRACE_MINUTES}m)
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
