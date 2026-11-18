import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/gpm/AppShell";
import { AttendancePanel } from "@/components/gpm/AttendancePanel";
import { APP_NAME } from "@/lib/version";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: `Staff Attendance - ${APP_NAME}` },
      { name: "description", content: "Record staff check-in and check-out times." },
    ],
  }),
  component: AttendancePage,
});

function AttendancePage() {
  return (
    <AppShell title="Staff Attendance">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <h1 className="text-xl font-bold">Staff attendance</h1>
          <p className="text-sm text-muted-foreground">
            Check in when you report to work. Your timestamp is recorded securely for your property.
          </p>
        </header>
        <AttendancePanel />
      </div>
    </AppShell>
  );
}
