import { describe, it, expect, beforeEach } from "vitest";
import { defaultRooms } from "@/lib/migrate";
import { can } from "@/lib/auth";
import { addRoom, nextRoomNumber } from "@/lib/actions";
import { keys, write } from "@/lib/db";
import { orderTotal, roomFolio, settleOrder, SERVICES, updateSale } from "@/lib/restaurant";
import type { Reservation } from "@/lib/types";
describe("GPM operational rules", () => {
  beforeEach(() => {
    write(keys.session, {
      property_code: "TEST",
      user_name: "Tester",
      user_email: "test@example.com",
      role: "Admin",
      remember: true,
      login_time: new Date().toISOString(),
      token: "test",
    });
    write(keys.rooms("TEST"), []);
    write(keys.sales("TEST"), []);
    write(keys.reservations("TEST"), []);
    write(keys.property("TEST"), {
      name: "Test Lodge",
      address: "",
      phone: "",
    });
  });
  it("initializes exactly rooms 1 through 15", () =>
    expect(defaultRooms().map((r) => r.number)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
    ]));
  it("lets Admins add rooms beyond the initial 15", () => {
    write(keys.rooms("TEST"), defaultRooms());
    expect(nextRoomNumber(defaultRooms())).toBe("16");
    expect(addRoom({ number: "16", type: "Deluxe", floor: "2", price: 120 })).toMatchObject({
      number: "16",
      type: "Deluxe",
      status: "Available",
    });
    expect(JSON.parse(localStorage.getItem(keys.rooms("TEST")) ?? "[]")).toHaveLength(16);
  });
  it("rejects duplicate room numbers and unauthorized room creation", () => {
    write(keys.rooms("TEST"), defaultRooms());
    expect(() => addRoom({ number: "1", type: "Standard", floor: "1", price: 0 })).toThrow(
      "already exists",
    );
    write(keys.session, {
      property_code: "TEST",
      user_name: "Manager",
      user_email: "manager@example.com",
      role: "Manager",
      remember: true,
      login_time: new Date().toISOString(),
      token: "manager",
    });
    expect(() => addRoom({ number: "16", type: "Standard", floor: "1", price: 0 })).toThrow(
      "Only Admins",
    );
    expect(can("Manager", "room_admin")).toBe(false);
    write(keys.session, {
      property_code: "TEST",
      user_name: "Desk",
      user_email: "desk@example.com",
      role: "Front Desk",
      remember: true,
      login_time: new Date().toISOString(),
      token: "desk",
    });
    expect(() => addRoom({ number: "16", type: "Standard", floor: "1", price: 0 })).toThrow(
      "Only Admins",
    );
    expect(can("Front Desk", "room_admin")).toBe(false);
  });
  it("does not allow Front Desk to manage users", () =>
    expect(can("Front Desk", "users")).toBe(false));
  it("allows Admin to manage users", () => expect(can("Admin", "users")).toBe(true));
  it("calculates restaurant quantities", () =>
    expect(orderTotal([{ name: "Meal", price: 25, quantity: 3 }])).toBe(75));
  it("assigns sequential receipt numbers to recorded sales", () => {
    const first = settleOrder([{ name: "Meal", price: 25, quantity: 1 }], "Cash", "");
    const second = settleOrder([{ name: "Juice", price: 10, quantity: 1 }], "Cash", "");

    expect(first.receipt_no).toBe("TESTL-0001");
    expect(second.receipt_no).toBe("TESTL-0002");
  });
  it("accepts unique manually entered receipt numbers", () => {
    const first = settleOrder([{ name: "Meal", price: 25, quantity: 1 }], "Cash", "", {
      receipt_no: "  CASH-042 ",
    });

    expect(first.receipt_no).toBe("CASH-042");
    expect(() =>
      settleOrder([{ name: "Juice", price: 10, quantity: 1 }], "Cash", "", {
        receipt_no: "cash-042",
      }),
    ).toThrow("already been used");
    expect(() =>
      settleOrder([{ name: "Juice", price: 10, quantity: 1 }], "Cash", "", {
        receipt_no: "R".repeat(65),
      }),
    ).toThrow("64 characters or fewer");
  });
  it("offers Room Service instead of Laundry in restaurant services", () =>
    expect(SERVICES).toEqual(["Restaurant", "Bar", "Room Service"]));
  it("routes laundry sales to Front Desk instead of Restaurant staff", () => {
    write(keys.session, {
      property_code: "TEST",
      user_name: "Restaurant",
      user_email: "restaurant@example.com",
      role: "Restaurant",
      remember: true,
      login_time: new Date().toISOString(),
      token: "restaurant",
    });
    write(keys.rooms("TEST"), [
      { number: "1", type: "Standard", status: "Occupied", reservationId: "r1" },
    ]);
    expect(() =>
      settleOrder([{ name: "Laundry", price: 25, quantity: 1 }], "Room Charge", "1", {
        service: "Laundry",
      }),
    ).toThrow("cannot record sales");
    write(keys.session, {
      property_code: "TEST",
      user_name: "Desk",
      user_email: "desk@example.com",
      role: "Front Desk",
      remember: true,
      login_time: new Date().toISOString(),
      token: "desk",
    });
    expect(
      settleOrder([{ name: "Laundry", price: 25, quantity: 1 }], "Room Charge", "1", {
        service: "Laundry",
      }).service,
    ).toBe("Laundry");
  });
  it("rejects invalid quantities and non-finite prices", () => {
    expect(() => settleOrder([{ name: "Meal", price: 25, quantity: 1.5 }], "Cash", "")).toThrow(
      "valid items",
    );
    expect(() =>
      settleOrder([{ name: "Meal", price: Number.NaN, quantity: 1 }], "Cash", ""),
    ).toThrow("valid items");
  });
  it("updates all sale lines and recalculates the total", () => {
    const sale = settleOrder(
      [
        { name: "Meal", price: 25, quantity: 2 },
        { name: "Juice", price: 10, quantity: 1 },
      ],
      "Cash",
      "",
    );
    const items = [
      { name: "Meal", price: 30, quantity: 2 },
      { name: "Juice", price: 10, quantity: 1 },
    ];
    updateSale(sale.id, { items });
    expect(JSON.parse(localStorage.getItem(keys.sales("TEST")) ?? "[]")[0]).toMatchObject({
      items,
      total: 70,
    });
  });
  it("rejects room charge without occupied room", () =>
    expect(() =>
      settleOrder([{ name: "Meal", price: 25, quantity: 1 }], "Room Charge", "1"),
    ).toThrow("occupied"));
  it("adds restaurant room charges to the guest folio", () => {
    write(keys.rooms("TEST"), [
      { number: "1", type: "Standard", status: "Occupied", reservationId: "r1" },
    ]);
    const sale = settleOrder([{ name: "Meal", price: 25, quantity: 2 }], "Room Charge", "1");
    expect(roomFolio({ id: "r1", total_amount: 100 } as Reservation, [sale])).toBe(150);
  });
});
