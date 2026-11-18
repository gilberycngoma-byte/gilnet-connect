import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { BedDouble, LogIn, LogOut, Users } from "lucide-react";
import { AppShell, ViaFooter } from "@/components/gpm/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkOut, getRooms, recordPayment, walkInCheckIn } from "@/lib/actions";
import { useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { PAYMENT_METHODS, money, nextReceiptNo, nightsBetween, paymentPlanFor, reservationPaid, roomLabel, scheduledCheckout, sortRooms, stayTotal } from "@/lib/payments";
import { roomFolio, settleOrder, type MenuItem, type Sale, type SaleMethod } from "@/lib/restaurant";
import { APP_NAME } from "@/lib/version";
import type { Property, Reservation, Room } from "@/lib/types";

export const Route = createFileRoute("/frontdesk")({
  validateSearch: (s: Record<string, unknown>): { room?: string } => (typeof s["room"] === "string" ? { room: s["room"] } : {}),
  head: () => ({
    meta: [
      { title: `Front Desk - ${APP_NAME}` },
      { name: "description", content: "Check in guests, take payments and see who is staying tonight." },
      { property: "og:title", content: `Front Desk - ${APP_NAME}` },
      { property: "og:description", content: "Guest check-in, payments, PAX and current guests." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FrontDesk,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const FD_METHODS = [...PAYMENT_METHODS, "Pending"] as const;
const field = "mt-1 w-full rounded-md border bg-card px-3 py-2 text-sm";

function FrontDesk() {
  const session = useSession();
  const code = session?.property_code ?? "";
  const { room: preset } = Route.useSearch();
  const property = useStored<Property | null>(keys.property(code), null);
  const rooms = sortRooms(useStored<Room[]>(keys.rooms(code), []));
  const reservations = useStored<Reservation[]>(keys.reservations(code), []);
  const sales = useStored<Sale[]>(keys.sales(code), []);
  const menu = useStored<MenuItem[]>(keys.menu(code), []);
  const vacant = rooms.filter((r) => r.status === "Available");
  const occupied = rooms.filter((r) => r.status === "Occupied");
  const today = iso(new Date());

  const [guest, setGuest] = useState("");
  const [phone, setPhone] = useState("");
  const [room, setRoom] = useState("");
  const [method, setMethod] = useState<string>("Cash");
  const [inD, setIn] = useState(today);
  const [outD, setOut] = useState(iso(new Date(Date.now() + 86400000)));
  const [outTime, setOutTime] = useState("11:00");
  const [rate, setRate] = useState("0");
  const [pax, setPax] = useState("1");
  const [paid, setPaid] = useState("0");
  const [receipt, setReceipt] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const [payFor, setPayFor] = useState<Reservation | null>(null);
  const [outFor, setOutFor] = useState<Reservation | null>(null);
  const [checkoutDueDate, setCheckoutDueDate] = useState("");
  const [checkoutReason, setCheckoutReason] = useState("");
  const [laundryRoom, setLaundryRoom] = useState("");
  const [laundryItem, setLaundryItem] = useState("");
  const [laundryCustom, setLaundryCustom] = useState("");
  const [laundryQty, setLaundryQty] = useState("1");
  const [laundryPrice, setLaundryPrice] = useState("0");
  const [laundryMethod, setLaundryMethod] = useState<SaleMethod>("Cash");

  useEffect(() => { if (preset && vacant.some((r) => r.number === preset)) pickRoom(preset); }, [preset, vacant.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickRoom = (n: string) => { setRoom(n); const r = rooms.find((x) => x.number === n); if (r?.price) setRate(String(r.price)); };

  const nights = nightsBetween(inD, outD);
  const total = stayTotal(Number(rate) || 0, nights, method);
  const paidNow = method === "Complimentary" || method === "Pending" ? 0 : Number(paid) || 0;
  const balance = Math.max(0, total - paidNow);
  const suggest = () => nextReceiptNo(property?.name ?? code, reservations.map((r) => r.receipt_no));

  const inHouse = reservations.filter((r) => r.status === "Confirmed Check-In");
  const stats = useMemo(() => [
    { label: "Guests in house (PAX)", value: inHouse.reduce((s, r) => s + (r.num_guests || 1), 0), icon: Users },
    { label: "Occupied rooms", value: rooms.filter((r) => r.status === "Occupied").length, icon: BedDouble },
    { label: "Check-ins today", value: reservations.filter((r) => r.status === "Confirmed Check-In" && r.check_in_date === today).length, icon: LogIn },
    { label: "Check-outs today", value: inHouse.filter((r) => r.check_out_date === today).length, icon: LogOut },
  ], [inHouse, rooms, reservations, today]);

  const submit = () => {
    try {
      if (!guest.trim()) throw new Error("Enter the guest name.");
      if (!room) throw new Error("Select a vacant room.");
      if ((Number(pax) || 0) < 1) throw new Error("PAX must be at least 1.");
      if (paidNow > 0 && !receipt.trim()) throw new Error("Enter a receipt number for the payment.");
      walkInCheckIn({
        guest_name: guest.trim(), phone: phone.trim(), room_number: room, pax: Number(pax) || 1,
        check_in_date: inD, check_out_date: outD, check_out_time: outTime, rate: Number(rate) || 0,
        amount_paid: paidNow, payment_plan: paymentPlanFor(paidNow, total),
        payment_due_date: paymentDueDate, payment_reason: paymentReason,
        payment_method: method, receipt_no: receipt.trim(), notes: notes.trim(),
      });
      toast.success(`${guest.trim()} checked in to Room ${roomLabel(room)}`);
      setGuest(""); setPhone(""); setRoom(""); setPaid("0"); setReceipt(""); setNotes(""); setPax("1"); setMethod("Cash"); setPaymentDueDate(""); setPaymentReason("");
    } catch (e) { toast.error((e as Error).message); }
  };
  const addLaundry = () => {
    try {
      if (!laundryRoom) throw new Error("Select an occupied guest room.");
      const itemName = laundryItem === "custom" ? laundryCustom.trim() : menu.find((item) => item.id === laundryItem)?.name ?? "";
      const quantity = Math.floor(Number(laundryQty));
      const price = Number(laundryPrice);
      settleOrder([{ name: itemName, quantity, price }], laundryMethod, laundryRoom, { service: "Laundry" });
      toast.success("Laundry charge recorded.");
      setLaundryRoom(""); setLaundryItem(""); setLaundryCustom(""); setLaundryQty("1"); setLaundryPrice("0"); setLaundryMethod("Cash");
    } catch (e) { toast.error((e as Error).message); }
  };
  const laundryTotal = laundryMethod === "Complimentary" ? 0 : Math.round((Number(laundryQty) || 0) * (Number(laundryPrice) || 0) * 100) / 100;

  return (
    <AppShell title="Front Desk" allow="frontdesk">
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border bg-card p-4 shadow-sm">
            <s.icon className="h-5 w-5 text-primary" />
            <p className="mt-2 text-3xl font-extrabold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="md:col-span-2 xl:col-span-1"><FieldLabel htmlFor="g">Guest name</FieldLabel><Input id="g" className="mt-1" value={guest} onChange={(e) => setGuest(e.target.value)} /></div>
          <div><FieldLabel htmlFor="ph">Phone</FieldLabel><Input id="ph" className="mt-1" placeholder="e.g. 0977 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><FieldLabel htmlFor="rm">Room</FieldLabel>
            <select id="rm" className={field} value={room} onChange={(e) => pickRoom(e.target.value)}>
              <option value="">Select vacant room</option>
              {vacant.map((r) => <option key={r.number} value={r.number}>Room {roomLabel(r.number)} · {r.type}</option>)}
            </select>
          </div>
          <div><FieldLabel htmlFor="pm">Payment method</FieldLabel>
            <select id="pm" className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
              {FD_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><FieldLabel htmlFor="ci">Check-in</FieldLabel><Input id="ci" className="mt-1" type="date" value={inD} onChange={(e) => setIn(e.target.value)} /></div>
          <div><FieldLabel htmlFor="co">Check-out</FieldLabel><Input id="co" className="mt-1" type="date" min={inD} value={outD} onChange={(e) => setOut(e.target.value)} /></div>
          <div><FieldLabel htmlFor="co-time">Scheduled check-out time</FieldLabel><Input id="co-time" className="mt-1" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} /></div>
          <div><FieldLabel htmlFor="rt">Rate / night (K)</FieldLabel><Input id="rt" className="mt-1" type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div><FieldLabel htmlFor="px">PAX (number of guests)</FieldLabel><Input id="px" className="mt-1" type="number" min="1" value={pax} onChange={(e) => setPax(e.target.value)} /></div>
          <div><FieldLabel htmlFor="ap">Amount paid (K)</FieldLabel><Input id="ap" className="mt-1" type="number" min="0" disabled={method === "Complimentary" || method === "Pending"} value={method === "Complimentary" || method === "Pending" ? "0" : paid} onChange={(e) => setPaid(e.target.value)} /></div>
          <div><FieldLabel htmlFor="rc">Receipt number (optional if unpaid)</FieldLabel>
            <div className="mt-1 flex gap-2"><Input id="rc" placeholder={suggest()} value={receipt} onChange={(e) => setReceipt(e.target.value)} /><Button type="button" variant="outline" onClick={() => setReceipt(suggest())}>Suggest Next Number</Button></div>
          </div>
          <div className="md:col-span-2"><FieldLabel htmlFor="nt">Special requests / notes</FieldLabel><Textarea id="nt" className="mt-1" placeholder="e.g. extra towels, early breakfast" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-brand-soft p-4 sm:grid-cols-4">
          {[["Nights", String(nights)], ["Room revenue", money(total)], ["Payment plan", paymentPlanFor(paidNow, total)], ["Balance", money(balance)]].map(([l, v]) => (
            <div key={l}><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{l}</p><p className="mt-1 text-lg font-bold">{v}</p></div>
          ))}
        </div>
        {balance > 0 && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><FieldLabel htmlFor="payment-due-date">Balance due date</FieldLabel><Input id="payment-due-date" className="mt-1" type="date" min={today} value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} /></div>
            <div><FieldLabel htmlFor="payment-reason">Reason for balance</FieldLabel><Input id="payment-reason" className="mt-1" value={paymentReason} onChange={(e) => setPaymentReason(e.target.value)} /></div>
          </div>
        )}
        <Button className="mt-5 rounded-full px-8" onClick={submit}>Check in guest</Button>
      </section>

      <section className="mt-8 rounded-3xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-bold">Laundry service</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div><FieldLabel htmlFor="laundry-room">Guest room</FieldLabel>
            <select id="laundry-room" className={field} value={laundryRoom} onChange={(e) => setLaundryRoom(e.target.value)}>
              <option value="">Select occupied room</option>
              {occupied.map((r) => <option key={r.number} value={r.number}>Room {roomLabel(r.number)} · {r.guestName}</option>)}
            </select>
          </div>
          <div><FieldLabel htmlFor="laundry-item">Laundry item</FieldLabel>
            <select id="laundry-item" className={field} value={laundryItem} onChange={(e) => {
              const value = e.target.value;
              setLaundryItem(value);
              const selected = menu.find((item) => item.id === value);
              if (selected) setLaundryPrice(String(selected.price));
            }}>
              <option value="">Choose laundry item…</option>
              {menu.filter((item) => item.category === "Laundry").map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.price)}</option>)}
              <option value="custom">Other laundry item…</option>
            </select>
            {laundryItem === "custom" && <Input aria-label="Custom laundry item" className="mt-2" placeholder="Item name" value={laundryCustom} onChange={(e) => setLaundryCustom(e.target.value)} />}
          </div>
          <div><FieldLabel htmlFor="laundry-qty">Quantity</FieldLabel><Input id="laundry-qty" className="mt-1" type="number" min="1" step="1" value={laundryQty} onChange={(e) => setLaundryQty(e.target.value)} /></div>
          <div><FieldLabel htmlFor="laundry-price">Price (K)</FieldLabel><Input id="laundry-price" className="mt-1" type="number" min="0" step="0.01" value={laundryPrice} onChange={(e) => setLaundryPrice(e.target.value)} /></div>
          <div><FieldLabel htmlFor="laundry-payment">Payment</FieldLabel>
            <select id="laundry-payment" className={field} value={laundryMethod} onChange={(e) => setLaundryMethod(e.target.value as SaleMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              <option value="Room Charge">Charge to room bill</option>
            </select>
          </div>
          <div className="flex items-end gap-4 xl:col-span-3">
            <p className="pb-2 font-semibold">Total: {money(laundryTotal)}</p>
            <Button className="rounded-full px-6" disabled={!laundryItem || (laundryItem === "custom" && !laundryCustom.trim()) || !laundryRoom} onClick={addLaundry}>Record laundry</Button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-3xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-bold">Current guests</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>{["Guest", "Room", "Dates", "Nights", "PAX", "Total", "Paid", "Balance", ""].map((h) => <th key={h} className="p-3">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!inHouse.length && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No guests checked in.</td></tr>}
              {inHouse.map((r) => {
                const folio = roomFolio(r, sales);
                const p = reservationPaid(r);
                return (
                  <tr key={r.id} className="border-b">
                    <td className="p-3"><p className="font-semibold">{r.guest_name}</p><p className="text-xs text-muted-foreground">{r.phone ?? ""}</p></td>
                    <td className="p-3">{roomLabel(r.room_number ?? "-")}</td>
                    <td className="p-3">{r.check_in_date} → {scheduledCheckout(r.check_out_date, r.check_out_time)}</td>
                    <td className="p-3">{nightsBetween(r.check_in_date, r.check_out_date)}</td>
                    <td className="p-3">{r.num_guests}</td>
                    <td className="p-3">{money(folio)}</td>
                    <td className="p-3">{money(p)}</td>
                    <td className="p-3 font-bold">{money(Math.max(0, folio - p))}</td>
                    <td className="p-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setPayFor(r)}>Payment</Button><Button size="sm" className="bg-brand-navy text-primary-foreground hover:bg-brand-navy/90" onClick={() => setOutFor(r)}>Check-Out</Button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <PaymentDialog res={payFor} sales={sales} suggest={suggest} onClose={() => setPayFor(null)} />
      <Dialog open={!!outFor} onOpenChange={(o) => !o && setOutFor(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader><DialogTitle>Check out {outFor?.guest_name}?</DialogTitle></DialogHeader>
          {outFor && <p className="text-sm">Room {roomLabel(outFor.room_number ?? "-")} · Balance <b>{money(Math.max(0, roomFolio(outFor, sales) - reservationPaid(outFor)))}</b>. The room will be marked Needs Cleaning.</p>}
          {outFor && roomFolio(outFor, sales) > reservationPaid(outFor) && <>
            <Label htmlFor="checkout-due-date">Balance due date</Label><Input id="checkout-due-date" type="date" min={today} value={checkoutDueDate} onChange={(e) => setCheckoutDueDate(e.target.value)} />
            <Label htmlFor="checkout-reason">Reason for remaining balance</Label><Input id="checkout-reason" value={checkoutReason} onChange={(e) => setCheckoutReason(e.target.value)} />
          </>}
          <Button className="rounded-full" disabled={!!outFor && roomFolio(outFor, sales) > reservationPaid(outFor) && (!checkoutDueDate || !checkoutReason.trim())} onClick={() => {
            try {
              const rm = outFor && getRooms().find((x) => x.number === outFor.room_number);
              if (rm && outFor) {
                const total = roomFolio(outFor, sales);
                checkOut(rm, total > reservationPaid(outFor) ? "Unpaid" : "Paid", { total, payment_due_date: checkoutDueDate, payment_reason: checkoutReason });
                toast.success(`${outFor.guest_name} checked out.`);
              }
              setOutFor(null); setCheckoutDueDate(""); setCheckoutReason("");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not check out the guest.");
            }
          }}>Confirm Check-Out</Button>
          <ViaFooter />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function FieldLabel(props: ComponentProps<typeof Label>) {
  return <Label {...props} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" />;
}

function PaymentDialog({ res, sales, suggest, onClose }: { res: Reservation | null; sales: Sale[]; suggest: () => string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("Cash");
  const [receipt, setReceipt] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reason, setReason] = useState("");
  const due = res ? Math.max(0, roomFolio(res, sales) - reservationPaid(res)) : 0;
  const remaining = Math.max(0, due - (Number(amount) || 0));
  return (
    <Dialog open={!!res} onOpenChange={(o) => { if (!o) { onClose(); setAmount(""); setReceipt(""); setDueDate(""); setReason(""); } }}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Record payment · {res?.guest_name}</DialogTitle></DialogHeader>
        <p className="text-sm">Balance due: <b>{money(due)}</b></p>
        <Label htmlFor="pay-amt">Amount (K)</Label><Input id="pay-amt" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Label htmlFor="pay-m">Payment method</Label>
        <select id="pay-m" className={field} value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.filter((m) => m !== "Complimentary").map((m) => <option key={m}>{m}</option>)}</select>
        <Label htmlFor="pay-r">Receipt number</Label>
        <div className="flex gap-2"><Input id="pay-r" value={receipt} onChange={(e) => setReceipt(e.target.value)} /><Button variant="outline" onClick={() => setReceipt(suggest())}>Suggest</Button></div>
        {remaining > 0 && <>
          <Label htmlFor="payment-due-date">Remaining balance due date</Label><Input id="payment-due-date" type="date" min={iso(new Date())} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Label htmlFor="payment-reason">Reason for remaining balance</Label><Input id="payment-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </>}
        <Button className="rounded-full" disabled={!res || !(Number(amount) > 0) || Number(amount) > due || !receipt.trim() || (remaining > 0 && (!dueDate || !reason.trim()))} onClick={() => {
          try {
            if (res) recordPayment(res, Number(amount), method, receipt.trim(), { total: roomFolio(res, sales), payment_due_date: dueDate, payment_reason: reason });
            toast.success("Payment recorded.");
            onClose(); setAmount(""); setReceipt(""); setDueDate(""); setReason("");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not record payment.");
          }
        }}>Save Payment</Button>
      </DialogContent>
    </Dialog>
  );
}
