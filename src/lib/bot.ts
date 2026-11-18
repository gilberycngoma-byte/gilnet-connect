// GILNET Assistant Bot: routes plain-language staff messages into notices.
import { keys, read } from "./db";
import { getCurrentUser } from "./auth";
import type { Department, Message, Room } from "./types";

type Route = { dept: Department; words: string[] };
const ROUTES: Route[] = [
  { dept: "Maintenance", words: ["broken", "not working", "repair", "leak", "ac", "a/c", "light", "plumber", "electric"] },
  { dept: "Housekeeping", words: ["clean", "dirty", "wash", "towel", "linen"] },
  { dept: "Front Desk", words: ["check-in", "check in", "check-out", "check out", "booking", "guest arrival", "arrival"] },
];
const URGENT = ["urgent", "emergency", "asap", "complaint"];

const hasWord = (t: string, w: string) => new RegExp(`(^|[^a-z])${w.replace(/[/-]/g, "\\$&")}([^a-z]|$)`).test(t);

export function shouldEngageAssistant(to: Department, messageType: Message["message_type"]) {
  return to === "GILNET Assistant" && (messageType === "chat" || messageType === "voice");
}

export function routeText(text: string): { dept: Department; urgent: boolean } | null {
  const t = text.toLowerCase();
  const urgent = URGENT.some((w) => hasWord(t, w));
  for (const r of ROUTES) if (r.words.some((w) => hasWord(t, w))) return { dept: r.dept, urgent };
  if (urgent) return { dept: "All Staff", urgent: true };
  return null;
}

/** Returns a bot reply or null. Creates notices as a side effect. */
export function processMessage(
  text: string,
  _fromDept: string,
  roomNumber: string | null,
  opts: { voiceSeconds?: number | null } = {},
): string | null {
  if (!text.trim()) return opts.voiceSeconds ? `Voice note (${opts.voiceSeconds}s) received. I couldn't make out the words.` : null;
  const t = text.toLowerCase();
  const room = roomNumber ?? text.match(/\b(\d{3})\b/)?.[1] ?? null;
  const prefix = opts.voiceSeconds ? `Voice note (${opts.voiceSeconds}s): '${text}' ` : "";

  // Questions about rooms
  const ask = t.match(/what rooms are (dirty|available|occupied|out of order|cleaning)/);
  if (ask) {
    const code = getCurrentUser()?.property_code ?? "LUS001";
    const want = (ask[1] ?? "").replace(/\b\w/g, (c) => c.toUpperCase()).replace("Of", "of");
    const list = read<Room[]>(keys.rooms(code), []).filter((r) => r.status === want);
    return list.length ? `${want} rooms: ${list.map((r) => r.number).join(", ")}` : `No ${want.toLowerCase()} rooms right now.`;
  }

  const r = routeText(text);
  if (!r) return opts.voiceSeconds ? `${prefix}received.` : null;

  // Lazy import avoids a circular module init order.
  return createFromBot(r.dept, r.urgent, text, room, prefix);
}

let addNoticeRef: typeof import("./actions").addNotice | null = null;
export function registerAddNotice(fn: typeof import("./actions").addNotice) {
  addNoticeRef = fn;
}

function createFromBot(dept: Department, urgent: boolean, text: string, room: string | null, prefix: string) {
  if (!addNoticeRef) return null;
  const rm = room ? ` Room ${room}` : "";
  const t = text.toLowerCase();
  let title = `Task${rm}`;
  if (dept === "Housekeeping") title = `Cleaning${rm}`;
  if (dept === "Maintenance") title = /ac|a\/c/.test(t) ? `AC Repair${rm}` : `Repair${rm}`;
  if (dept === "Front Desk") title = `Front Desk${rm}`;
  if (dept === "All Staff") title = `Urgent${rm}`;
  const priority = dept === "Maintenance" || urgent ? "Urgent" : "Medium";
  const n = addNoticeRef({
    title,
    message: text,
    type: dept === "Maintenance" ? "Maintenance" : urgent ? "Urgent" : "Task",
    to_department: dept,
    priority,
    is_pinned: priority === "Urgent" || dept === "Housekeeping",
    from_department: "GILNET Assistant",
    from_user: "GILNET Assistant",
    silent: true,
    assistantEngaged: true,
  });
  if (prefix) return `${prefix}Task created → ${dept} (Notice #${n.number})`;
  if (dept === "Housekeeping") return `I created cleaning task${rm}, notified Housekeeping. Notice #${n.number} pinned`;
  if (dept === "Maintenance")
    return `Maintenance notice created: ${title}. Assigned Maintenance (${priority}). Photo required on completion`;
  return `Notice #${n.number} created for ${dept}${urgent ? " (Urgent, pinned)" : ""}`;
}
