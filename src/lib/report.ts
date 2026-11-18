import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL } from "./version";
import { formatLocalDateTime, paymentPlanFor, reservationPaid } from "./payments";
import { roomFolio, type Sale } from "./restaurant";
import type { Room, Reservation, Notice, Property } from "./types";

export function createDailyReport(
  property: Property | null,
  rooms: Room[],
  reservations: Reservation[],
  notices: Notice[],
  sales: Sale[],
  date = new Date().toISOString().slice(0, 10),
  printedBy = "Unknown",
) {
  const doc = new jsPDF({ orientation: "landscape", format: "a3" });
  doc.setFontSize(18);
  doc.text(APP_NAME, 14, 19);
  doc.setFontSize(11);
  doc.text(`${property?.name ?? "Property"} | Daily operations | ${date}`, 14, 27);
  doc.setFontSize(9);
  doc.text(`Printed by ${printedBy} on ${new Date().toLocaleString()}`, 14, 33);
  const daily = sales.filter((sale) => sale.created_at.startsWith(date));

  const table = (title: string, head: string[], body: (string | number)[][]) => {
    const end = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 37;
    let y = end + 12;
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(12);
    doc.text(title, 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [head],
      body: body.length ? body : [head.map((_, index) => index === 0 ? "None" : "")],
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
      margin: { left: 14, right: 14, bottom: 24 },
    });
  };

  table("Occupancy summary", ["Total rooms", "Occupied", "Available", "Dirty / Cleaning", "Occupancy"], [[
    rooms.length,
    rooms.filter((room) => room.status === "Occupied").length,
    rooms.filter((room) => room.status === "Available").length,
    rooms.filter((room) => ["Dirty", "Cleaning"].includes(room.status)).length,
    `${rooms.length ? Math.round(rooms.filter((room) => room.status === "Occupied").length / rooms.length * 100) : 0}%`,
  ]]);

  table("Room statuses", ["Room", "Type / Floor", "Status", "Guest", "Scheduled departure"], rooms.map((room) => {
    const reservation = reservations.find((item) => item.id === room.reservationId);
    return [room.number, `${room.type} / ${room.floor ?? "-"}`, room.status, room.guestName ?? "-", reservation
      ? `${reservation.check_out_date} ${reservation.check_out_time ?? ""}`.trim()
      : room.checkOut ?? "-"];
  }));

  table(
    "Arrivals and departures",
    ["Guest", "Room", "Status", "Actual check-in", "Checked in by / role", "Scheduled check-out", "Actual check-out", "Checked out by / role", "Plan", "Paid", "Balance", "Due date", "Balance reason", "Extensions"],
    reservations.filter((reservation) => reservation.check_in_date === date || reservation.check_out_date === date).map((reservation) => {
      const total = roomFolio(reservation, sales);
      const paid = reservationPaid(reservation);
      const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      const extensions = (reservation.stay_extensions ?? []).map((extension) =>
        `${extension.from_date} ${extension.from_time ?? ""} → ${extension.to_date} ${extension.to_time}; ${extension.reason}; by ${extension.changed_by} (${extension.changed_role}) at ${formatLocalDateTime(extension.changed_at)}`,
      ).join("\n");
      return [
        reservation.guest_name,
        reservation.room_number ?? reservation.preferred_room ?? "-",
        reservation.status,
        formatLocalDateTime(reservation.confirmed_at),
        [reservation.confirmed_by, reservation.confirmed_role].filter(Boolean).join(" / "),
        `${reservation.check_out_date} ${reservation.check_out_time ?? ""}`.trim(),
        formatLocalDateTime(reservation.checked_out_at),
        [reservation.checked_out_by, reservation.checked_out_role].filter(Boolean).join(" / "),
        reservation.payment_plan ?? paymentPlanFor(paid, total),
        paid.toFixed(2),
        balance.toFixed(2),
        reservation.payment_due_date ?? "",
        reservation.payment_reason ?? "",
        extensions,
      ];
    }),
  );

  table("Cleaning and maintenance tasks", ["Task", "Department", "Priority", "Status"], notices
    .filter((notice) => notice.type === "Task" || notice.type === "Maintenance")
    .map((notice) => [notice.title, notice.to_department, notice.priority, notice.is_completed ? "Completed" : "Pending"]));

  table("Restaurant sales", ["Orders", "Cash", "Card", "Room Charge", "Daily total"], [[
    daily.length,
    ...(["Cash", "Card", "Room Charge"] as const).map((method) =>
      daily.filter((sale) => sale.method === method).reduce((sum, sale) => sum + sale.total, 0).toFixed(2)),
    daily.reduce((sum, sale) => sum + sale.total, 0).toFixed(2),
  ]]);

  table("Restaurant transactions", ["Time", "Items", "Payment", "Room", "Amount"], daily.map((sale) => [
    sale.created_at.slice(11, 16),
    sale.items.map((item) => `${item.quantity} x ${item.name}`).join(", "),
    sale.method,
    sale.room_number ?? "-",
    sale.total.toFixed(2),
  ]));

  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(`${APP_NAME} | Version ${APP_VERSION} | Printed by ${printedBy} | ${page}/${doc.getNumberOfPages()}`, 14, pageHeight - 12);
    doc.text(SUPPORT_EMAIL, 14, pageHeight - 7);
  }
  return doc;
}
