import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cancelReservation, confirmCheckIn, markNoShow } from "@/lib/actions";
import { useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { APP_NAME } from "@/lib/version";
import type { Reservation, Room } from "@/lib/types";
import type { VoiceClip } from "@/lib/useVoiceRecorder";
import { VoiceButton } from "./VoiceButton";
import { ViaFooter } from "./AppShell";

export function ConfirmCheckInDialog({ res, onClose }: { res: Reservation | null; onClose: () => void }) {
  const session = useSession();
  const rooms = useStored<Room[]>(keys.rooms(session?.property_code ?? ""), []);
  const available = rooms.filter((r) => r.status === "Available");
  const [room, setRoom] = useState("");
  const pick: string = room || (res?.preferred_room && available.some((r) => r.number === res.preferred_room) ? res.preferred_room : "");
  return (
    <Dialog open={!!res} onOpenChange={(o) => { if (!o) { onClose(); setRoom(""); } }}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Confirm Check-In</DialogTitle></DialogHeader>
        {res && (
          <div className="rounded-xl bg-brand-soft p-3 text-sm">
            <p><b>{res.guest_name}</b> · {res.num_guests} guest(s)</p>
            <p className="text-muted-foreground">{res.check_in_date} → {res.check_out_date}</p>
          </div>
        )}
        <div>
          <Label>Select Room (available only)</Label>
          <Select value={pick ?? ""} onValueChange={setRoom}>
            <SelectTrigger aria-label="Select room"><SelectValue placeholder="Choose a room" /></SelectTrigger>
            <SelectContent>{available.map((r) => <SelectItem key={r.number} value={r.number}>Room {r.number} · {r.type}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button className="rounded-full" disabled={!pick} onClick={() => { if (res && pick) confirmCheckIn(res, pick); setRoom(""); onClose(); }}>Confirm</Button>
        <ViaFooter />
      </DialogContent>
    </Dialog>
  );
}

export function CancelDialog({ res, onClose }: { res: Reservation | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={!!res} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Cancel reservation · {res?.guest_name}</DialogTitle></DialogHeader>
        <Textarea placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="destructive" className="rounded-full" onClick={() => { if (res) cancelReservation(res, reason || "Not given"); setReason(""); onClose(); }}>Cancel Reservation</Button>
        <ViaFooter />
      </DialogContent>
    </Dialog>
  );
}

const REASONS = ["Did not arrive", "No communication", "Late cancellation"];

export function NoShowDialog({ res, onClose }: { res: Reservation | null; onClose: () => void }) {
  const [reason, setReason] = useState<string>(REASONS[0] ?? "Did not arrive");
  const [charge, setCharge] = useState(false);
  const [fee, setFee] = useState("");
  const [release, setRelease] = useState(true);
  const [note, setNote] = useState("");
  const [voice, setVoice] = useState<VoiceClip | null>(null);
  const reset = () => { setReason(REASONS[0] ?? "Did not arrive"); setCharge(false); setFee(""); setRelease(true); setNote(""); setVoice(null); };
  return (
    <Dialog open={!!res} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/gilnet-logo.png" alt="" width={28} height={28} className="rounded-md" /> Mark as No-Show - {APP_NAME}
          </DialogTitle>
        </DialogHeader>
        {res && (
          <div className="rounded-xl bg-status-noshow p-3 text-sm">
            <p>Guest did not arrive: <b>{res.guest_name}</b></p>
            <p className="text-muted-foreground">Date {res.check_in_date} · Room {res.room_number ?? res.preferred_room ?? "not assigned"}</p>
          </div>
        )}
        <div><Label>Reason</Label>
          <Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={charge} onCheckedChange={(v) => setCharge(v === true)} /> Charge Fee</label>
        {charge && <Input type="number" placeholder="Amount" value={fee} onChange={(e) => setFee(e.target.value)} />}
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={release} onCheckedChange={(v) => setRelease(v === true)} /> Release Room</label>
        <Textarea placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <VoiceButton value={voice} onChange={setVoice} label="Hold to add a voice note" />
        <div className="flex gap-2">
          <Button className="flex-1 rounded-full bg-status-noshow-fg text-primary-foreground hover:bg-status-noshow-fg/90" onClick={() => {
            if (res) markNoShow(res, { reason, fee: charge && fee ? Number(fee) : null, release, note: note || voice?.transcript || "" });
            reset(); onClose();
          }}>Confirm No-Show</Button>
          <Button variant="outline" className="rounded-full" onClick={() => { reset(); onClose(); }}>Cancel</Button>
        </div>
        <ViaFooter />
      </DialogContent>
    </Dialog>
  );
}
