import { describe, expect, it } from "vitest";
import { buildCheckInRows, generateCheckInStatusPdf } from "@/lib/pdfReport";
import type { Reservation, Room } from "@/lib/types";

const room: Room = { number: "01", type: "Standard", status: "Occupied", price: 500, reservationId: "stay-1" };
const reservation: Reservation = {
  id: "stay-1",
  property_code: "LUS001",
  guest_name: "Guest One",
  room_number: "01",
  preferred_room: "01",
  check_in_date: "2026-10-01",
  check_out_date: "2026-10-03",
  check_out_time: "16:30",
  num_guests: 2,
  status: "Checked-Out",
  payment_status: "Unpaid",
  payment_plan: "Partial",
  amount_paid: 500,
  total_amount: 1000,
  payment_due_date: "2026-10-10",
  payment_reason: "Guest requested to settle later",
  confirmed_by: "Front Desk One",
  confirmed_role: "Supervisor",
  confirmed_at: "2026-10-01T10:15:00.000Z",
  checked_out_by: "Manager One",
  checked_out_role: "Manager",
  checked_out_at: "2026-10-03T17:10:00.000Z",
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
  cancellation_reason: null,
  noShowReason: null,
  noShowFee: null,
  noShowAt: null,
  created_at: "2026-09-30T10:00:00.000Z",
  rate: 500,
  payment_method: "Cash",
};

describe("guest stay reporting", () => {
  it("builds check-in report rows with actual events, extension, plan, and balance", () => {
    const report = buildCheckInRows([room], [reservation], "2026-10-01", "2026-10-03");

    expect(report.rows[0]).toMatchObject({
      guest: "Guest One",
      checkIn: "2026-10-01",
      checkOut: "2026-10-03 16:30",
      user: "Front Desk One",
      checkInRole: "Supervisor",
      checkOutBy: "Manager One",
      checkOutRole: "Manager",
      paymentPlan: "Partial",
      balance: 500,
      dueDate: "2026-10-10",
      balanceReason: "Guest requested to settle later",
      status: "Unpaid",
    });
    expect(report.rows[0]?.checkInAt).not.toBe("");
    expect(report.rows[0]?.checkOutAt).not.toBe("");
    expect(report.rows[0]?.extensions).toContain("Guest requested another night");
    expect(report.totals.revenue).toBe(500);
  });

  it("creates an export that identifies the report printer", () => {
    const pdf = generateCheckInStatusPdf({
      propertyName: "Lusaka Lodge",
      rooms: [room],
      reservations: [reservation],
      dateFrom: "2026-10-01",
      dateTo: "2026-10-03",
      frontDeskUserName: "Manager One",
      frontDeskRole: "Manager",
    });

    expect(pdf.doc.getNumberOfPages()).toBeGreaterThan(0);
    expect(pdf.filename).toContain("Room_CheckIn_Status_Report");
  });
});
