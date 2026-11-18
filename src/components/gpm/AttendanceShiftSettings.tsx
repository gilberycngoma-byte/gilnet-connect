import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
import {
  ATTENDANCE_SHIFT_PATTERNS,
  deleteWorkShift,
  listWorkShifts,
  saveWorkShift,
  type AttendanceShiftPattern,
} from "@/lib/attendance.functions";
import { DEFAULT_GRACE_MINUTES, DEFAULT_REPORTING_TIME } from "@/lib/attendance-rules";
import { STAFF_DEPARTMENTS } from "@/lib/types";

function localDate() {
  const shifted = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function AttendanceShiftSettings() {
  const [date, setDate] = useState(localDate);
  const [department, setDepartment] = useState<string>(STAFF_DEPARTMENTS[0]);
  const [shiftPattern, setShiftPattern] =
    useState<AttendanceShiftPattern>("Morning and Afternoon");
  const [reportingTime, setReportingTime] = useState(DEFAULT_REPORTING_TIME);
  const [graceMinutes, setGraceMinutes] = useState(DEFAULT_GRACE_MINUTES);
  const [busy, setBusy] = useState(false);
  const {
    data: shifts = [],
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["staff-work-shifts", date],
    queryFn: () => listWorkShifts({ data: { date } }),
  });

  const submit = async () => {
    setBusy(true);
    try {
      await saveWorkShift({
        data: {
          date,
          department: department as (typeof STAFF_DEPARTMENTS)[number],
          shift_pattern: shiftPattern,
          reporting_time: reportingTime,
          grace_minutes: graceMinutes,
        },
      });
      await refetch();
      toast.success(`${department} ${shiftPattern} schedule saved.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save reporting time.");
    } finally {
      setBusy(false);
    }
  };

  const deleteShift = async (id: string, label: string) => {
    if (!window.confirm(`Remove the ${label} reporting time for ${date}?`)) return;
    try {
      await deleteWorkShift({ data: { id } });
      await refetch();
      toast.success("Reporting time removed.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not remove reporting time.");
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
      <div>
        <h2 className="font-bold">Department reporting times</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Staff are marked late after the reporting time and grace period. Unconfigured departments
          use 07:00 with 10 minutes grace.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          type="date"
          aria-label="Reporting date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger aria-label="Reporting department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAFF_DEPARTMENTS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={shiftPattern}
          onValueChange={(value) => setShiftPattern(value as AttendanceShiftPattern)}
        >
          <SelectTrigger aria-label="Shift pattern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTENDANCE_SHIFT_PATTERNS.map((pattern) => (
              <SelectItem key={pattern} value={pattern}>
                {pattern}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="time"
          aria-label="Reporting time"
          value={reportingTime}
          onChange={(event) => setReportingTime(event.target.value)}
        />
        <Input
          type="number"
          min={0}
          max={240}
          aria-label="Grace minutes"
          value={graceMinutes}
          onChange={(event) =>
            setGraceMinutes(Math.max(0, Math.min(240, Number(event.target.value) || 0)))
          }
        />
      </div>
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Save reporting time"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load reporting times. {error.message}
        </p>
      )}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading reporting times…</p>
      ) : (
        <ul className="divide-y rounded-xl border border-brand-border">
          {shifts.map((shift) => (
            <li
              key={shift.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>
                <strong>{shift.department}</strong> · {shift.shift_pattern} ·{" "}
                {shift.reporting_time} · {shift.grace_minutes} min grace
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${shift.department} reporting time`}
                onClick={() => void deleteShift(shift.id, shift.department)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {!shifts.length && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No department times set for this date.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
