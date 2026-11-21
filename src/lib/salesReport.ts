import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { nightsBetween, paymentPlanFor, reservationPaid, reservationTotal, roomLabel } from './payments';
import { saleDate, type Sale } from './restaurant';
import type { Reservation, Room } from './types';

export const SALES_HEADERS = [
  'DATE', 'GUEST NAME', 'PAX', 'ROOM NO', 'ROOM TYPE', 'CHECK-IN', 'CHECK-OUT', 'NIGHTS',
  'ROOM RATE', 'LAUNDRY PRICE', 'LAUNDRY QTY', 'REVENUE', 'PAYMENT METHOD', 'STATUS',
  'RECEIPT NO',
] as const;

export type SalesRow = {
  date: string; guest: string; pax: number; room: string; type: string; checkIn: string; checkOut: string;
  nights: number; rate: number; laundryPrice: number; laundryQty: number; revenue: number; method: string;
  status: string; discount: number; occupancy: string; receipt: string; comment: string;
  scheduledCheckOutTime: string; actualCheckIn: string; checkedInBy: string; checkInRole: string;
  actualCheckOut: string; checkedOutBy: string; checkOutRole: string; paymentPlan: string;
  amountPaid: number; balance: number; dueDate: string; balanceReason: string; extensionHistory: string;
};

const DAY_MS = 86_400_000;

export function getMonthDateRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function nightsInRange(checkIn: string, checkOut: string, from: string, to: string) {
  const stayStart = Date.parse(`${checkIn}T00:00:00Z`);
  const stayEnd = Math.max(Date.parse(`${checkOut}T00:00:00Z`), stayStart + DAY_MS);
  const reportStart = Date.parse(`${from}T00:00:00Z`);
  const reportEnd = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  return Math.max(0, Math.round((Math.min(stayEnd, reportEnd) - Math.max(stayStart, reportStart)) / DAY_MS));
}

/** One row per stay overlapping the period; nights and laundry are limited to that period. */
export function buildSalesRows(rooms: Room[], reservations: Reservation[], sales: Sale[], from: string, to: string): SalesRow[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw new RangeError('Choose a valid report start date and end date.');
  }

  return reservations
    .filter((r) => r.status === 'Confirmed Check-In' || r.status === 'Checked-Out')
    .flatMap((r) => {
      if (!isIsoDate(r.check_in_date) || !isIsoDate(r.check_out_date) || r.check_out_date < r.check_in_date) {
        throw new Error(`Reservation ${r.id} has invalid stay dates and cannot be included in the report.`);
      }
      const nights = nightsInRange(r.check_in_date, r.check_out_date, from, to);
      if (!nights) return [];

      const room = rooms.find((x) => x.number === r.room_number);
      const stayNights = nightsBetween(r.check_in_date, r.check_out_date);
      const rate = r.rate ?? room?.price ?? Math.round((r.total_amount / stayNights) * 100) / 100;
      const laundry = sales.filter((s) => {
        const date = saleDate(s);
        return s.reservation_id === r.id && s.service === 'Laundry' &&
          isIsoDate(date) && date >= from && date <= to &&
          date >= r.check_in_date && date <= r.check_out_date;
      });
      const laundryQty = laundry.reduce((q, s) => q + s.items.reduce((n, i) => n + i.quantity, 0), 0);
      const laundryTotal = laundry.reduce((t, s) => t + s.items.reduce((n, i) => n + i.quantity * i.price, 0), 0);
      const laundryPrice = laundryQty ? laundryTotal / laundryQty : 0;
      const discount = Math.round(((r.discount ?? 0) * nights / stayNights) * 100) / 100;
      const method = r.payment_method ?? (r.payment_status === 'Paid' ? 'Cash' : 'Pending');
      const revenue = method === 'Complimentary' ? 0 : Math.round((nights * rate + laundryTotal - discount) * 100) / 100;
      const roomCharges = sales
        .filter((sale) => sale.reservation_id === r.id && sale.method === 'Room Charge')
        .reduce((sum, sale) => sum + sale.total, 0);
      const amountPaid = reservationPaid(r);
      const balance = Math.max(0, Math.round((reservationTotal(r) + roomCharges - amountPaid) * 100) / 100);
      return [{
        date: r.check_in_date,
        guest: r.guest_name,
        pax: r.num_guests || 1,
        room: roomLabel(r.room_number ?? ''),
        type: room?.type ?? '',
        checkIn: r.check_in_date,
        checkOut: r.check_out_date,
        nights,
        rate,
        laundryPrice,
        laundryQty,
        revenue,
        method,
        status: balance === 0 ? 'Paid' : 'Unpaid',
        discount,
        occupancy: r.status === 'Checked-Out' ? 'Checked-Out' : 'Checked-In',
        receipt: r.receipt_no ?? '',
        comment: r.notes ?? '',
        scheduledCheckOutTime: r.check_out_time ?? '',
        actualCheckIn: r.confirmed_at ?? '',
        checkedInBy: r.confirmed_by ?? '',
        checkInRole: r.confirmed_role ?? '',
        actualCheckOut: r.checked_out_at ?? '',
        checkedOutBy: r.checked_out_by ?? '',
        checkOutRole: r.checked_out_role ?? '',
        paymentPlan: r.payment_plan ?? paymentPlanFor(amountPaid, reservationTotal(r) + roomCharges),
        amountPaid,
        balance,
        dueDate: r.payment_due_date ?? '',
        balanceReason: r.payment_reason ?? '',
        extensionHistory: (r.stay_extensions ?? []).map((extension) =>
          `${extension.from_date} ${extension.from_time ?? ''} → ${extension.to_date} ${extension.to_time}; ${extension.reason}; by ${extension.changed_by} (${extension.changed_role}) at ${extension.changed_at}`,
        ).join('\n'),
      }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room, undefined, { numeric: true }));
}

const date = (s: string) => new Date(`${s}T00:00:00Z`);

/** Builds the "Sales Report" workbook with live Excel formulas for nights and totals. */
export async function buildSalesWorkbook(propertyName: string, rows: SalesRow[], from: string, to: string, printedBy = '') {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GILNET GPM CONNECT';
  const ws = wb.addWorksheet('Sales Report', { views: [{ state: 'frozen', ySplit: 4 }] });
  const font = { name: 'Arial', size: 10 };
  ws.mergeCells('A1:O1');
  ws.getCell('A1').value = `${propertyName} Room Status Sales Report`;
  ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;
  for (let column = 1; column <= SALES_HEADERS.length; column++) {
    ws.getCell(1, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
  }
  ws.mergeCells('A2:O2');
  ws.getCell('A2').value = `Period: ${from} to ${to}`;
  ws.getCell('A2').font = { ...font, color: { argb: 'FF555555' } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;
  ws.mergeCells('A3:O3');
  ws.getCell('A3').value = `Room status and sales details for stays overlapping the selected period${printedBy ? ` · Printed by ${printedBy}` : ''}`;
  ws.getCell('A3').font = { ...font, size: 9, italic: true, color: { argb: 'FF555555' } };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  const head = ws.getRow(4);
  SALES_HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  head.height = 30;
  const first = 5;
  rows.forEach((r, i) => {
    const n = first + i;
    const row = ws.getRow(n);
    row.values = [
      date(r.date), r.guest, r.pax, r.room, r.type, date(r.checkIn), date(r.checkOut),
      { formula: `G${n}-F${n}`, result: r.nights }, r.rate, r.laundryPrice, r.laundryQty,
      r.revenue,
      r.method, r.status, r.receipt,
    ];
    row.font = { ...font, color: { argb: 'FF333333' } };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.alignment = { vertical: 'top', wrapText: true }; });
    if (i % 2) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FA' } }; });
  });
  const last = first + rows.length - 1;
  const t = last + 1;
  const total = ws.getRow(t);
  const sum = (col: string, fallback: number) => (rows.length ? { formula: `SUM(${col}${first}:${col}${last})`, result: fallback } : 0);
  total.getCell(1).value = 'TOTAL';
  total.getCell(3).value = sum('C', rows.reduce((s, r) => s + r.pax, 0));
  total.getCell(8).value = sum('H', rows.reduce((s, r) => s + r.nights, 0));
  total.getCell(11).value = sum('K', rows.reduce((s, r) => s + r.laundryQty, 0));
  total.getCell(12).value = sum('L', rows.reduce((s, r) => s + r.revenue, 0));
  total.font = { ...font, bold: true };
  total.eachCell({ includeEmpty: true }, (c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; });
  const paid = rows.filter((r) => r.status === 'Paid').reduce((s, r) => s + r.revenue, 0);
  const summary: [string, { formula: string; result: number } | number][] = [
    ['Revenue received (Paid)', rows.length ? { formula: `SUMIF(N${first}:N${last},"Paid",L${first}:L${last})`, result: paid } : 0],
    ['Outstanding (Unpaid)', rows.length ? { formula: `SUMIF(N${first}:N${last},"Unpaid",L${first}:L${last})`, result: rows.reduce((s, r) => s + r.revenue, 0) - paid } : 0],
    ['Stays', rows.length ? { formula: `COUNTA(B${first}:B${last})`, result: rows.length } : 0],
  ];
  summary.forEach(([label, value], i) => {
    const row = ws.getRow(t + 2 + i);
    row.getCell(11).value = label;
    row.getCell(12).value = value;
    row.font = { ...font, bold: true };
  });
  const money = '"K "#,##0.00;("K "#,##0.00);"-"';
  ['I', 'J', 'L'].forEach((c) => { ws.getColumn(c).numFmt = money; });
  ws.getCell(`L${t + 4}`).numFmt = '0';
  ['A', 'F', 'G'].forEach((c) => { ws.getColumn(c).numFmt = 'yyyy-mm-dd'; });
  [12, 24, 7, 9, 13, 12, 12, 8, 12, 13, 12, 14, 16, 10, 17].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let n = 4; n <= t; n++) ws.getRow(n).eachCell({ includeEmpty: true }, (c) => { c.border = { ...c.border, left: { style: 'thin', color: { argb: 'FFC8C8C8' } }, right: { style: 'thin', color: { argb: 'FFC8C8C8' } }, bottom: c.border?.bottom ?? { style: 'thin', color: { argb: 'FFC8C8C8' } } }; });
  ws.autoFilter = { from: 'A4', to: 'O4' };
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 5,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printArea: `A1:O${t + 4}`,
    printTitlesRow: '1:4',
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter.oddFooter = '&L&GILNET GPM CONNECT&CPage &P of &N&R&F';
  return wb;
}

export async function downloadSalesExcel(propertyName: string, rows: SalesRow[], from: string, to: string, printedBy = '') {
  const wb = await buildSalesWorkbook(propertyName, rows, from, to, printedBy);
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${propertyName.replace(/[^\w-]+/g, '_')}_Room_Status_Sales_Report_${from}_to_${to}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function generateSalesReportPdf(propertyName: string, rows: SalesRow[], from: string, to: string, printedBy = '') {
  const doc = new jsPDF('landscape', 'mm', 'a3');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  doc.text(`${propertyName} Room Status Sales Report`, pageWidth / 2, 14, { align: 'center', maxWidth: pageWidth - 20 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Period: ${from} to ${to}`, pageWidth / 2, 21, { align: 'center' });
  autoTable(doc, {
    startY: 27,
    head: [[...SALES_HEADERS]],
    body: rows.length
      ? rows.map((r) => [
        r.date, r.guest, r.pax, r.room, r.type, r.checkIn, r.checkOut, r.nights,
        r.rate.toFixed(2), r.laundryPrice.toFixed(2), r.laundryQty, r.revenue.toFixed(2),
        r.method, r.status, r.receipt,
      ])
      : [['No stays recorded for this period', ...Array(SALES_HEADERS.length - 1).fill('')]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 6, cellPadding: 1.4, overflow: 'linebreak', textColor: [51, 51, 51] },
    headStyles: { fillColor: [13, 71, 161], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
    alternateRowStyles: { fillColor: [242, 246, 250] },
    margin: { left: 8, right: 8, bottom: 18 },
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: [0],
    didDrawPage: () => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(`Printed by ${printedBy || 'Unknown'} · ${new Date().toLocaleString()}`, 8, pageHeight - 7);
      doc.text(`${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 8, pageHeight - 7, { align: 'right' });
    },
  });

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const paidRevenue = rows.filter((row) => row.status === 'Paid').reduce((sum, row) => sum + row.revenue, 0);
  const lastTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let summaryY = (lastTable?.finalY ?? 27) + 7;
  if (summaryY > pageHeight - 18) {
    doc.addPage();
    summaryY = 15;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Stays: ${rows.length}   Nights in period: ${rows.reduce((sum, row) => sum + row.nights, 0)}   Laundry quantity: ${rows.reduce((sum, row) => sum + row.laundryQty, 0)}   Revenue: K ${totalRevenue.toFixed(2)}   Paid: K ${paidRevenue.toFixed(2)}   Outstanding: K ${(totalRevenue - paidRevenue).toFixed(2)}`,
    8,
    summaryY,
    { maxWidth: pageWidth - 16 },
  );
  return {
    doc,
    filename: `${propertyName.replace(/[^\w-]+/g, '_')}_Room_Status_Sales_Report_${from}_to_${to}.pdf`,
  };
}
