import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/gpm/AppShell";
import { NoticeBoardWidget } from "@/components/gpm/notices";
import { RoomStatusGrid } from "@/components/gpm/RoomStatusGrid";
import { Button } from "@/components/ui/button";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { APP_NAME } from "@/lib/version";
import type { Property } from "@/lib/types";

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

export const Route = createFileRoute("/housekeeping")({
  head: () => ({
    meta: [
      { title: `Housekeeping - ${APP_NAME}` },
      { name: "description", content: "Rooms that need cleaning and occupied rooms to service today." },
      { property: "og:title", content: `Housekeeping - ${APP_NAME}` },
      { property: "og:description", content: "Cleaning list and room servicing for housekeeping staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Housekeeping,
});

function Housekeeping() {
  const session = useSession();
  const code = session?.property_code ?? "";
  const property = useStored<Property | null>(keys.property(code), null);
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const dateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <AppShell title="Housekeeping" allow="housekeeping" hidePageHeading>
      <div className="mb-10 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your property, at a glance</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Housekeeping</h1>
          <p className="mt-2 text-muted-foreground">{property?.name ?? code} · Sample workspace</p>
        </div>
        {can(session?.role, "reservation_add") && (
          <Button className="rounded-xl px-5 py-5" asChild>
            <Link to="/reservations" search={{ add: true }}><Plus className="h-4 w-4" /> New reservation</Link>
          </Button>
        )}
      </div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Today’s guest activity</h2>
          <p className="mt-2 text-sm text-muted-foreground">A warm welcome, and a smooth farewell.</p>
        </div>
        <div className="flex items-center rounded-lg border bg-card">
          <button type="button" aria-label="Previous day" className="p-3" onClick={() => setSelectedDate((date) => shiftDate(date, -1))}><ChevronLeft className="h-4 w-4" /></button>
          <label className="relative flex cursor-pointer items-center gap-2 px-1 text-sm">
            <CalendarDays className="h-4 w-4" />
            <span>{dateLabel}</span>
            <input aria-label="Activity date" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} />
          </label>
          <button type="button" aria-label="Next day" className="p-3" onClick={() => setSelectedDate((date) => shiftDate(date, 1))}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <RoomStatusGrid mode="housekeeping" />
      <div className="mt-8"><NoticeBoardWidget /></div>
    </AppShell>
  );
}
