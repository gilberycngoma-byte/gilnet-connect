import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { AppShell, ViaFooter } from "@/components/gpm/AppShell";
import { CancelDialog, ConfirmCheckInDialog, NoShowDialog } from "@/components/gpm/reservationDialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addReservation, getRooms, undoNoShow } from "@/lib/actions";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { APP_NAME } from "@/lib/version";
import { paymentPlanFor } from "@/lib/payments";
import type { Property, Reservation, ReservationStatus, Room } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reservations")({
  validateSearch: (search: Record<string, unknown>): { add: boolean } => ({
    add: search["add"] === true || search["add"] === "true",
  }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Reservations - ${APP_NAME}` },
      { name: "description", content: "Manage reservations, confirm check-ins, cancellations and no-shows." },
      { property: "og:title", content: `Reservations - ${APP_NAME}` },
      { property: "og:description", content: "Confirm check-ins, cancellations and no-shows." },
    ],
  }),
  component: ReservationsPage,
});

const BADGE: Record<ReservationStatus, string> = {
  Reserved: "bg-status-reserved text-brand-amber",
  "Confirmed Check-In": "bg-status-confirmed text-accent-foreground",
  Cancelled: "bg-status-cancelled text-destructive",
  "Checked-Out": "bg-muted text-muted-foreground",
  "No-Show": "bg-status-noshow text-status-noshow-fg",
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const formatDate = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options);
const TABS = ["All guests", "Arrivals", "Departures", "In house"] as const;
type Tab = (typeof TABS)[number];

function ReservationsPage() {
  const session = useSession();
  const { add: addFromPageLink } = Route.useSearch();
  const navigate = useNavigate();
  const code = session?.property_code ?? "";
  const property = useStored<Property | null>(keys.property(code), null);
  const rooms = useStored<Room[]>(keys.rooms(code), []);
  const list = useStored<Reservation[]>(keys.reservations(code), []);
  const [tab, setTab] = useState<Tab>("All guests");
  const [selectedDate, setSelectedDate] = useState(today);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPotentialOnly, setShowPotentialOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(addFromPageLink);
  const [checkIn, setCheckIn] = useState<Reservation | null>(null);
  const [cancel, setCancel] = useState<Reservation | null>(null);
  const [noShow, setNoShow] = useState<Reservation | null>(null);
  const role = session?.role;

  const potential = list.filter((r) => r.status === "Reserved" && r.check_in_date < today());
  const tabCounts: Record<Tab, number> = {
    "All guests": list.length,
    Arrivals: list.filter((r) => r.check_in_date === selectedDate && r.status !== "Cancelled" && r.status !== "No-Show" && r.status !== "Checked-Out").length,
    Departures: list.filter((r) => r.check_out_date === selectedDate && r.status === "Confirmed Check-In").length,
    "In house": list.filter((r) => r.check_in_date <= selectedDate && r.check_out_date > selectedDate && r.status === "Confirmed Check-In").length,
  };
  const shown = list.filter((r) => {
    if (showPotentialOnly && !potential.includes(r)) return false;
    if (tab === "Arrivals" && (r.check_in_date !== selectedDate || ["Cancelled", "No-Show", "Checked-Out"].includes(r.status))) return false;
    if (tab === "Departures" && (r.check_out_date !== selectedDate || r.status !== "Confirmed Check-In")) return false;
    if (tab === "In house" && !(r.check_in_date <= selectedDate && r.check_out_date > selectedDate && r.status === "Confirmed Check-In")) return false;
    const query = search.trim().toLowerCase();
    return !query || `${r.guest_name} ${r.room_number ?? ""} ${r.preferred_room ?? ""} ${r.phone ?? ""} ${r.id}`.toLowerCase().includes(query);
  });

  const exportReservations = () => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      ["Guest", "Room", "Check-in", "Check-out", "Guests", "Status"],
      ...shown.map((r) => [r.guest_name, r.room_number ?? r.preferred_room ?? "", r.check_in_date, r.check_out_date, r.num_guests, r.status]),
    ];
    const csv = rows.map((row) => row.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reservations-${selectedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Reservations" hidePageHeading>
      <div className="mb-10 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your property, at a glance</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Reservations</h1>
          <p className="mt-2 text-muted-foreground">{property?.name ?? code} · Sample workspace</p>
        </div>
        {can(role, "reservation_add") && (
          <Button className="rounded-xl px-5 py-5" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New reservation</Button>
        )}
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Reservations</h2>
          <p className="mt-2 text-sm text-muted-foreground">A warm welcome, and a smooth farewell.</p>
        </div>
        <div className="flex items-center rounded-lg border bg-card">
          <button type="button" aria-label="Previous day" className="p-3" onClick={() => setSelectedDate((date) => shiftDate(date, -1))}><ChevronLeft className="h-4 w-4" /></button>
          <label className="relative flex cursor-pointer items-center gap-2 px-1 text-sm">
            <CalendarDays className="h-4 w-4" />
            <span>{formatDate(selectedDate, { day: "2-digit", month: "short", year: "numeric" })}</span>
            <input aria-label="Reservation date" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} />
          </label>
          <button type="button" aria-label="Next day" className="p-3" onClick={() => setSelectedDate((date) => shiftDate(date, 1))}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      {potential.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-amber/40 bg-status-reserved p-4">
          <AlertTriangle className="h-5 w-5 text-brand-amber" />
          <p className="font-semibold">{potential.length} potential No-Show{potential.length > 1 ? "s" : ""}</p>
          <Button size="sm" variant="outline" className="ml-auto rounded-full" onClick={() => { setTab("All guests"); setShowPotentialOnly(true); }}>Review</Button>
        </div>
      )}
      <div className="mb-0 flex flex-wrap items-center gap-2 border-b">
        {TABS.map((item) => (
          <button key={item} onClick={() => { setTab(item); setShowPotentialOnly(false); }} className={cn("border-b-2 px-4 py-3 text-sm font-medium", tab === item && !showPotentialOnly ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
            {item}{item === "All guests" && <span className="ml-3 rounded-md bg-primary/10 px-2 py-1 text-xs">{tabCounts[item]}</span>}
          </button>
        ))}
        {showPotentialOnly && <Button size="sm" variant="outline" className="ml-auto rounded-full" onClick={() => setShowPotentialOnly(false)}>Clear potential No-Shows</Button>}
      </div>
      <div className="flex items-center justify-between gap-3 border-b py-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search guests, room or reservation" className="border-0 pl-10 shadow-none focus-visible:ring-0" placeholder="Search guests, room or reservation..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Export reservations" onClick={exportReservations}><Download className="h-5 w-5" /></Button>
      </div>

      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(80px,1fr)_minmax(130px,1.3fr)_minmax(120px,1fr)_24px] bg-muted/50 text-xs font-medium text-muted-foreground md:grid">
        {["Guest", "Room", "Stay", "Status", ""].map((heading) => <div key={heading || "actions"} className="px-3 py-4">{heading}</div>)}
      </div>
      {!shown.length ? (
        <p className="rounded-b-xl border border-t-0 p-10 text-center text-sm text-muted-foreground">No reservations here yet.</p>
      ) : shown.map((r) => {
        const late = potential.includes(r);
        const activeStatus = r.status === "Confirmed Check-In"
          ? r.check_out_date === selectedDate ? "Departing" : tab === "In house" ? "In house" : r.status
          : r.status === "Reserved" && r.check_in_date === selectedDate ? "Arriving" : r.status;
        const guestInitials = r.guest_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
        return (
          <article key={r.id} className="border-b">
            <button type="button" aria-expanded={expanded === r.id} onClick={() => setExpanded((current) => current === r.id ? null : r.id)} className="grid w-full grid-cols-2 items-center gap-y-3 px-3 py-5 text-left transition hover:bg-muted/30 md:grid-cols-[minmax(0,2fr)_minmax(80px,1fr)_minmax(130px,1.3fr)_minmax(120px,1fr)_24px]">
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{guestInitials}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.guest_name}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{r.phone || `${r.num_guests} guest(s)`}</span>
                </span>
              </span>
              <span className="text-sm font-medium">{r.room_number ?? r.preferred_room ?? "—"}<span className="mt-1 block text-xs text-muted-foreground">{r.room_number ? rooms.find((room) => room.number === r.room_number)?.type ?? "Assigned room" : r.preferred_room ? "Preferred room" : "Unassigned"}</span></span>
              <span className="text-sm">{formatDate(r.check_in_date, { day: "2-digit", month: "short" })} – {formatDate(r.check_out_date, { day: "2-digit", month: "short" })}<span className="mt-1 block text-xs text-muted-foreground">{formatDate(r.check_in_date, { month: "long", year: "numeric" })}</span></span>
              <span className="col-span-2 flex items-center justify-between gap-2 md:col-span-1">
                <span className={cn("rounded-md px-3 py-2 text-xs font-medium", activeStatus === "Departing" || activeStatus === "Arriving" ? "bg-orange-50 text-orange-700" : BADGE[r.status])}>
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-current" />{activeStatus}
                </span>
                <ChevronRight className={cn("h-5 w-5 transition-transform md:ml-auto", expanded === r.id && "rotate-90")} />
              </span>
            </button>
            {expanded === r.id && (
              <div className="border-t bg-muted/20 px-4 py-4">
                {r.status === "No-Show" && <p className="mb-3 text-sm text-muted-foreground">Reason: {r.noShowReason}{r.noShowFee ? ` · Fee ${r.noShowFee}` : ""}</p>}
                {r.status === "Cancelled" && <p className="mb-3 text-sm text-muted-foreground">Reason: {r.cancellation_reason}</p>}
                <div className="flex flex-wrap gap-2">
                  {r.status === "Reserved" && can(role, "checkin") && (
                    <>
                      <Button size="sm" onClick={() => setCheckIn(r)}>{late ? "Confirm Late Check-In" : "Confirm Check-In"}</Button>
                      <Button size="sm" variant="destructive" onClick={() => setCancel(r)}>Cancel</Button>
                      <Button size="sm" variant="outline">Keep Reserved</Button>
                      <Button size="sm" className="bg-status-noshow-fg text-primary-foreground hover:bg-status-noshow-fg/90" onClick={() => setNoShow(r)}>No-Show</Button>
                    </>
                  )}
                  {r.status === "Confirmed Check-In" && (
                    <>
                      <Button size="sm" variant="outline" asChild><Link to="/dashboard">View Room</Link></Button>
                      <Button size="sm" className="bg-brand-navy text-primary-foreground hover:bg-brand-navy/90" asChild><Link to="/dashboard">Check-Out</Link></Button>
                    </>
                  )}
                  {r.status === "No-Show" && can(role, "undo_noshow") && <Button size="sm" variant="outline" onClick={() => undoNoShow(r)}>Undo No-Show</Button>}
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground">via {APP_NAME}</p>
              </div>
            )}
          </article>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
        <span className="text-muted-foreground">Showing {shown.length} of {showPotentialOnly ? potential.length : list.length} reservations</span>
        <button type="button" className="inline-flex items-center gap-2 font-medium text-primary" onClick={() => { setTab("All guests"); setShowPotentialOnly(false); setSearch(""); }}>All reservations <span aria-hidden="true">↗</span></button>
      </div>

      <AddReservationDialog open={addOpen} onOpenChange={(open) => {
        setAddOpen(open);
        if (!open && addFromPageLink) void navigate({ to: "/reservations", search: { add: false }, replace: true });
      }} />
      <ConfirmCheckInDialog res={checkIn} onClose={() => setCheckIn(null)} />
      <CancelDialog res={cancel} onClose={() => setCancel(null)} />
      <NoShowDialog res={noShow} onClose={() => setNoShow(null)} />
    </AppShell>
  );
}

function AddReservationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [guest, setGuest] = useState("");
  const [inD, setIn] = useState(today());
  const [outD, setOut] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [outTime, setOutTime] = useState("11:00");
  const [n, setN] = useState("1");
  const [amount, setAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [reason, setReason] = useState("");
  const [pref, setPref] = useState("none");
  const rooms: Room[] = open ? getRooms() : [];
  const total = Number(amount) || 0;
  const paid = Number(amountPaid) || 0;
  const balance = Math.max(0, total - paid);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Add Reservation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="g">Guest name</Label><Input id="g" value={guest} onChange={(e) => setGuest(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="ci">Check-in</Label><Input id="ci" type="date" value={inD} onChange={(e) => setIn(e.target.value)} /></div>
            <div><Label htmlFor="co">Check-out</Label><Input id="co" type="date" value={outD} onChange={(e) => setOut(e.target.value)} /></div>
            <div><Label htmlFor="co-time">Scheduled check-out time</Label><Input id="co-time" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} /></div>
            <div><Label htmlFor="ng">Guests</Label><Input id="ng" type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} /></div>
            <div><Label htmlFor="amt">Total amount</Label><Input id="amt" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label htmlFor="amount-paid">Amount paid</Label><Input id="amount-paid" type="number" min={0} max={total} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} /></div>
            <div><Label htmlFor="payment-plan">Payment plan</Label><Input id="payment-plan" value={paymentPlanFor(paid, total)} readOnly /></div>
            {balance > 0 && <>
              <div><Label htmlFor="reservation-due-date">Balance due date</Label><Input id="reservation-due-date" type="date" min={today()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div><Label htmlFor="reservation-payment-reason">Reason for balance</Label><Input id="reservation-payment-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            </>}
          </div>
          <div><Label>Preferred room (optional)</Label>
            <Select value={pref} onValueChange={setPref}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No preference</SelectItem>
                {rooms.map((r) => <SelectItem key={r.number} value={r.number}>Room {r.number} · {r.type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">The room stays Available until you confirm check-in.</p>
          <Button className="w-full rounded-full" disabled={!guest.trim() || outD <= inD || paid > total || (balance > 0 && (!dueDate || !reason.trim()))} onClick={() => {
            addReservation({
              guest_name: guest.trim(), check_in_date: inD, check_out_date: outD, check_out_time: outTime,
              num_guests: Number(n) || 1, total_amount: total, amount_paid: paid,
              payment_plan: paymentPlanFor(paid, total), payment_due_date: dueDate, payment_reason: reason,
              preferred_room: pref === "none" ? null : pref,
            });
            setGuest(""); setAmount(""); setAmountPaid("0"); setDueDate(""); setReason(""); setPref("none");
            onOpenChange(false);
          }}>Save Reservation</Button>
          <ViaFooter />
        </div>
      </DialogContent>
    </Dialog>
  );
}
