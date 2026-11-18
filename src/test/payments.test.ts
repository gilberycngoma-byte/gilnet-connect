import { describe, expect, it } from "vitest";
import { paymentPlanFor, reservationPaymentPlan } from "@/lib/payments";
import type { Reservation } from "@/lib/types";

describe("guest payment plans", () => {
  it("classifies full, partial, and pay-later payments from paid and total amounts", () => {
    expect(paymentPlanFor(100, 100)).toBe("Full");
    expect(paymentPlanFor(25, 100)).toBe("Partial");
    expect(paymentPlanFor(0, 100)).toBe("Pay Later");
  });

  it("uses a saved plan when present and derives one for older reservations", () => {
    const reservation: Reservation = {
      id: "stay-1",
      property_code: "LUS001",
      guest_name: "Guest One",
      room_number: "01",
      preferred_room: "01",
      check_in_date: "2026-10-01",
      check_out_date: "2026-10-02",
      num_guests: 1,
      status: "Confirmed Check-In",
      payment_status: "Unpaid",
      total_amount: 100,
      amount_paid: 25,
      confirmed_by: "Front Desk",
      confirmed_at: null,
      cancellation_reason: null,
      noShowReason: null,
      noShowFee: null,
      noShowAt: null,
      created_at: "2026-10-01T10:00:00.000Z",
    };

    expect(reservationPaymentPlan(reservation)).toBe("Partial");
    expect(reservationPaymentPlan({ ...reservation, payment_plan: "Pay Later" })).toBe("Pay Later");
  });
});
