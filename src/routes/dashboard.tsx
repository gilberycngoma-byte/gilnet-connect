import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Brush, Building2, TrendingUp, UserRound } from "lucide-react";
import { AppShell } from "@/components/gpm/AppShell";
import { NoticeBoardWidget } from "@/components/gpm/notices";
import { RoomStatusGrid } from "@/components/gpm/RoomStatusGrid";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { money } from "@/lib/payments";
import { APP_NAME } from "@/lib/version";
import { Button } from "@/components/ui/button";
import { ReportButton } from "@/components/gpm/ReportsPanel";
import { saleDate, saleRevenue, type Sale } from "@/lib/restaurant";
import {
  fetchLatestGpmAnnouncement,
  isGpmAnnouncementWindow,
  type GpmAnnouncement,
} from "@/lib/gpm-announcements";
import type { Reservation, Room } from "@/lib/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Room Status Dashboard - ${APP_NAME}` },
      { name: "description", content: "Live room status, notices and daily operations for your property." },
      { property: "og:title", content: `Room Status Dashboard - ${APP_NAME}` },
      { property: "og:description", content: "Live room status, notices and daily operations." },
    ],
  }),
  component: Dashboard,
});

function Stat({ label, value, note, tone, cardTone, icon: Icon }: { label: string; value: number | string; note: string; tone: string; cardTone: string; icon: typeof Brush }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${cardTone}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className={`mt-2 text-4xl font-extrabold ${tone}`}>{value}</p>
      <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${tone}`}><Icon className="h-3.5 w-3.5" /> {note}</p>
    </div>
  );
}

function Dashboard() {
  const session = useSession();
  const code = session?.property_code ?? "";
  const [announcement, setAnnouncement] = useState<GpmAnnouncement | null>(null);
  const [announcementError, setAnnouncementError] = useState("");
  const [announcementWindowOpen, setAnnouncementWindowOpen] = useState(false);
  const rooms = useStored<Room[]>(keys.rooms(code), []);
  const res = useStored<Reservation[]>(keys.reservations(code), []);
  const sales = useStored<Sale[]>(keys.sales(code), []);
  const today = new Date().toISOString().slice(0, 10);
  const floors = new Set(rooms.map((r) => r.floor ?? "1")).size;
  const checkingOut = res.filter((r) => r.status === "Confirmed Check-In" && r.check_out_date === today).length;
  const todaySales = sales.filter((s) => saleDate(s) === today).reduce((t, s) => t + saleRevenue(s), 0);
  const upcoming = res.filter((r) => r.status === "Reserved" && r.check_in_date >= today);
  const activeReservations = res.filter((r) => r.status === "Reserved" || r.status === "Confirmed Check-In").length;
  const inHouseGuests = res
    .filter((r) => r.status === "Confirmed Check-In")
    .reduce((total, r) => total + (r.num_guests || 1), 0);
  const upcomingGuests = upcoming.reduce((total, r) => total + (r.num_guests || 1), 0);
  const tickerMessage = `Upcoming arrivals ${upcoming.length} | Active bookings ${activeReservations} | Guests in-house ${inHouseGuests} | Guests arriving ${upcomingGuests}`;

  useEffect(() => {
    const updateWindow = () => setAnnouncementWindowOpen(isGpmAnnouncementWindow(new Date()));
    updateWindow();
    const interval = window.setInterval(updateWindow, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!code) {
      setAnnouncement(null);
      setAnnouncementError("");
      return;
    }

    let active = true;
    const loadAnnouncement = async () => {
      try {
        const latest = await fetchLatestGpmAnnouncement();
        if (!active) return;
        setAnnouncement(latest);
        setAnnouncementError("");
      } catch (error: unknown) {
        if (!active) return;
        setAnnouncementError(
          error instanceof Error ? error.message : "The GILNET announcement could not be loaded.",
        );
      }
    };

    void loadAnnouncement();
    const interval = window.setInterval(() => void loadAnnouncement(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [code]);

  const displayedTickerMessage =
    announcementWindowOpen && announcement ? announcement.message : tickerMessage;

  return (
    <AppShell title="Room Status Dashboard" allow="rooms">
      <div className="mb-5 flex flex-wrap justify-end gap-2">
        {can(session?.role, "reports") && <ReportButton />}
        {can(session?.role, "frontdesk") && <Button asChild><Link to="/frontdesk">+ Add Booking</Link></Button>}
      </div>
      <section aria-label="Live property totals" className="dashboard-ticker mt-3 mb-5 flex h-9 min-w-0 items-center gap-2 rounded-md bg-[#0a2a5e] px-3 text-white">
        <span aria-hidden="true" className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] leading-none">LIVE</span>
        <div aria-hidden="true" className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs">
          <div className="dashboard-ticker-track flex w-max whitespace-nowrap">
            <span className="shrink-0 px-6">{displayedTickerMessage}</span>
            <span className="shrink-0 px-6">{displayedTickerMessage}</span>
          </div>
        </div>
        <p aria-live="polite" className="sr-only">{displayedTickerMessage}</p>
      </section>
      {announcementError && (
        <p role="alert" className="mb-5 text-xs text-destructive">
          GILNET announcements are unavailable: {announcementError}
        </p>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Total Rooms" value={rooms.length} note={`${floors} floor${floors === 1 ? "" : "s"}`} tone="text-foreground" cardTone="bg-card border-brand-border" icon={Building2} />
        <Stat label="Vacant Clean" value={rooms.filter((r) => r.status === "Available").length} note="Ready to sell" tone="text-room-available" cardTone="bg-status-confirmed border-brand-green/25" icon={TrendingUp} />
        <Stat label="Occupied" value={rooms.filter((r) => r.status === "Occupied").length} note={`${checkingOut} checking out today`} tone="text-room-occupied" cardTone="bg-status-cancelled border-room-occupied/25" icon={UserRound} />
        <Stat label="Dirty / Needs Cleaning" value={rooms.filter((r) => ["Dirty", "Cleaning"].includes(r.status)).length} note="Assigned to Housekeeping" tone="text-room-dirty" cardTone="bg-status-reserved border-room-dirty/30" icon={Brush} />
      </div>
      <NoticeBoardWidget />
      <div className="mt-6"><RoomStatusGrid /></div>
      {can(session?.role, "restaurant") && (
        <section className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
          <div><p className="text-sm text-muted-foreground">Restaurant sales today</p><p className="text-3xl font-bold">{money(todaySales)}</p></div>
          <Button asChild variant="outline"><Link to="/restaurant">Restaurant / POS</Link></Button>
        </section>
      )}
    </AppShell>
  );
}
