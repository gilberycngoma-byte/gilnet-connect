import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatLocalDateTime, money, paymentPlanFor, reservationPaid, reservationTotal, roomLabel, scheduledCheckout, sortRooms } from './payments';
import { roomFolio, type Sale } from './restaurant';
import type { Reservation, Room } from './types';

export type CheckInRow = {
  room: string; guest: string; checkIn: string; checkOut: string; status: 'Paid' | 'Unpaid' | 'Available';
  receipt: string; amount: number | null; user: string; checkInAt: string; checkInRole: string;
  checkOutAt: string; checkOutBy: string; checkOutRole: string; paymentPlan: string; balance: number;
  dueDate: string; balanceReason: string; extensions: string;
};
export type CheckInTotals = { occupied: number; available: number; unpaid: number; revenue: number };

const STAY: Reservation['status'][] = ['Confirmed Check-In', 'Checked-Out'];

/** Every room appears; rooms with stays overlapping the period get one row per stay. */
export function buildCheckInRows(rooms: Room[], reservations: Reservation[], dateFrom: string, dateTo: string, sales: Sale[] = []): { rows: CheckInRow[]; totals: CheckInTotals } {
  const rows: CheckInRow[] = [];
  const busy = new Set<string>();
  for (const room of sortRooms(rooms)) {
    const stays = reservations
      .filter((r) => STAY.includes(r.status) && r.room_number === room.number && r.check_in_date <= dateTo && r.check_out_date >= dateFrom)
      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date));
    if (!stays.length) {
      rows.push({
        room: roomLabel(room.number), guest: '', checkIn: '', checkOut: '', status: 'Available',
        receipt: '', amount: null, user: '', checkInAt: '', checkInRole: '', checkOutAt: '',
        checkOutBy: '', checkOutRole: '', paymentPlan: '', balance: 0, dueDate: '',
        balanceReason: '', extensions: '',
      });
      continue;
    }
    busy.add(room.number);
    for (const r of stays) {
      const total = roomFolio(r, sales);
      const paid = reservationPaid(r);
      const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      rows.push({
        room: roomLabel(room.number),
        guest: r.guest_name,
        checkIn: r.check_in_date,
        checkOut: scheduledCheckout(r.check_out_date, r.check_out_time),
        status: balance === 0 ? 'Paid' : 'Unpaid',
        receipt: r.receipt_no ?? '',
        amount: total,
        user: r.confirmed_by ?? '',
        checkInAt: formatLocalDateTime(r.confirmed_at),
        checkInRole: r.confirmed_role ?? '',
        checkOutAt: formatLocalDateTime(r.checked_out_at),
        checkOutBy: r.checked_out_by ?? '',
        checkOutRole: r.checked_out_role ?? '',
        paymentPlan: r.payment_plan ?? paymentPlanFor(paid, total),
        balance,
        dueDate: r.payment_due_date ?? '',
        balanceReason: r.payment_reason ?? '',
        extensions: (r.stay_extensions ?? []).map((extension) =>
          `${extension.from_date} ${extension.from_time ?? ''} → ${extension.to_date} ${extension.to_time}; ${extension.reason}; by ${extension.changed_by} (${extension.changed_role}) at ${formatLocalDateTime(extension.changed_at)}`,
        ).join('\n'),
      });
    }
  }
  return {
    rows,
    totals: {
      occupied: busy.size,
      available: rooms.length - busy.size,
      unpaid: rows.filter((r) => r.status === 'Unpaid').length,
      revenue: Math.round(rows.reduce((sum, row) => sum + ((row.amount ?? 0) - row.balance), 0) * 100) / 100,
    },
  };
}

export const totalsLine = (t: CheckInTotals) => `Total Occupied: ${t.occupied}   Available: ${t.available}   Unpaid: ${t.unpaid}   Revenue received: ${money(t.revenue)}`;

export function generateCheckInStatusPdf(o: { propertyName: string; rooms: Room[]; reservations: Reservation[]; sales?: Sale[]; dateFrom: string; dateTo: string; frontDeskUserName: string; frontDeskRole: string }) {
  const { rows, totals } = buildCheckInRows(o.rooms, o.reservations, o.dateFrom, o.dateTo, o.sales);
  const doc = new jsPDF('landscape', 'mm', 'a3');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
  doc.text(`GILNET PROPERTY MANAGER - ${o.propertyName.toUpperCase()}`, 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`Room Check-In Status Report (${o.dateFrom} to ${o.dateTo})`, 14, 22);
  autoTable(doc, {
    startY: 28,
    head: [['Room No', 'Guest Name', 'Check-In Date', 'Actual Check-In', 'Checked In By / Role', 'Scheduled Check-Out', 'Actual Check-Out', 'Checked Out By / Role', 'Plan', 'Amount Paid', 'Balance', 'Due Date', 'Balance Reason', 'Extensions', 'Status', 'Receipt No']],
    body: rows.map((r) => [
      r.room, r.guest, r.checkIn, r.checkInAt, [r.user, r.checkInRole].filter(Boolean).join(' / '),
      r.checkOut, r.checkOutAt, [r.checkOutBy, r.checkOutRole].filter(Boolean).join(' / '),
      r.paymentPlan, r.amount == null ? '' : money(r.amount - r.balance), money(r.balance), r.dueDate,
      r.balanceReason, r.extensions, r.status, r.receipt,
    ]),
    headStyles: { fillColor: [13, 71, 161], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [51, 51, 51], cellPadding: 3, fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [242, 246, 250] },
    styles: { lineColor: [200, 200, 200], lineWidth: 0.1, font: 'helvetica' },
    columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 }, 3: { cellWidth: 28 }, 4: { cellWidth: 28 }, 5: { cellWidth: 28 }, 6: { cellWidth: 28 }, 7: { cellWidth: 28 }, 8: { cellWidth: 15 }, 9: { cellWidth: 20 }, 10: { cellWidth: 18 }, 11: { cellWidth: 20 }, 12: { cellWidth: 30 }, 13: { cellWidth: 45 }, 14: { cellWidth: 18 }, 15: { cellWidth: 24 } },
    margin: { left: 14, right: 14, bottom: 18 },
  });
  const pageH = doc.internal.pageSize.height;
  let y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 28) + 10;
  if (y > pageH - 20) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text(totalsLine(totals), 14, y);
  const now = new Date();
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100);
    doc.text(`Printed by ${o.frontDeskUserName || 'Unknown'} (${o.frontDeskRole}) on ${now.toLocaleString()}`, 14, pageH - 10);
  }
  return { doc, rows, totals, filename: `${o.propertyName.replace(/[^\w-]+/g, '_')}_Room_CheckIn_Status_Report_${o.dateFrom}_to_${o.dateTo}.pdf` };
}
