import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BellOff, Check, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  addRoom,
  checkOut,
  extendStay,
  markServiced,
  nextRoomNumber,
  postMessage,
  serviceRoom,
  setRoomStatus,
  type ServiceKind,
} from "@/lib/actions";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { formatLocalDateTime, money, paymentPlanFor, reservationPaid, reservationTotal, roomLabel, scheduledCheckout, sortRooms, stayTotal, nightsBetween } from "@/lib/payments";
import type { Property, Reservation, Room, RoomStatus } from "@/lib/types";
import type { VoiceClip } from "@/lib/useVoiceRecorder";
import { VoiceButton } from "./VoiceButton";
import { ConfirmCheckInDialog } from "./reservationDialogs";
import { ViaFooter } from "./AppShell";
import { roomFolio, type Sale } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

export const ROOM_STYLE: Record<RoomStatus, string> = {
  Available: "border border-room-available bg-room-available text-white",
  Occupied: "border border-room-occupied bg-room-occupied text-white",
  Dirty: "border border-room-dirty bg-room-dirty text-slate-950",
  Cleaning: "border border-room-dirty bg-room-dirty text-slate-950",
  "Out of Order": "border border-room-ooo bg-room-ooo text-white",
};
export const ROOM_LABEL: Record<RoomStatus, string> = {
  Available: "Vacant",
  Occupied: "Occupied",
  Dirty: "Needs Cleaning",
  Cleaning: "Cleaning",
  "Out of Order": "Out of Order",
};
const SERVICES: ServiceKind[] = ["Request Cleaning", "Maintenance Issue", "Guest Request", "Do Not Disturb", "Mark Out of Order"];
const LEGEND: [RoomStatus, string][] = [["Available", "Vacant"], ["Occupied", "Occupied"], ["Cleaning", "Cleaning"], ["Out of Order", "Out of Order"]];

export function RoomLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      {LEGEND.map(([status, label]) => <span key={label} className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded-full", ROOM_STYLE[status])} />{label}</span>)}
    </div>
  );
}

export function RoomStatusGrid({ mode = "all", title }: { mode?: "all" | "housekeeping"; title?: string }) {
  const session = useSession();
  const code = session?.property_code ?? "";
  const property = useStored<Property | null>(keys.property(code), null);
  const isApartment = property?.property_type === "Apartments";
  const unitLabel = isApartment ? "Apartment" : "Room";
  const rooms = sortRooms(useStored<Room[]>(keys.rooms(code), []));
  const reservations = useStored<Reservation[]>(keys.reservations(code), []);
  const sales = useStored<Sale[]>(keys.sales(code), []);
  const [active, setActive] = useState<Room | null>(null);
  const [search, setSearch] = useState("");
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [roomType, setRoomType] = useState("Standard");
  const [roomFloor, setRoomFloor] = useState("1");
  const [roomPrice, setRoomPrice] = useState("0");
  useEffect(() => {
    const listener = (e: Event) => setSearch((e as CustomEvent).detail);
    window.addEventListener("gilnet-search", listener);
    return () => window.removeEventListener("gilnet-search", listener);
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const reservedFor = (num: string) => reservations.find((r) => r.status === "Reserved" && r.preferred_room === num);
  const shown = rooms.filter((r) => `${r.number} ${roomLabel(r.number)} ${r.type} ${r.guestName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const current = active ? rooms.find((r) => r.number === active.number) ?? null : null;
  const openAddRoom = () => {
    setRoomNumber(nextRoomNumber(rooms));
    setRoomType(isApartment ? "1 Bedroom" : "Standard");
    setRoomFloor(rooms[rooms.length - 1]?.floor ?? "1");
    setRoomPrice("0");
    setAddRoomOpen(true);
  };
  const submitNewRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const room = addRoom({
        number: roomNumber,
        type: roomType,
        floor: roomFloor,
        price: Number(roomPrice),
      });
      toast.success(`Room ${room.number} added.`);
      setAddRoomOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the room.");
    }
  };

  return (
    <section>
      {mode === "all" && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              {title ?? (isApartment ? "Apartment Status Grid" : "Room Status Grid")}
            </h2>
            <p className="text-sm text-muted-foreground">Tap a room to change its status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {can(session?.role, "room_admin") && (
              <Button type="button" className="rounded-full" onClick={openAddRoom}>
                <Plus className="h-4 w-4" /> Add {isApartment ? "Apartment" : "Room"}
              </Button>
            )}
            <RoomLegend />
          </div>
        </div>
      )}
      <Dialog open={addRoomOpen} onOpenChange={setAddRoomOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add {isApartment ? "Apartment" : "Room"}</DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitNewRoom}>
            <div className="grid gap-2">
              <Label htmlFor="new-room-number">{isApartment ? "Apartment number" : "Room number"}</Label>
              <Input
                id="new-room-number"
                value={roomNumber}
                onChange={(event) => setRoomNumber(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-room-type">{isApartment ? "Apartment type" : "Room type"}</Label>
              <Input
                id="new-room-type"
                value={roomType}
                onChange={(event) => setRoomType(event.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="new-room-floor">Floor</Label>
                <Input
                  id="new-room-floor"
                  value={roomFloor}
                  onChange={(event) => setRoomFloor(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-room-price">Rate</Label>
                <Input
                  id="new-room-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={roomPrice}
                  onChange={(event) => setRoomPrice(event.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full rounded-full">
              Add {isApartment ? "Apartment" : "Room"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {!shown.length && <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{mode === "housekeeping" ? "No rooms need housekeeping right now." : "No rooms found."}</p>}
      <div className={mode === "housekeeping" ? "divide-y overflow-hidden rounded-xl border bg-card" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"}>
        {shown.map((room) => {
          const res = room.status === "Available" ? reservedFor(room.number) : undefined;
          const stay = room.reservationId ? reservations.find((item) => item.id === room.reservationId) : undefined;
          if (mode === "housekeeping") {
            const status = room.status === "Available"
              ? "Ready"
              : room.status === "Dirty" || room.status === "Cleaning"
                ? "Cleaning"
                : room.status === "Out of Order"
                  ? "Maintenance"
                  : "In house";
            return (
              <button
                type="button"
                key={room.number}
                onClick={() => setActive(room)}
                aria-label={`Room ${roomLabel(room.number)}, ${status}`}
                className="flex w-full items-center justify-between gap-4 px-4 py-5 text-left transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
              >
                <span className="min-w-0">
                  <span className="block text-lg font-semibold">{unitLabel} {roomLabel(room.number)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{room.type}</span>
                </span>
                <span className="flex min-w-32 items-center justify-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium">
                  {status}<ChevronRight className="h-4 w-4" />
                </span>
              </button>
            );
          }
          return (
            <button
              type="button"
              key={room.number}
              onClick={() => setActive(room)}
              aria-label={`${unitLabel} ${roomLabel(room.number)}, ${ROOM_LABEL[room.status]}`}
              className={cn("flex min-h-36 min-w-0 flex-col items-start rounded-2xl p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40", ROOM_STYLE[room.status])}
            >
              <span className="text-2xl font-extrabold leading-none">{unitLabel} {roomLabel(room.number)}</span>
              <span className="mt-2 text-xs font-medium opacity-90">{room.type} · Floor {room.floor ?? "1"}</span>
              <span className="mt-3 text-base font-bold">{ROOM_LABEL[room.status]}</span>
              {room.status === "Occupied" && (
                <>
                  <span className="mt-1 w-full truncate text-xs font-semibold uppercase">
                    {isApartment ? "Current occupant: " : ""}{room.guestName}
                  </span>
                  <span className="text-xs opacity-90">
                    {isApartment ? "Stay ends " : "Until "}
                    {res ? scheduledCheckout(res.check_out_date, res.check_out_time) : room.checkOut}
                  </span>
                  {stay && <>
                    <span className="text-xs opacity-90">Checked in {formatLocalDateTime(stay.confirmed_at) || "time not recorded"}</span>
                    <span className="text-xs opacity-90">{stay.payment_plan ?? paymentPlanFor(reservationPaid(stay), reservationTotal(stay))} · Balance {money(Math.max(0, roomFolio(stay, sales) - reservationPaid(stay)))}</span>
                  </>}
                  {room.serviced_at === today && <span className="mt-1 flex items-center gap-1 text-xs font-bold"><Check className="h-3.5 w-3.5" /> Serviced</span>}
                </>
              )}
              {room.dnd && <span className="mt-1 flex items-center gap-1 text-xs font-bold"><BellOff className="h-3.5 w-3.5" /> Do Not Disturb</span>}
              {res && <span className="mt-auto rounded-md bg-card/90 px-2 py-0.5 text-[11px] font-semibold text-foreground">Reserved: {res.guest_name} · {res.check_in_date}</span>}
            </button>
          );
        })}
      </div>
      <RoomActionDialog
        room={current}
        reservations={reservations}
        onClose={() => setActive(null)}
        reservedFor={reservedFor}
        isApartment={isApartment}
      />
    </section>
  );
}

function RoomActionDialog({ room, reservations, onClose, reservedFor, isApartment }: { room: Room | null; reservations: Reservation[]; onClose: () => void; reservedFor: (n: string) => Reservation | undefined; isApartment: boolean }) {
  const session = useSession();
  const role = session?.role;
  const navigate = useNavigate();
  const sales = useStored<Sale[]>(keys.sales(session?.property_code ?? ""), []);
  const [view, setView] = useState<"menu" | "checkout" | "extend" | ServiceKind | "issue">("menu");
  const [checkInRes, setCheckInRes] = useState<Reservation | null>(null);
  const close = () => { setView("menu"); onClose(); };
  const res = room ? reservations.find((r) => r.id === room.reservationId) : undefined;
  const reserved = room?.status === "Available" ? reservedFor(room.number) : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const done = (fn: () => void) => () => { fn(); close(); };

  return (
    <>
      <Dialog open={!!room} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl">
          {room && (
            <>
              <DialogHeader><DialogTitle>{isApartment ? "Apartment" : "Room"} {roomLabel(room.number)} · {ROOM_LABEL[room.status]}</DialogTitle></DialogHeader>
              <div className={cn("rounded-2xl p-4", ROOM_STYLE[room.status])}>
                <p className="text-sm font-medium">{room.type} · Floor {room.floor ?? "1"} · Rate {money(room.price ?? 0)}</p>
                {room.status === "Occupied" && (
                  <div className="mt-2 text-sm">
                    <p className="font-bold uppercase">{room.guestName}</p>
                    <p>{room.checkIn} → {res ? scheduledCheckout(res.check_out_date, res.check_out_time) : room.checkOut} · PAX {room.pax ?? res?.num_guests ?? 1}</p>
                    {res && <>
                      <p>Checked in {formatLocalDateTime(res.confirmed_at) || "time not recorded"} by {res.confirmed_by ?? "Unknown"} ({res.confirmed_role ?? "Unknown"})</p>
                      <p>Payment {res.payment_plan ?? paymentPlanFor(reservationPaid(res), reservationTotal(res))} · Paid {money(reservationPaid(res))} · Folio balance {money(Math.max(0, roomFolio(res, sales) - reservationPaid(res)))}</p>
                      {res.payment_due_date && <p>Balance due {res.payment_due_date}: {res.payment_reason ?? "No reason recorded"}</p>}
                      {(res.stay_extensions ?? []).map((extension, index) => (
                        <p key={`${extension.changed_at}-${index}`}>
                          Extended {extension.from_date} {extension.from_time ?? ""} → {extension.to_date} {extension.to_time} by {extension.changed_by} ({extension.changed_role}) on {formatLocalDateTime(extension.changed_at)}. Reason: {extension.reason}
                        </p>
                      ))}
                    </>}
                  </div>
                )}
              </div>

              {view === "menu" && (
                <div className="grid gap-2">
                  {room.status === "Available" && can(role, "checkin") && (
                    <Button className="rounded-full" onClick={() => { close(); navigate({ to: "/frontdesk", search: { room: room.number } }); }}>Check in guest</Button>
                  )}
                  {reserved && can(role, "checkin") && (
                    <Button variant="secondary" className="rounded-full" onClick={() => { setCheckInRes(reserved); close(); }}>Check-In Reserved Guest ({reserved.guest_name})</Button>
                  )}
                  {room.status === "Occupied" && can(role, "checkout") && (
                    <>
                      <Button className="rounded-full bg-brand-navy text-primary-foreground hover:bg-brand-navy/90" onClick={() => setView("checkout")}>Check-Out</Button>
                      <Button variant="outline" className="rounded-full" onClick={() => setView("extend")}>Extend Stay</Button>
                    </>
                  )}
                  {room.status === "Occupied" && can(role, "housekeeping") && room.serviced_at !== today && (
                    <Button variant="outline" className="rounded-full" onClick={done(() => markServiced(room))}><Check /> Mark Serviced</Button>
                  )}
                  {room.status === "Available" && can(role, "room_clean") && (
                    <Button variant="outline" className="rounded-full" onClick={done(() => setRoomStatus(room.number, "Cleaning"))}>Mark Cleaning</Button>
                  )}
                  {room.status === "Dirty" && can(role, "room_clean") && (
                    <Button variant="outline" className="rounded-full" onClick={done(() => setRoomStatus(room.number, "Cleaning"))}>Start Cleaning</Button>
                  )}
                  {(room.status === "Dirty" || room.status === "Cleaning") && can(role, "room_clean") && (
                    <Button className="rounded-full" onClick={done(() => setRoomStatus(room.number, "Available"))}><Check /> Mark Clean (Vacant)</Button>
                  )}
                  {room.status === "Out of Order" && can(role, "out_of_order") && (
                    <Button className="rounded-full" onClick={done(() => { setRoomStatus(room.number, "Available"); postMessage("Front Desk", `Room ${room.number} is back in service`); })}>Back in Service (Vacant)</Button>
                  )}
                  {room.status !== "Occupied" && room.status !== "Out of Order" && can(role, "out_of_order") && !can(role, "service") && (
                    <Button variant="outline" className="rounded-full" onClick={done(() => { setRoomStatus(room.number, "Out of Order"); postMessage("Front Desk", `Room ${room.number} marked Out of Order by Maintenance`); })}>Mark Out of Order</Button>
                  )}
                  {can(role, "service") && SERVICES.filter((k) => !(k === "Mark Out of Order" && room.status === "Occupied")).map((k) => (
                    <Button key={k} variant="outline" className="rounded-full" onClick={() => setView(k)}>{k === "Do Not Disturb" && room.dnd ? "Remove Do Not Disturb" : k}</Button>
                  ))}
                  {!can(role, "service") && can(role, "rooms") && (
                    <Button variant="outline" className="rounded-full" onClick={() => setView("issue")}>Report Issue to Maintenance</Button>
                  )}
                </div>
              )}
              {view === "checkout" && <CheckoutForm room={room} res={res} sales={sales} onDone={close} />}
              {view === "extend" && <ExtendForm room={room} res={res} onDone={close} />}
              {view === "issue" && <IssueForm room={room} onDone={close} />}
              {SERVICES.includes(view as ServiceKind) && <ServiceForm room={room} kind={view as ServiceKind} onDone={close} />}
              {view !== "menu" && <Button variant="ghost" onClick={() => setView("menu")}>Back</Button>}
              <ViaFooter />
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmCheckInDialog res={checkInRes} onClose={() => setCheckInRes(null)} />
    </>
  );
}

function CheckoutForm({ room, res, sales, onDone }: { room: Room; res: Reservation | undefined; sales: Sale[]; onDone: () => void }) {
  const due = res ? Math.max(0, roomFolio(res, sales) - reservationPaid(res)) : 0;
  const [dueDate, setDueDate] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm">Amount due: <b>{money(due)}</b>{res && due === 0 && " · fully paid"}</p>
      {due > 0 && (
        <>
          <div><Label htmlFor="co-due-date">Balance due date</Label><Input id="co-due-date" type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div><Label htmlFor="co-reason">Reason for remaining balance</Label><Input id="co-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </>
      )}
      <p className="text-xs text-muted-foreground">Room will be marked Needs Cleaning and a task sent to Housekeeping.</p>
      <Button className="w-full rounded-full" disabled={due > 0 && (!dueDate || !reason.trim())} onClick={() => {
        try {
          checkOut(room, due === 0 ? "Paid" : "Unpaid", { total: res ? roomFolio(res, sales) : 0, payment_due_date: dueDate, payment_reason: reason });
          toast.success("Guest checked out.");
          onDone();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not check out the guest.");
        }
      }}>Confirm Check-Out</Button>
    </div>
  );
}

function ExtendForm({ room, res, onDone }: { room: Room; res: Reservation | undefined; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const start = new Date(`${room.checkOut ?? new Date().toISOString().slice(0, 10)}T00:00:00`);
    start.setDate(start.getDate() + 1);
    return start.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState(res?.check_out_time ?? "11:00");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const newTotal = res
    ? res.rate != null
      ? stayTotal(res.rate, nightsBetween(res.check_in_date, date), res.payment_method, res.discount ?? 0)
      : reservationTotal(res)
    : 0;
  const remaining = res ? Math.max(0, newTotal - reservationPaid(res)) : 0;
  return (
    <div className="space-y-3">
      <Label htmlFor="extend-date">New check-out date (current {room.checkOut})</Label>
      <Input id="extend-date" type="date" min={room.checkOut ?? undefined} value={date} onChange={(e) => setDate(e.target.value)} />
      <Label htmlFor="extend-time">New check-out time</Label>
      <Input id="extend-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <Label htmlFor="extend-reason">Reason for extension</Label>
      <Input id="extend-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      {remaining > 0 && <>
        <Label htmlFor="extend-due-date">Balance due date</Label>
        <Input id="extend-due-date" type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <p className="text-sm">New stay balance: <b>{money(remaining)}</b></p>
      </>}
      <Button className="w-full rounded-full" disabled={!date || !time || !reason.trim() || (remaining > 0 && !dueDate)} onClick={() => {
        try {
          extendStay(room, date, time, reason, dueDate);
          toast.success("Stay extension recorded.");
          onDone();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not extend the stay.");
        }
      }}>Save</Button>
    </div>
  );
}

function ServiceForm({ room, kind, onDone }: { room: Room; kind: ServiceKind; onDone: () => void }) {
  const [details, setDetails] = useState("");
  const [voice, setVoice] = useState<VoiceClip | null>(null);
  return (
    <div className="space-y-3">
      <p className="font-semibold">{kind}</p>
      <Textarea placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
      <VoiceButton value={voice} onChange={setVoice} label="Hold to add a voice note" />
      <Button className="w-full rounded-full" onClick={() => { serviceRoom(room, kind, details, voice); onDone(); }}>Send</Button>
    </div>
  );
}

function IssueForm({ room, onDone }: { room: Room; onDone: () => void }) {
  const [details, setDetails] = useState("");
  return (
    <div className="space-y-3">
      <Textarea placeholder="Describe the issue" value={details} onChange={(e) => setDetails(e.target.value)} />
      <Button className="w-full rounded-full" disabled={!details.trim()} onClick={() => { postMessage("Maintenance", `Room ${room.number}: ${details.trim()}`, { room_number: room.number }); onDone(); }}>Send to Maintenance</Button>
    </div>
  );
}
