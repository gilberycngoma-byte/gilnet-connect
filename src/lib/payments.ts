import type { Reservation, Room } from "./types";

/** Payment choices offered at the front desk and restaurant. */
export const PAYMENT_METHODS = ["Cash", "Mobile", "Visa/Card", "Bank", "Complimentary"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const money = (n: number) => `K ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

export function formatLocalTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function scheduledCheckout(date: string, time?: string | null) {
  return time ? `${date} ${time}` : date;
}

/** Two-digit display for numeric room numbers ("1" → "01"). */
export const roomLabel = (n: string) => (/^\d$/.test(n) ? n.padStart(2, "0") : n);
export const sortRooms = (rooms: Room[]) =>
  [...rooms].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));

export function nightsBetween(checkIn: string, checkOut: string) {
  const d = (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000;
  return Number.isFinite(d) ? Math.max(1, Math.round(d)) : 1;
}

/** Room charge for a stay; complimentary stays are free. */
export function stayTotal(rate: number, nights: number, method?: string | null, discount = 0) {
  if (method === "Complimentary") return 0;
  return Math.max(0, Math.round((rate * nights - discount) * 100) / 100);
}

export function reservationTotal(r: Reservation) {
  if (r.rate != null) return stayTotal(r.rate, nightsBetween(r.check_in_date, r.check_out_date), r.payment_method, r.discount ?? 0);
  return r.total_amount ?? 0;
}
export const reservationPaid = (r: Reservation) => r.amount_paid ?? (r.payment_status === "Paid" ? reservationTotal(r) : 0);
export const reservationBalance = (r: Reservation) => Math.max(0, Math.round((reservationTotal(r) - reservationPaid(r)) * 100) / 100);
export const isPaid = (r: Reservation) => r.payment_method === "Complimentary" || reservationBalance(r) <= 0;
export function paymentPlanFor(paid: number, total: number): "Full" | "Partial" | "Pay Later" {
  if (paid >= total) return "Full";
  return paid > 0 ? "Partial" : "Pay Later";
}

export function reservationPaymentPlan(r: Reservation) {
  return r.payment_plan ?? paymentPlanFor(reservationPaid(r), reservationTotal(r));
}

/** Receipt prefix: first five letters of the property name, upper case. */
export function receiptPrefix(propertyName: string) {
  return (propertyName.replace(/[^a-z]/gi, "").slice(0, 5) || "GPM").toUpperCase();
}
export function nextReceiptNo(propertyName: string, used: (string | null | undefined)[]) {
  const prefix = receiptPrefix(propertyName);
  const max = used.reduce((m, r) => {
    const hit = r?.toUpperCase().match(new RegExp(`^${prefix}-(\\d+)$`));
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
