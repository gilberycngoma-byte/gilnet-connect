import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Eye, MessageSquare, Pin, Plus, Trash2 } from "lucide-react";
import { AppShell, timeAgo } from "@/components/gpm/AppShell";
import { AddNoticeDialog, PRIORITY_BAR, readFile, visibleNoticesFor } from "@/components/gpm/notices";
import { VoiceButton } from "@/components/gpm/VoiceButton";
import { VoicePlayer } from "@/components/gpm/VoicePlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { completeNotice, deleteNotice, postMessage, updateNotice } from "@/lib/actions";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { APP_NAME } from "@/lib/version";
import { deptForRole, type Notice } from "@/lib/types";
import type { VoiceClip } from "@/lib/useVoiceRecorder";
import { cn } from "@/lib/utils";
import { getDefaultAppPreferences, type AppPreferences } from "@/lib/app-preferences";

export const Route = createFileRoute("/notices")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Notice Board - ${APP_NAME}` },
      { name: "description", content: "Department notices, tasks and maintenance instructions for your staff." },
      { property: "og:title", content: `Notice Board - ${APP_NAME}` },
      { property: "og:description", content: "Department notices, tasks and maintenance instructions." },
    ],
  }),
  component: NoticeBoardPage,
});

const FILTERS = ["All", "Maintenance", "Instructions", "Info", "Pinned", "Completed", "My Dept"] as const;

function NoticeBoardPage() {
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [addOpen, setAddOpen] = useState(false);
  const [completing, setCompleting] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<Notice | null>(null);
  const role = session?.role;
  const me = session?.user_email ?? "";
  const myDept = deptForRole(role);
  const manage = can(role, "notice_manage");

  const list = visibleNoticesFor(all, role, preferences.checkInNotices)
    .filter((n) => {
      switch (filter) {
        case "Maintenance": return n.type === "Maintenance";
        case "Instructions": return n.type === "Instruction";
        case "Info": return n.type === "Info";
        case "Pinned": return n.is_pinned;
        case "Completed": return n.is_completed;
        case "My Dept": return n.to_department === myDept;
        default: return true;
      }
    })
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at));

  return (
    <AppShell title="Notice Board">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f ? "bg-primary text-primary-foreground" : "bg-brand-soft")}>{f}</button>
        ))}
        {manage && <Button className="ml-auto rounded-full" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Notice</Button>}
      </div>
      {list.length === 0 && <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No notices — All clear</p>}
      <div className="space-y-3">
        {list.map((n) => (
          <article key={n.id} className="flex overflow-hidden rounded-2xl border border-brand-border bg-card shadow-sm">
            <span className={cn("w-1.5 shrink-0", PRIORITY_BAR[n.priority])} />
            <div className="min-w-0 flex-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {n.is_pinned && <Pin className="h-4 w-4 text-brand-amber" />}
                <h3 className={cn("font-bold", n.is_completed && "line-through opacity-60")}>#{n.number} {n.title}</h3>
                <span className="rounded-full bg-brand-mint px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">{n.type}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">To {n.to_department}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{n.priority}</span>
                {n.is_completed && <span className="flex items-center gap-1 rounded-full bg-status-confirmed px-2 py-0.5 text-[10px] font-semibold text-accent-foreground"><Check className="h-3 w-3" /> Done by {n.completed_by}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{n.message}</p>
              {n.photo && <img src={n.photo} alt="Notice attachment" className="mt-2 h-28 rounded-xl object-cover" />}
              {n.audio_url && <VoicePlayer src={n.audio_url} duration={null} />}
              {n.completed_photo && n.completed_photo.startsWith("data:image") && <img src={n.completed_photo} alt="Completion" className="mt-2 h-28 rounded-xl object-cover" />}
              {n.completed_photo && n.completed_photo.startsWith("data:audio") && <VoicePlayer src={n.completed_photo} duration={null} />}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {n.from_user} · {n.from_department} · {timeAgo(n.created_at)}{n.expiry_date ? ` · expires ${n.expiry_date}` : ""} · via {APP_NAME}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {!n.seen_by.includes(me) && (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => updateNotice(n.id, { seen_by: [...n.seen_by, me] })}><Eye className="h-3.5 w-3.5" /> Mark as Seen</Button>
                )}
                {!n.is_completed && <Button size="sm" className="rounded-full" onClick={() => setCompleting(n)}><Check className="h-3.5 w-3.5" /> Mark Completed</Button>}
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => postMessage("Front Desk", `Shared notice #${n.number}: ${n.title} - ${n.message}`, { message_type: "notice_alert", notice_id: n.id })} asChild>
                  <Link to="/messages"><MessageSquare className="h-3.5 w-3.5" /> Share to Chat Front Desk</Link>
                </Button>
                {manage && (
                  <>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(n)}>Edit</Button>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => updateNotice(n.id, { is_pinned: !n.is_pinned })}><Pin className="h-3.5 w-3.5" /> {n.is_pinned ? "Unpin" : "Pin"}</Button>
                    <Button size="sm" variant="ghost" className="rounded-full text-destructive" aria-label="Delete notice" onClick={() => deleteNotice(n.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <AddNoticeDialog open={addOpen} onOpenChange={setAddOpen} />
      <CompleteDialog notice={completing} onClose={() => setCompleting(null)} />
      <EditDialog notice={editing} onClose={() => setEditing(null)} />
    </AppShell>
  );
}

function CompleteDialog({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceClip | null>(null);
  return (
    <Dialog open={!!notice} onOpenChange={(o) => { if (!o) { onClose(); setPhoto(null); setVoice(null); } }}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Complete: {notice?.title}</DialogTitle></DialogHeader>
        <div><Label>Completion photo</Label><Input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await readFile(f)); }} /></div>
        {photo && <img src={photo} alt="Completion" className="h-28 rounded-xl object-cover" />}
        <div><Label>Voice comment</Label><VoiceButton value={voice} onChange={setVoice} /></div>
        <Button className="rounded-full" onClick={() => { if (notice) completeNotice(notice, photo ?? voice?.audio ?? null); setPhoto(null); setVoice(null); onClose(); }}>Mark Completed</Button>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  if (notice && loaded !== notice.id) { setLoaded(notice.id); setTitle(notice.title); setMessage(notice.message); }
  return (
    <Dialog open={!!notice} onOpenChange={(o) => { if (!o) { onClose(); setLoaded(null); } }}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Edit notice</DialogTitle></DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button className="rounded-full" onClick={() => { if (notice) updateNotice(notice.id, { title, message }); onClose(); setLoaded(null); }}>Save</Button>
      </DialogContent>
    </Dialog>
  );
}
