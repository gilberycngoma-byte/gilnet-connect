import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Mic, Paperclip, Pin, Search, Send, Trash2 } from "lucide-react";
import { AppShell, timeAgo } from "@/components/gpm/AppShell";
import { readFile } from "@/components/gpm/notices";
import { VoicePlayer } from "@/components/gpm/VoicePlayer";
import { Input } from "@/components/ui/input";
import { markDeptRead, postMessage, postPrivateMessage } from "@/lib/actions";
import { useSession } from "@/lib/auth";
import { keys, useStored, write, read } from "@/lib/db";
import { DEPARTMENTS, type Department, type Message } from "@/lib/types";
import { fmtDur, useVoiceRecorder } from "@/lib/useVoiceRecorder";
import { APP_NAME } from "@/lib/version";
import { cn } from "@/lib/utils";
import { listStaffRecipients } from "@/lib/staff.functions";
import { isPrivateMessageForStaff } from "@/lib/privateMessages";
import { resolveMessageDestination, type MessageRecipient } from "@/lib/message-routing";
import { toast } from "sonner";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Messages - ${APP_NAME}` },
      { name: "description", content: "Department chat with voice notes and the GILNET Assistant bot." },
      { property: "og:title", content: `Messages - ${APP_NAME}` },
      { property: "og:description", content: "Department chat with voice notes and an assistant bot." },
    ],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const session = useSession();
  const code = session?.property_code ?? "";
  const [dept, setDept] = useState<Department | null>(null);
  const [recipient, setRecipient] = useState<StaffRecipient | null>(null);
  const [recipients, setRecipients] = useState<StaffRecipient[]>([]);
  const [q, setQ] = useState("");
  const staffId = session?.staff_id ?? "";
  useEffect(() => {
    if (!staffId) return;
    let active = true;
    void listStaffRecipients().then((rows) => { if (active) setRecipients(rows); }).catch((error) => {
      if (active) toast.error(error instanceof Error ? error.message : "Could not load staff directory.");
    });
    return () => { active = false; };
  }, [staffId]);
  return (
    <AppShell title="Messages">
      <div className="flex h-[calc(100vh-11rem)] overflow-hidden rounded-2xl border border-brand-border bg-card md:h-[calc(100vh-12rem)]">
        <aside className={cn("w-full shrink-0 flex-col border-r p-3 md:flex md:w-[280px]", dept || recipient ? "hidden" : "flex")}>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Find a staff member" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label htmlFor="department-chat" className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Department chat
          </label>
          <select
            id="department-chat"
            className="mb-3 rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
            value={dept ?? ""}
            onChange={(event) => {
              const next = event.target.value as Department | "";
              setRecipient(null);
              setDept(next || null);
            }}
          >
            <option value="">Choose a department</option>
            {DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department === "GILNET Assistant" ? "GILNET Assistant Bot" : department}
              </option>
            ))}
          </select>
          <div className="space-y-1 overflow-y-auto">
            <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Private Messages</p>
            {recipients.filter((r) => `${r.name} ${r.department}`.toLowerCase().includes(q.toLowerCase())).map((person) => (
              <DirectRow key={person.id} code={code} currentStaffId={session?.staff_id ?? ""} person={person} active={recipient?.id === person.id} onClick={() => {setDept(null);setRecipient(person);}} />
            ))}
          </div>
        </aside>
        {dept || recipient ? <DepartmentChat
          code={code}
          dept={dept}
          recipient={recipient}
          recipients={recipients}
          onBack={() => {setDept(null);setRecipient(null);}}
          onDepartmentChange={(selected) => {setRecipient(null);setDept(selected);}}
          onBroadcast={() => {setRecipient(null);setDept("All Staff");}}
          onPrivateSent={(person) => {setDept(null);setRecipient(person);}}
        /> : (
          <div className="hidden flex-1 place-items-center text-sm text-muted-foreground md:grid">Choose a department or private conversation to start chatting.</div>
        )}
      </div>
    </AppShell>
  );
}

type StaffRecipient = MessageRecipient;

function recipientLabel(person: StaffRecipient) {
  return person.department ? `${person.name} - ${person.department}` : person.name;
}

function messageDestinationLabel(
  message: Message,
  recipients: StaffRecipient[],
  recipient: StaffRecipient | null,
) {
  if (message.receiver_type === "specific" || message.receiver_type === "individual") {
    return `To: ${recipientLabel({
      id: message.receiver_staff_id ?? "",
      name: message.receiver_staff_name ?? "Staff member",
      department:
        recipients.find((person) => person.id === message.receiver_staff_id)?.department ??
        recipient?.department ??
        "",
    })}`;
  }
  if (message.recipient_type === "department" || message.receiver_type === "department") {
    return `To: ${message.to_department}`;
  }
  return "To: All";
}

function DirectRow({ code, currentStaffId, person, active, onClick }: { code: string; currentStaffId: string; person: StaffRecipient; active: boolean; onClick: () => void }) {
  const list = useStored<Message[]>(keys.directMessages(code, currentStaffId, person.id), []);
  const visibleList = list.filter((message) => isPrivateMessageForStaff(message, currentStaffId));
  const unread = visibleList.filter((message) => message.receiver_staff_id === currentStaffId && !message.is_read).length;
  const last = visibleList[visibleList.length - 1];
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand-active", active && "bg-brand-active")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-mint text-xs font-bold text-accent-foreground">{person.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{last?.message ?? (person.department || "Staff")}</span></span>
      {unread > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{unread}</span>}
    </button>
  );
}

function DepartmentChat({ code, dept, recipient, recipients, onBack, onDepartmentChange, onBroadcast, onPrivateSent }: {
  code: string;
  dept: Department | null;
  recipient: StaffRecipient | null;
  recipients: StaffRecipient[];
  onBack: () => void;
  onDepartmentChange: (department: Department) => void;
  onBroadcast: () => void;
  onPrivateSent: (person: StaffRecipient) => void;
}) {
  const session = useSession();
  const currentStaffId = session?.staff_id ?? "";
  const recipientId = recipient?.id ?? "";
  const k = recipient
    ? keys.directMessages(code, currentStaffId, recipient.id)
    : keys.messages(code, dept ?? "All Staff");
  const list = useStored<Message[]>(k, []);
  const visibleList = recipient
    ? list.filter((message) => isPrivateMessageForStaff(message, currentStaffId))
    : list;
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [receiverId, setReceiverId] = useState(recipient?.id ?? "");
  const v = useVoiceRecorder();
  const startX = useRef(0);
  const [slide, setSlide] = useState(0);
  const end = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const pinned = visibleList.filter((m) => m.is_pinned);
  const mine = (m: Message) => (recipient ? m.sender_staff_id === session?.staff_id : m.from_user === session?.user_name) && m.message_type !== "bot";

  useEffect(() => {
    if (recipientId && currentStaffId) {
      const current = read<Message[]>(k, []);
      if (current.some((message) => isPrivateMessageForStaff(message, currentStaffId) && message.receiver_staff_id === currentStaffId && !message.is_read)) {
        write(k, current.map((message) => isPrivateMessageForStaff(message, currentStaffId) && message.receiver_staff_id === currentStaffId ? { ...message, is_read: true } : message));
      }
    } else if (dept) markDeptRead(dept);
  }, [dept, recipientId, list.length, currentStaffId, k]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [visibleList.length, dept]);
  useEffect(() => { setReceiverId(recipient?.id ?? ""); }, [recipient?.id, dept]);

  const deliver = (message: string, extra: Partial<Message> = {}, runBot = false) => {
    const destination = recipient
      ? { kind: "private" as const, recipient }
      : dept === "GILNET Assistant"
        ? { kind: "department" as const, department: dept }
        : resolveMessageDestination(dept, receiverId, recipients);
    if (!destination) {
      toast.error("Choose who should receive this message.");
      return false;
    }
    if (destination.kind === "private") {
      postPrivateMessage(destination.recipient, message, extra);
      setText("");
      setImage(null);
      onPrivateSent(destination.recipient);
      return true;
    }
    postMessage(
      destination.department,
      message,
      {
        ...extra,
        receiver_type: destination.department === "All Staff" ? "all_staffs" : "department",
      },
      { runBot },
    );
    if (destination.department === "All Staff") onBroadcast();
    setText("");
    setImage(null);
    return true;
  };

  const send = () => {
    if (!text.trim() && !image) return;
    deliver(text.trim() || "📷 Photo", { image, is_read: true }, dept === "GILNET Assistant");
  };
  const sendVoice = () => {
    if (!v.clip) return;
    const sent = deliver(v.clip.transcript ? `🎤 ${v.clip.transcript}` : "🎤 Voice note", {
      message_type: "voice",
      audio_url: v.clip.audio,
      audio_duration: v.clip.duration,
      transcription: v.clip.transcript || null,
      room_number: v.clip.transcript.match(/room\s*(\d+)/i)?.[1] ?? null,
      is_read: true,
    }, dept === "GILNET Assistant");
    if (sent) v.setClip(null);
  };
  const togglePin = (m: Message) => write(k, read<Message[]>(k, []).map((x) => (x.id === m.id ? { ...x, is_pinned: !x.is_pinned } : x)));

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <button className="md:hidden" onClick={onBack} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        {recipient ? (
          <div className="min-w-0">
            <p className="font-bold">{recipient.name}</p>
            <p className="text-[11px] text-muted-foreground">{recipient.department ? `Private · ${recipient.department}` : "Private message"}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <label htmlFor="active-department" className="block text-[10px] font-semibold text-muted-foreground">
              Department
            </label>
            <select
              id="active-department"
              className="max-w-64 rounded-md border-0 bg-transparent p-0 text-sm font-bold focus:ring-0"
              value={dept ?? ""}
              onChange={(event) => {
                const selected = event.target.value as Department | "";
                if (selected) onDepartmentChange(selected);
              }}
            >
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department === "GILNET Assistant" ? "GILNET Assistant Bot" : department}
                </option>
              ))}
            </select>
            {dept === "GILNET Assistant" && (
              <p className="text-[10px] text-muted-foreground">Replies only when you message this chat.</p>
            )}
          </div>
        )}
        <Link to="/notices" className="ml-auto text-xs font-semibold text-primary">Notices</Link>
        {pinned.length > 0 && <span className="flex items-center gap-1 rounded-full bg-status-reserved px-2 py-0.5 text-[11px] font-semibold text-brand-amber"><Pin className="h-3 w-3" /> {pinned.length} Pinned</span>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {visibleList.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {dept === "GILNET Assistant"
              ? "Send a message here when you want help with a room or task."
              : recipient
                ? "Send a private message to start this conversation."
                : `Messages sent here go to ${dept}. Select GILNET Assistant when you want an assistant reply.`}
          </p>
        )}
        {visibleList.map((m) => {
          const me = mine(m);
          return (
            <div key={m.id} className={cn("flex", me ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", me ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-bubble")}>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
                  {m.message_type === "bot" && <img src="/gilnet-logo.png" alt="" width={14} height={14} className="rounded-full" />}
                  {m.from_user}
                  <span className={cn("rounded-full px-1.5 text-[9px]", me ? "bg-primary-foreground/20" : "bg-brand-mint text-accent-foreground")}>{m.from_department}</span>
                </div>
                <p className="mb-1 text-[10px] opacity-70">
                  {messageDestinationLabel(m, recipients, recipient)}
                </p>
                {m.message_type === "voice" && m.audio_url ? (
                  <>
                    <VoicePlayer src={m.audio_url} duration={m.audio_duration} mine={me} />
                    {m.transcription && <p className="text-xs italic opacity-90">“{m.transcription}”</p>}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap">{m.message}</p>
                )}
                {m.image && <img src={m.image} alt="Shared" className="mt-1 max-h-48 rounded-xl" />}
                <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
                  {m.room_number && <Link to="/dashboard" className="rounded-full bg-status-reserved px-1.5 font-semibold text-brand-amber">Room {m.room_number}</Link>}
                  {m.notice_id && <Link to="/notices" className="underline">View Notice</Link>}
                  <span>{timeAgo(m.created_at)}</span>
                  <button onClick={() => togglePin(m)} aria-label="Pin message"><Pin className={cn("h-3 w-3", m.is_pinned && "fill-current")} /></button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {image && (
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <img src={image} alt="Attachment preview" className="h-14 rounded-lg" />
          <button className="text-destructive" onClick={() => setImage(null)} aria-label="Remove photo"><Trash2 className="h-4 w-4" /></button>
        </div>
      )}
      {v.clip ? (
        <div className="flex items-center gap-2 border-t p-3">
          <button className="text-destructive" onClick={() => v.setClip(null)} aria-label="Delete recording"><Trash2 className="h-5 w-5" /></button>
          <VoicePlayer src={v.clip.audio} duration={v.clip.duration} />
          <button onClick={sendVoice} className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="Send voice"><Send className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t p-3">
          {!recipient && dept !== "GILNET Assistant" && (
            <select
              aria-label="Message destination"
              className="max-w-48 rounded-full border bg-background px-2 py-2 text-xs"
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
            >
              <option value="">Choose destination</option>
              <option value="all">
                {dept === "All Staff" ? "All Staff" : `Department: ${dept}`}
              </option>
              {recipients.map((person) => (
                <option key={person.id} value={person.id}>
                  Private: {recipientLabel(person)}
                </option>
              ))}
            </select>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await readFile(f)); }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await readFile(f)); }} />
          {v.recording ? (
            <div className="flex flex-1 items-center gap-2 text-sm">
              <span className="h-3 w-3 animate-pulse rounded-full bg-destructive" />
              <span className="tabular-nums">{fmtDur(v.seconds)}</span>
              <span className="flex h-5 items-center gap-[2px]">{Array.from({ length: 16 }).map((_, i) => <span key={i} className="w-[3px] animate-pulse rounded-full bg-destructive/60" style={{ height: 6 + ((i * 7) % 12), animationDelay: `${i * 60}ms` }} />)}</span>
              <span className={cn("ml-auto text-xs text-muted-foreground", slide < -60 && "text-destructive")}>‹ Slide to cancel · Release to send</span>
            </div>
          ) : (
            <>
              <button onClick={() => fileRef.current?.click()} aria-label="Attach"><Paperclip className="h-5 w-5 text-muted-foreground" /></button>
              <button onClick={() => camRef.current?.click()} aria-label="Camera"><Camera className="h-5 w-5 text-muted-foreground" /></button>
              <Input className="flex-1 rounded-full" placeholder={dept === "GILNET Assistant" ? "Message GILNET Assistant..." : "Type a message..."} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            </>
          )}
          {text.trim() || image ? (
            <button
              onClick={send}
              disabled={!recipient && dept !== "GILNET Assistant" && !receiverId}
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send"
            ><Send className="h-4 w-4" /></button>
          ) : (
            <button
              aria-label="Hold to record"
              className={cn("grid h-10 w-10 touch-none select-none place-items-center rounded-full", v.recording ? "scale-110 bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}
              onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); startX.current = e.clientX; setSlide(0); v.start(); }}
              onPointerMove={(e) => v.recording && setSlide(e.clientX - startX.current)}
              onPointerUp={(e) => { v.stop(e.clientX - startX.current < -80); setSlide(0); }}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {v.error && <p className="px-3 pb-2 text-xs text-destructive">{v.error}</p>}
    </section>
  );
}
