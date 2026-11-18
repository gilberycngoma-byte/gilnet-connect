import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Pin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { addNotice } from "@/lib/actions";
import { keys, useStored } from "@/lib/db";
import { useSession, can } from "@/lib/auth";
import { APP_NAME } from "@/lib/version";
import type { Department, Notice, NoticeType, Priority } from "@/lib/types";
import type { VoiceClip } from "@/lib/useVoiceRecorder";
import { VoiceButton } from "./VoiceButton";
import { timeAgo } from "./AppShell";
import { cn } from "@/lib/utils";
import { getDefaultAppPreferences, type AppPreferences } from "@/lib/app-preferences";

export const NOTICE_DEPTS: Department[] = ["All Staff", "Housekeeping", "Maintenance", "Front Desk", "Management"];
export const PRIORITY_BAR: Record<Priority, string> = {
  Low: "bg-muted-foreground/40",
  Medium: "bg-primary",
  High: "bg-brand-amber",
  Urgent: "bg-destructive",
};

const TEMPLATES: { label: string; title: string; message: string; type: NoticeType; to: Department; priority: Priority }[] = [
  { label: "Water shutdown", title: "Water shutdown", message: "Water will be shut off from 10:00 to 12:00 for repairs. Inform guests.", type: "Info", to: "All Staff", priority: "High" },
  { label: "AC repair", title: "AC repair", message: "AC unit needs servicing. Please inspect and repair.", type: "Maintenance", to: "Maintenance", priority: "Urgent" },
  { label: "Painting", title: "Painting works", message: "Corridor painting scheduled. Keep area clear.", type: "Instruction", to: "All Staff", priority: "Medium" },
  { label: "Deep cleaning", title: "Deep cleaning", message: "Deep clean all vacant rooms on floor 2 today.", type: "Task", to: "Housekeeping", priority: "Medium" },
  { label: "Meeting", title: "Staff meeting", message: "Staff meeting at 15:00 in the lobby.", type: "Instruction", to: "All Staff", priority: "Medium" },
];

export function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

export function visibleNoticesFor(
  list: Notice[],
  role?: string,
  receiveCheckInNotices = false,
) {
  const now = Date.now();
  const alive = list.filter(
    (notice) =>
      (!notice.expiry_date ||
        new Date(notice.expiry_date).getTime() + 86400000 > now) &&
      (!notice.is_check_in_notice || receiveCheckInNotices),
  );
  if (role === "Housekeeping" || role === "Maintenance")
    return alive.filter((n) => n.to_department === role || n.to_department === "All Staff");
  return alive;
}

export function AddNoticeDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: Partial<Notice> }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [type, setType] = useState<NoticeType>(initial?.type ?? "Info");
  const [to, setTo] = useState<Department>(initial?.to_department ?? "All Staff");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "Medium");
  const [expiry, setExpiry] = useState("");
  const [pin, setPin] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceClip | null>(null);

  const save = () => {
    if (!title.trim()) return;
    addNotice({ title, message: message || voice?.transcript || "", type, to_department: to, priority, is_pinned: pin, expiry_date: expiry || null, photo, audio_url: voice?.audio ?? null });
    setTitle(""); setMessage(""); setPhoto(null); setVoice(null); setPin(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl">
        <DialogHeader><DialogTitle>New Notice</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" onClick={() => { setTitle(t.title); setMessage(t.message); setType(t.type); setTo(t.to); setPriority(t.priority); }} className="rounded-full border bg-brand-soft px-3 py-1 text-xs">
              {t.label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>Message</Label><Textarea value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as NoticeType)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Urgent", "Maintenance", "Instruction", "Info", "Task"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>To Dept</Label>
              <Select value={to} onValueChange={(v) => setTo(v as Department)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTICE_DEPTS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Low", "Medium", "High", "Urgent"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label>Expiry</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={pin} onCheckedChange={setPin} /> Pin this notice</label>
          <div><Label>Attach photo</Label><Input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await readFile(f)); }} /></div>
          {photo && <img src={photo} alt="Attached" className="h-24 rounded-xl object-cover" />}
          <div><Label>Voice Instruction</Label><VoiceButton value={voice} onChange={setVoice} /></div>
          <Button className="w-full rounded-full" onClick={save} disabled={!title.trim()}>Post Notice</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NoticeBoardWidget() {
  const session = useSession();
  const code = session?.property_code ?? "";
  const all = useStored<Notice[]>(keys.notices(code), []);
  const staffId = session?.staff_id ?? session?.token ?? "";
  const savedPreferences = useStored<Partial<AppPreferences>>(
    keys.appPreferences(code, staffId),
    {},
  );
  const preferences = {
    ...getDefaultAppPreferences(session?.role),
    ...savedPreferences,
  };
  const list = visibleNoticesFor(all, session?.role, preferences.checkInNotices);
  const unread = list.filter((n) => !n.seen_by.includes(session?.user_email ?? "") && !n.is_completed).length;
  const latest = [...list].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at)).slice(0, 3);
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-6 rounded-2xl border border-brand-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-bold leading-tight">Notice Board</h2>
          <p className="text-[11px] text-muted-foreground">{APP_NAME}</p>
        </div>
        {unread > 0 && <span className="rounded-full bg-destructive px-2 text-xs font-semibold text-destructive-foreground">{unread}</span>}
        <div className="ml-auto flex gap-2">
          {can(session?.role, "notice_manage") && (
            <Button size="sm" className="rounded-full" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New Notice</Button>
          )}
          <Button size="sm" variant="outline" className="rounded-full" asChild><Link to="/notices">View All</Link></Button>
        </div>
      </div>
      {latest.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          <p className="font-medium">No notices — All clear</p>
          <p className="text-[11px]">Powered by {APP_NAME}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {latest.map((n) => (
            <li key={n.id} className="flex overflow-hidden rounded-xl border bg-brand-soft">
              <span className={cn("w-1.5 shrink-0", PRIORITY_BAR[n.priority])} />
              <Link to="/notices" className="flex min-w-0 flex-1 items-center gap-3 p-3">
                {n.is_pinned && <Pin className="h-4 w-4 shrink-0 text-brand-amber" />}
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-bold", n.is_completed && "line-through opacity-60")}>{n.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{n.message}</p>
                </div>
                <span className="shrink-0 rounded-full bg-brand-mint px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">{n.to_department}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(n.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AddNoticeDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
