import { describe, expect, it } from "vitest";
import type { Reservation, Room } from "@/lib/types";
import type { Sale } from "@/lib/restaurant";
import { buildSalesRows, buildSalesWorkbook, generateSalesReportPdf, getMonthDateRange } from "@/lib/salesReport";

const rooms: Room[] = [{ number: "01", type: "Standard", status: "Occupied", price: 500 }];

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "stay-1",
    property_code: "LUS001",
    guest_name: "Guest One",
    room_number: "01",
    preferred_room: "01",
    check_in_date: "2026-09-30",
    check_out_date: "2026-10-03",
    num_guests: 2,
    status: "Checked-Out",
    payment_status: "Paid",
    total_amount: 1500,
    confirmed_by: "Manager",
    confirmed_at: null,
    cancellation_reason: null,
    noShowReason: null,
    noShowFee: null,
    noShowAt: null,
    created_at: "2026-09-30T10:00:00.000Z",
    rate: 500,
    payment_method: "Cash",
    discount: 30,
    ...overrides,
  };
}

const sale = (date: string, id: string, reservationId = "stay-1"): Sale => ({
  id,
  items: [{ name: "Laundry", price: 50, quantity: 2 }],
  total: 100,
  method: "Cash",
  room_number: "01",
  reservation_id: reservationId,
  created_at: `${date}T10:00:00.000Z`,
  staff: "Front Desk",
  service: "Laundry",
  date,
});

describe("monthly room sales reports", () => {
  it("uses the complete calendar month, including leap days", () => {
    expect(getMonthDateRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(getMonthDateRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(getMonthDateRange("2026-13")).toBeNull();
  });

  it("includes overlapping stays and limits nights, laundry, and discount to the report month", () => {
    const rows = buildSalesRows(
      rooms,
      [
        reservation(),
        reservation({ id: "before", check_in_date: "2026-09-01", check_out_date: "2026-09-30" }),
        reservation({ id: "after", check_in_date: "2026-11-01", check_out_date: "2026-11-03" }),
        reservation({ id: "cancelled", status: "Cancelled", check_in_date: "2026-10-10", check_out_date: "2026-10-12" }),
      ],
      [sale("2026-09-30", "laundry-before"), sale("2026-10-02", "laundry-in"), sale("2026-11-01", "laundry-after")],
      "2026-10-01",
      "2026-10-31",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-09-30",
      checkIn: "2026-09-30",
      checkOut: "2026-10-03",
      nights: 2,
      laundryQty: 2,
      laundryPrice: 50,
      discount: 20,
      revenue: 1080,
    });
  });

  it("rejects an invalid report date range", () => {
    expect(() => buildSalesRows(rooms, [], [], "2026-10-31", "2026-10-01")).toThrow("valid report start date");
  });

  it("includes checkout audit, extensions, payment plan and outstanding folio balance", () => {
    const extended = reservation({
      amount_paid: 900,
      payment_status: "Unpaid",
      payment_plan: "Partial",
      check_out_time: "16:30",
      confirmed_at: "2026-09-30T10:15:00.000Z",
      confirmed_role: "Supervisor",
      checked_out_at: "2026-10-03T17:10:00.000Z",
      checked_out_by: "Manager One",
      checked_out_role: "Manager",
      payment_due_date: "2026-10-10",
      payment_reason: "Guest requested to settle later",
      stay_extensions: [{
        from_date: "2026-10-02",
        from_time: "11:00",
        to_date: "2026-10-03",
        to_time: "16:30",
        changed_at: "2026-10-02T09:00:00.000Z",
        changed_by: "Manager One",
        changed_role: "Manager",
        reason: "Guest requested another night",
      }],
    });
    const roomCharge = { ...sale("2026-10-02", "room-charge"), method: "Room Charge" as const };
    const rows = buildSalesRows(rooms, [extended], [roomCharge], "2026-10-01", "2026-10-31");

    expect(rows[0]).toMatchObject({
      scheduledCheckOutTime: "16:30",
      checkedInBy: "Manager",
      checkInRole: "Supervisor",
      checkedOutBy: "Manager One",
      checkOutRole: "Manager",
      paymentPlan: "Partial",
      amountPaid: 900,
      balance: 670,
      dueDate: "2026-10-10",
      balanceReason: "Guest requested to settle later",
    });
    expect(rows[0]?.actualCheckIn).toBe("2026-09-30T10:15:00.000Z");
    expect(rows[0]?.actualCheckOut).toBe("2026-10-03T17:10:00.000Z");
    expect(rows[0]?.extensionHistory).toContain("Guest requested another night");
    expect(rows[0]?.status).toBe("Unpaid");
  });

  it("centers the property title and configures the workbook for landscape printing", async () => {
    const rows = buildSalesRows(rooms, [reservation()], [sale("2026-10-02", "laundry-in")], "2026-10-01", "2026-10-31");
    const workbook = await buildSalesWorkbook("Lusaka Lodge", rows, "2026-10-01", "2026-10-31");
    const worksheet = workbook.getWorksheet("Sales Report");

    expect(worksheet?.getCell("A1").value).toBe("Lusaka Lodge Room Status Sales Report");
    expect(worksheet?.getCell("A1").alignment?.horizontal).toBe("center");
    expect(worksheet?.pageSetup.orientation).toBe("landscape");
    expect(worksheet?.pageSetup.fitToWidth).toBe(1);
    expect(worksheet?.pageSetup.printTitlesRow).toBe("1:4");
  }, 20_000);

  it("creates a PDF with the selected period in its filename", () => {
    const rows = buildSalesRows(rooms, [reservation()], [sale("2026-10-02", "laundry-in")], "2026-10-01", "2026-10-31");
    const report = generateSalesReportPdf("Lusaka Lodge", rows, "2026-10-01", "2026-10-31");

    expect(report.filename).toContain("2026-10-01_to_2026-10-31.pdf");
    expect(report.doc.getNumberOfPages()).toBeGreaterThan(0);
  });
});
