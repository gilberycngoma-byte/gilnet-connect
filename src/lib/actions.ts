import { toast } from "sonner";
import { keys, read, uid, write } from "./db";
import { syncInBackground } from "./supabaseSync";
import { can, getCurrentUser } from "./auth";
import { getAppPreferences } from "./app-preferences";
import { APP_NAME } from "./version";
import type {
  Department,
  Message,
  Notice,
  NoticeType,
  Priority,
  Reservation,
  Room,
  RoomStatus,
} from "./types";
import { deptForRole } from "./types";
import { processMessage, registerAddNotice, shouldEngageAssistant } from "./bot";
import {
  nightsBetween,
  paymentPlanFor,
  reservationPaid,
  reservationTotal,
  stayTotal,
} from "./payments";

export const VIA = `via ${APP_NAME}`;
const now = () => new Date().toISOString();
const me = () => getCurrentUser();
const code = () => me()?.property_code ?? "LUS001";
const myDept = () => deptForRole(me()?.role);

export function notify(title: string, body: string) {
  toast(title, { description: body });
  const preferences = getAppPreferences(code(), me()?.staff_id ?? me()?.token ?? "");
  if (!preferences.desktopNotifications) return;
  try {
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") new Notification(title, { body, icon: "/gilnet-logo.png" });
    }
  } catch (error) {
    console.warn("Could not display desktop notification", error);
  }
}

// ---------- rooms ----------
export const getRooms = () => read<Room[]>(keys.rooms(code()), []);
export function nextRoomNumber(rooms: Room[]) {
  const used = new Set(rooms.map((room) => room.number.trim()));
  const largest = rooms.reduce((max, room) => {
    const number = Number(room.number);
    if (Number.isSafeInteger(number) && number > max) return number;
    return max;
  }, 0);
  let next = largest + 1;
  while (used.has(String(next))) next += 1;
  return String(next);
}
export function addRoom(input: { number: string; type: string; floor: string; price: number }) {
  const session = me();
  if (!can(session?.role, "room_admin")) throw new Error("Only Admins can add rooms.");

  const number = input.number.trim();
  const type = input.type.trim();
  const floor = input.floor.trim();
  if (!number || !type || !floor) throw new Error("Room number, type, and floor are required.");
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error("Room rate must be a valid non-negative amount.");

  const rooms = getRooms();
  if (rooms.some((room) => room.number.trim().toLowerCase() === number.toLowerCase())) {
    throw new Error(`Room ${number} already exists.`);
  }
  const room: Room = {
    number,
    type,
    floor,
    price: input.price,
    status: "Available",
  };
  write(keys.rooms(code()), [...rooms, room]);
  return room;
}
function updateRoom(num: string, patch: Partial<Room>) {
  const rooms = getRooms().map((r) => (r.number === num ? { ...r, ...patch } : r));
  write(keys.rooms(code()), rooms);
  syncInBackground("rooms", { num, ...patch });
}
export function setRoomStatus(num: string, status: RoomStatus) {
  const clear = status !== "Occupied" ? { guestName: null, checkIn: null, checkOut: null, reservationId: null, pax: null, serviced_at: null } : {};
  updateRoom(num, { status, ...clear, dnd: false });
}
/** Housekeeping: record that an occupied room was serviced today. */
export function markServiced(room: Room) {
  const today = new Date().toISOString().slice(0, 10);
  updateRoom(room.number, { serviced_at: today });
  postMessage("Front Desk", `Room ${room.number} serviced ✔ by ${me()?.user_name ?? "Housekeeping"} - ${VIA}`);
  notify("Room serviced", `Room ${room.number} ✔ · ${VIA}`);
}

// ---------- messages ----------
export function postMessage(
  to: Department,
  text: string,
  extra: Partial<Message> = {},
  opts: { runBot?: boolean } = {},
): Message {
  const s = me();
  const recipientType =
    extra.receiver_type === "individual" || extra.receiver_type === "specific"
      ? "individual"
      : extra.receiver_type === "department"
        ? "department"
        : extra.receiver_type === "all_staffs" || extra.receiver_type === "all"
          ? "all_staffs"
          : to === "All Staff"
            ? "all_staffs"
            : "department";
  const senderId = s?.staff_id ?? s?.token ?? null;
  const receiverId =
    recipientType === "individual"
      ? extra.receiver_id ?? extra.receiver_staff_id ?? null
      : recipientType === "department"
        ? extra.receiver_id ?? to
        : null;
  const msg: Message = {
    id: uid(),
    property_code: code(),
    from_department: extra.from_department ?? myDept(),
    from_user: extra.from_user ?? s?.user_name ?? "Staff",
    message: text,
    room_number: extra.room_number ?? (text.match(/room\s*(\d+)/i)?.[1] ?? null),
    notice_id: null,
    message_type: "chat",
    is_read: false,
    audio_url: null,
    audio_duration: null,
    transcription: null,
    created_at: now(),
    ...extra,
    sender_id: senderId,
    sender_staff_id: senderId,
    recipient_type: recipientType,
    receiver_type:
      recipientType === "individual"
        ? "specific"
        : recipientType === "department"
          ? "department"
          : "all",
    receiver_id: receiverId,
    receiver_staff_id: recipientType === "individual" ? String(receiverId ?? "") || null : null,
    to_department: to,
  };
  const k = keys.messages(code(), to);
  write(k, [...read<Message[]>(k, []), msg]);
  syncInBackground("department_messages", msg);
  if (opts.runBot && shouldEngageAssistant(to, msg.message_type)) {
    const content = msg.message_type === "voice" ? msg.transcription || "" : text;
    setTimeout(() => {
      const reply = processMessage(content, msg.from_department, msg.room_number, {
        voiceSeconds: msg.message_type === "voice" ? msg.audio_duration : null,
      });
      if (reply) botSay(to, reply);
    }, 400);
  }
  return msg;
}

export function postPrivateMessage(
  recipient: { id: string; name: string; department: string },
  text: string,
  extra: Partial<Message> = {},
): Message {
  const s = me();
  if (!s?.staff_id) throw new Error("Sign in with a staff account to send a private message.");
  const msg: Message = {
    id: uid(),
    property_code: code(),
    receiver_staff_name: recipient.name,
    from_department: s.department ?? myDept(),
    to_department: "All Staff",
    from_user: s.user_name,
    message: text,
    room_number: extra.room_number ?? null,
    notice_id: null,
    message_type: "chat",
    is_read: false,
    audio_url: null,
    audio_duration: null,
    transcription: null,
    created_at: now(),
    ...extra,
    sender_id: s.staff_id,
    sender_staff_id: s.staff_id,
    recipient_type: "individual",
    receiver_type: "specific",
    receiver_id: recipient.id,
    receiver_staff_id: recipient.id,
  };
  const k = keys.directMessages(code(), s.staff_id, recipient.id);
  write(k, [...read<Message[]>(k, []), msg]);
  syncInBackground("messages", msg);
  return msg;
}

export function botSay(to: Department, text: string, notice_id: string | null = null) {
  return postMessage(to, `${text} - ${APP_NAME} Bot`, {
    from_user: "GILNET Assistant",
    from_department: "GILNET Assistant",
    message_type: "bot",
    notice_id,
  });
}

export function markDeptRead(dept: Department) {
  const k = keys.messages(code(), dept);
  const list = read<Message[]>(k, []);
  if (list.some((m) => !m.is_read)) write(k, list.map((m) => ({ ...m, is_read: true })), false);
}

// ---------- notices ----------
export function addNotice(input: {
  id?: string;
  title: string;
  message: string;
  type: NoticeType;
  to_department: Department;
  priority: Priority;
  is_pinned?: boolean;
  expiry_date?: string | null;
  photo?: string | null;
  audio_url?: string | null;
  from_department?: string;
  from_user?: string;
  silent?: boolean;
  suppressChatAlert?: boolean;
  is_check_in_notice?: boolean;
  assistantEngaged?: boolean;
}): Notice {
  const list = read<Notice[]>(keys.notices(code()), []);
  const existing = input.id ? list.find((notice) => notice.id === input.id) : undefined;
  if (existing) return existing;
  const n: Notice = {
    id: input.id ?? uid(),
    number: (list.reduce((m, x) => Math.max(m, x.number || 0), 100) || 100) + 1,
    property_code: code(),
    title: input.title,
    message: input.message,
    type: input.type,
    to_department: input.to_department,
    from_user: input.from_user ?? me()?.user_name ?? "Staff",
    from_department: input.from_department ?? myDept(),
    priority: input.priority,
    is_pinned: !!input.is_pinned,
    is_completed: false,
    completed_by: null,
    completed_photo: null,
    audio_url: input.audio_url ?? null,
    photo: input.photo ?? null,
    expiry_date: input.expiry_date ?? null,
    seen_by: [],
    created_at: now(),
    ...(input.is_check_in_notice ? { is_check_in_notice: true } : {}),
  };
  write(keys.notices(code()), [n, ...list]);
  syncInBackground("notices", n);
  if (!input.suppressChatAlert) {
    postMessage(
      n.to_department,
      `NEW NOTICE: ${n.title} - ${n.message} - Posted by ${n.from_user} - View in Notice Board`,
      { message_type: "notice_alert", notice_id: n.id },
    );
  }
  if (input.assistantEngaged) {
    botSay(n.to_department, `NEW NOTICE from ${n.from_department}: ${n.title} - Check Notice Board`, n.id);
  }
  if (!input.silent) notify(`New notice: ${n.title}`, `${n.to_department} · ${VIA}`);
  return n;
}

export function updateNotice(id: string, patch: Partial<Notice>) {
  const list = read<Notice[]>(keys.notices(code()), []);
  write(keys.notices(code()), list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  syncInBackground("notices", { id, ...patch });
}
export function deleteNotice(id: string) {
  write(keys.notices(code()), read<Notice[]>(keys.notices(code()), []).filter((n) => n.id !== id));
}
export function completeNotice(n: Notice, photo: string | null) {
  updateNotice(n.id, { is_completed: true, completed_by: me()?.user_name ?? "Staff", completed_photo: photo });
  notify("Notice completed", `${n.title} · ${VIA}`);
}

// ---------- reservations ----------
export const getReservations = () => read<Reservation[]>(keys.reservations(code()), []);
function updateRes(id: string, patch: Partial<Reservation>) {
  write(keys.reservations(code()), getReservations().map((r) => (r.id === id ? { ...r, ...patch } : r)));
  syncInBackground("reservations", { id, ...patch });
}

export function addReservation(input: {
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
  check_out_time?: string;
  num_guests: number;
  total_amount: number;
  preferred_room: string | null;
  payment_plan?: "Full" | "Partial" | "Pay Later";
  amount_paid?: number;
  payment_due_date?: string | null;
  payment_reason?: string | null;
}) {
  const paymentPlan = input.payment_plan ?? "Pay Later";
  const amountPaid = input.amount_paid ?? 0;
  if (
    !Number.isFinite(input.total_amount) ||
    input.total_amount < 0 ||
    !Number.isFinite(amountPaid) ||
    amountPaid < 0 ||
    amountPaid > input.total_amount
  ) {
    throw new Error("Enter valid non-negative reservation and payment amounts.");
  }
  if (input.check_out_date <= input.check_in_date) {
    throw new Error("Check-out must be after check-in.");
  }
  const balance = Math.max(0, input.total_amount - amountPaid);
  if (balance > 0 && (!input.payment_due_date || !input.payment_reason?.trim())) {
    throw new Error("Enter a payment due date and reason for the outstanding balance.");
  }
  if (
    paymentPlan !== paymentPlanFor(amountPaid, input.total_amount) ||
    amountPaid < 0 ||
    amountPaid > input.total_amount
  ) {
    throw new Error("The payment plan and amount paid do not match the reservation total.");
  }
  const r: Reservation = {
    id: uid(),
    property_code: code(),
    guest_name: input.guest_name,
    room_number: null,
    preferred_room: input.preferred_room,
    check_in_date: input.check_in_date,
    check_out_date: input.check_out_date,
    check_out_time: input.check_out_time ?? "11:00",
    num_guests: input.num_guests,
    status: "Reserved",
    payment_status: balance === 0 ? "Paid" : "Unpaid",
    total_amount: input.total_amount,
    payment_plan: paymentPlan,
    amount_paid: amountPaid,
    payment_due_date: balance > 0 ? (input.payment_due_date ?? null) : null,
    payment_reason: balance > 0 ? input.payment_reason?.trim() ?? null : null,
    confirmed_by: null,
    confirmed_at: null,
    cancellation_reason: null,
    noShowReason: null,
    noShowFee: null,
    noShowAt: null,
    created_at: now(),
  };
  write(keys.reservations(code()), [r, ...getReservations()]);
  syncInBackground("reservations", r);
  notify("Reservation added", `${r.guest_name} · ${r.check_in_date} · ${VIA}`);
  return r;
}

export function walkInCheckIn(input: {
  guest_name: string;
  phone: string;
  room_number: string;
  pax: number;
  check_in_date: string;
  check_out_date: string;
  check_out_time: string;
  rate: number;
  amount_paid: number;
  payment_plan: "Full" | "Partial" | "Pay Later";
  payment_due_date: string;
  payment_reason: string;
  payment_method: string;
  receipt_no: string;
  notes: string;
}) {
  const room = getRooms().find((r) => r.number === input.room_number);
  if (!room || room.status !== "Available") throw new Error("Select a vacant room.");
  if (input.check_out_date <= input.check_in_date) throw new Error("Check-out must be after check-in.");
  if (!/^\d{2}:\d{2}$/.test(input.check_out_time)) throw new Error("Enter a valid scheduled check-out time.");
  if (!Number.isFinite(input.rate) || input.rate < 0) throw new Error("Enter a valid non-negative room rate.");
  const total = stayTotal(input.rate, nightsBetween(input.check_in_date, input.check_out_date), input.payment_method);
  const paid = input.payment_method === "Complimentary" ? 0 : input.amount_paid;
  const balance = Math.max(0, total - paid);
  if (!Number.isFinite(paid) || paid < 0 || paid > total) {
    throw new Error("Amount paid must be between zero and the total.");
  }
  if (input.payment_plan !== paymentPlanFor(paid, total)) {
    throw new Error("The payment plan does not match the amount paid.");
  }
  if (balance > 0 && (!input.payment_due_date || !input.payment_reason.trim())) {
    throw new Error("Enter a payment due date and reason for the outstanding balance.");
  }
  const r: Reservation = {
    id: uid(),
    property_code: code(),
    guest_name: input.guest_name,
    room_number: null,
    preferred_room: input.room_number,
    check_in_date: input.check_in_date,
    check_out_date: input.check_out_date,
    check_out_time: input.check_out_time,
    num_guests: input.pax,
    status: "Reserved",
    payment_status: balance === 0 ? "Paid" : "Unpaid",
    total_amount: total,
    payment_plan: input.payment_plan,
    payment_due_date: balance > 0 ? input.payment_due_date : null,
    payment_reason: balance > 0 ? input.payment_reason.trim() : null,
    confirmed_by: null,
    confirmed_at: null,
    cancellation_reason: null,
    noShowReason: null,
    noShowFee: null,
    noShowAt: null,
    created_at: now(),
    phone: input.phone || null,
    rate: input.rate,
    amount_paid: paid,
    payment_method: input.payment_method,
    receipt_no: input.receipt_no || null,
    notes: input.notes || null,
    discount: 0,
  };
  write(keys.reservations(code()), [r, ...getReservations()]);
  confirmCheckIn(r, input.room_number);
  return r;
}

/** Adds a payment to a stay and refreshes its paid status. */
export function recordPayment(
  res: Reservation,
  amount: number,
  method: string,
  receipt: string,
  options: { total: number; payment_due_date?: string; payment_reason?: string },
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a valid payment amount greater than zero.");
  }
  if (!Number.isFinite(options.total) || options.total < 0) {
    throw new Error("The folio total is invalid; refresh the guest record and try again.");
  }
  const paid = Math.round((reservationPaid(res) + amount) * 100) / 100;
  const balance = Math.max(0, Math.round((options.total - paid) * 100) / 100);
  if (paid > options.total) throw new Error("Payment cannot exceed the outstanding folio total.");
  if (balance > 0 && (!options.payment_due_date || !options.payment_reason?.trim())) {
    throw new Error("Enter a payment due date and reason for the outstanding balance.");
  }
  updateRes(res.id, {
    amount_paid: paid,
    payment_method: method,
    receipt_no: receipt || res.receipt_no || null,
    payment_status: balance === 0 ? "Paid" : "Unpaid",
    payment_plan: paymentPlanFor(paid, options.total),
    payment_due_date: balance > 0 ? (options.payment_due_date ?? null) : null,
    payment_reason: balance > 0 ? options.payment_reason?.trim() ?? null : null,
  });
  notify("Payment recorded", `${res.guest_name} · K ${amount.toFixed(2)} · ${VIA}`);
}

export function confirmCheckIn(res: Reservation, roomNumber: string) {
  const by = me()?.user_name ?? "Front Desk";
  updateRes(res.id, { status: "Confirmed Check-In", room_number: roomNumber, confirmed_by: by, confirmed_at: now(), confirmed_role: me()?.role ?? null });
  updateRoom(roomNumber, {
    status: "Occupied",
    guestName: res.guest_name,
    checkIn: res.check_in_date,
    checkOut: res.check_out_date,
    reservationId: res.id,
    pax: res.num_guests,
    serviced_at: null,
  });
  addNotice({
    id: `guest-check-in-${res.id}`,
    title: `Check-In: Room ${roomNumber}`,
    message: `${res.guest_name} checked in to Room ${roomNumber} until ${res.check_out_date}`,
    type: "Info",
    to_department: "All Staff",
    priority: "Low",
    silent: true,
    suppressChatAlert: true,
    is_check_in_notice: true,
  });
  notify("Check-in confirmed", `${res.guest_name} → Room ${roomNumber} · ${VIA}`);
}

export function cancelReservation(res: Reservation, reason: string) {
  updateRes(res.id, { status: "Cancelled", cancellation_reason: reason });
  notify("Reservation cancelled", `${res.guest_name} · ${VIA}`);
}

export function markNoShow(
  res: Reservation,
  o: { reason: string; fee: number | null; release: boolean; note: string },
) {
  updateRes(res.id, { status: "No-Show", noShowAt: now(), noShowReason: o.note ? `${o.reason} — ${o.note}` : o.reason, noShowFee: o.fee });
  const room = res.room_number ?? res.preferred_room ?? "-";
  if (o.release && res.room_number) setRoomStatus(res.room_number, "Available");
  const feeTxt = o.fee ? ` Fee ${o.fee}` : "";
  addNotice({
    title: `No-Show: ${res.guest_name}`,
    message: `No-Show: ${res.guest_name} Room ${room} Reason ${o.reason}${feeTxt}`,
    type: "Info",
    to_department: "Front Desk",
    priority: "Medium",
    silent: true,
  });
  const txt = `No-Show: ${res.guest_name} - Reservation ${res.check_in_date} - Room ${room} ${o.release ? "released" : "held"} - ${VIA}`;
  postMessage("Front Desk", txt);
  postMessage("Management", txt);
  notify("Marked as No-Show", `${res.guest_name} · ${VIA}`);
}

export function undoNoShow(res: Reservation) {
  updateRes(res.id, { status: "Reserved", noShowAt: null, noShowReason: null, noShowFee: null });
  notify("No-Show undone", `${res.guest_name} is Reserved again · ${VIA}`);
}

export function checkOut(
  room: Room,
  paymentNote: string,
  deferred?: { payment_due_date?: string; payment_reason?: string; total?: number },
) {
  const reservation = room.reservationId
    ? getReservations().find((item) => item.id === room.reservationId)
    : undefined;
  if (reservation) {
    const total = deferred?.total ?? reservationTotal(reservation);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error("The folio total is invalid; refresh the guest record before checking out.");
    }
    const paid = reservationPaid(reservation);
    const balance = Math.max(0, total - paid);
    if (balance > 0 && (!deferred?.payment_due_date || !deferred.payment_reason?.trim())) {
      throw new Error("Enter a payment due date and reason before checking out with a balance.");
    }
    updateRes(reservation.id, {
      status: "Checked-Out",
      payment_status: paymentNote || "Paid",
      checked_out_at: now(),
      checked_out_by: me()?.user_name ?? "Staff",
      checked_out_role: me()?.role ?? "Unknown",
      payment_plan: paymentPlanFor(paid, total),
      payment_due_date: balance > 0 ? deferred?.payment_due_date ?? null : null,
      payment_reason: balance > 0 ? deferred?.payment_reason?.trim() ?? null : null,
    });
  }
  const guest = room.guestName ?? "Guest";
  setRoomStatus(room.number, "Dirty");
  addNotice({
    title: `Clean Room ${room.number}`,
    message: `Room ${room.number} needs cleaning after check-out`,
    type: "Task",
    to_department: "Housekeeping",
    priority: "High",
    silent: true,
  });
  postMessage("Front Desk", `Check-Out: ${guest} left Room ${room.number}. Room marked Dirty - ${VIA}`);
  notify("Checked out", `Room ${room.number} needs cleaning · ${VIA}`);
}

export function extendStay(room: Room, newDate: string, newTime: string, reason: string, dueDate: string) {
  const reservation = room.reservationId
    ? getReservations().find((item) => item.id === room.reservationId)
    : undefined;
  if (!reservation) throw new Error("The room has no linked reservation to extend.");
  if (!newDate || !newTime || !reason.trim()) {
    throw new Error("Enter the new checkout date/time and extension reason.");
  }
  if (!/^\d{2}:\d{2}$/.test(newTime)) throw new Error("Enter a valid scheduled check-out time.");
  if (
    newDate < reservation.check_out_date ||
    (newDate === reservation.check_out_date &&
      newTime <= (reservation.check_out_time ?? "00:00"))
  ) {
    throw new Error("The new checkout time must be later than the current checkout time.");
  }
  const updatedTotal =
    reservation.rate != null
      ? stayTotal(
          reservation.rate,
          nightsBetween(reservation.check_in_date, newDate),
          reservation.payment_method,
          reservation.discount ?? 0,
        )
      : reservation.total_amount;
  const paid = reservationPaid(reservation);
  const balance = Math.max(0, updatedTotal - paid);
  if (balance > 0 && !dueDate) {
    throw new Error("Enter a due date for the balance created by this extension.");
  }
  const user = me();
  const extension = {
    from_date: reservation.check_out_date,
    from_time: reservation.check_out_time ?? null,
    to_date: newDate,
    to_time: newTime,
    changed_at: now(),
    changed_by: user?.user_name ?? "Staff",
    changed_role: user?.role ?? "Unknown",
    reason: reason.trim(),
  };
  updateRoom(room.number, { checkOut: newDate });
  updateRes(reservation.id, {
    check_out_date: newDate,
    check_out_time: newTime,
    amount_paid: paid,
    payment_plan: paymentPlanFor(paid, updatedTotal),
    payment_due_date: balance > 0 ? dueDate : null,
    payment_reason: balance > 0 ? reason.trim() : null,
    stay_extensions: [...(reservation.stay_extensions ?? []), extension],
  });
  postMessage("Front Desk", `Stay extended: Room ${room.number} until ${newDate} ${newTime}. Reason: ${reason.trim()} - ${VIA}`);
  notify("Stay extended", `Room ${room.number} → ${newDate}`);
}

export type ServiceKind = "Request Cleaning" | "Maintenance Issue" | "Guest Request" | "Do Not Disturb" | "Mark Out of Order";

export function serviceRoom(
  room: Room,
  kind: ServiceKind,
  details: string,
  voice: { audio: string; duration: number; transcript: string } | null,
) {
  const map: Record<ServiceKind, { dept: Department; type: NoticeType; priority: Priority }> = {
    "Request Cleaning": { dept: "Housekeeping", type: "Task", priority: "Medium" },
    "Maintenance Issue": { dept: "Maintenance", type: "Maintenance", priority: "Urgent" },
    "Guest Request": { dept: "Front Desk", type: "Task", priority: "Medium" },
    "Do Not Disturb": { dept: "Housekeeping", type: "Info", priority: "Low" },
    "Mark Out of Order": { dept: "Maintenance", type: "Maintenance", priority: "High" },
  };
  const m = map[kind];
  const text = details || voice?.transcript || kind;
  if (kind === "Do Not Disturb") updateRoom(room.number, { dnd: !room.dnd });
  if (kind === "Mark Out of Order") setRoomStatus(room.number, "Out of Order");
  if (kind === "Request Cleaning" && room.status !== "Occupied") setRoomStatus(room.number, "Cleaning");
  addNotice({
    title: `${kind}: Room ${room.number}`,
    message: text,
    type: m.type,
    to_department: m.dept,
    priority: m.priority,
    is_pinned: m.priority === "Urgent",
    audio_url: voice?.audio ?? null,
    silent: true,
  });
  if (voice)
    postMessage(m.dept, `Room ${room.number}: ${kind}`, {
      message_type: "voice",
      audio_url: voice.audio,
      audio_duration: voice.duration,
      transcription: voice.transcript || null,
      room_number: room.number,
    });
  notify(kind, `Room ${room.number} → ${m.dept} · ${VIA}`);
}
registerAddNotice(addNotice);
