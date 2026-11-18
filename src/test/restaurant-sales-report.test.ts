import { describe, expect, it } from "vitest";
import type { Sale } from "@/lib/restaurant";
import {
  buildRestaurantSalesRows,
  buildRestaurantSalesWorkbook,
  generateRestaurantSalesReportPdf,
  RESTAURANT_SALES_HEADERS,
} from "@/lib/restaurantSalesReport";
import { generateRestaurantReceiptPdf } from "@/lib/restaurantReceipt";

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale-1",
    items: [{ name: "Grilled fish", price: 125, quantity: 2 }],
    total: 250,
    method: "Cash",
    room_number: "12",
    reservation_id: null,
    created_at: "2026-10-12T10:00:00.000Z",
    staff: "Amina",
    service: "Restaurant",
    date: "2026-10-12",
    ...overrides,
  };
}

describe("restaurant sales reports", () => {
  it("maps restaurant, bar, and room-service sales to the matching template columns", () => {
    const rows = buildRestaurantSalesRows(
      [
        sale(),
        sale({
          id: "bar-sale",
          service: "Bar",
          receipt_no: "TEST-0002",
          comments: "Guest takeaway",
          items: [
            { name: "Juice", price: 15, quantity: 2 },
            { name: "Water", price: 10, quantity: 1 },
          ],
          total: 40,
          method: "Card",
          room_number: null,
        }),
        sale({
          id: "room-service-sale",
          service: "Room Service",
          method: "Room Charge",
          total: 250,
        }),
        sale({ id: "laundry-sale", service: "Laundry" }),
      ],
      "2026-10-01",
      "2026-10-31",
    );

    expect(rows).toHaveLength(3);
    const rowsByReceipt = new Map(rows.map((row) => [row.receiptNumber, row]));
    expect(rowsByReceipt.get("sale-1")).toMatchObject({
      date: "2026-10-12",
      roomNumber: "12",
      itemName: "Grilled fish",
      quantity: 2,
      price: 125,
      totalQuantity: 2,
      totalSales: 250,
      status: "Paid",
      receiptNumber: "sale-1",
    });
    expect(rowsByReceipt.get("TEST-0002")).toMatchObject({
      roomNumber: "Walk-in",
      beveragesAndOther: "Juice, Water",
      beveragesPrice: 13.33,
      beveragesQuantity: 3,
      totalSales: 40,
      paymentMethod: "Visa/Card",
      receiptNumber: "TEST-0002",
      comments: "Guest takeaway",
    });
    expect(rowsByReceipt.get("room-service-sale")).toMatchObject({
      roomService: "Grilled fish",
      roomServiceQuantity: 2,
      status: "Room Charge",
    });
    expect(rowsByReceipt.get("sale-1")?.comments).toBe("");
  });

  it("filters by inclusive dates and rejects an invalid report range", () => {
    const rows = buildRestaurantSalesRows(
      [
        sale({ id: "before", date: "2026-09-30" }),
        sale({ id: "included", date: "2026-10-01" }),
        sale({ id: "after", date: "2026-11-01" }),
      ],
      "2026-10-01",
      "2026-10-31",
    );

    expect(rows.map((row) => row.receiptNumber)).toEqual(["included"]);
    expect(() => buildRestaurantSalesRows([], "2026-10-31", "2026-10-01")).toThrow(
      "valid report start date",
    );
  });

  it("builds the Excel template and a downloadable PDF with matching report headers", async () => {
    const rows = buildRestaurantSalesRows([sale()], "2026-10-01", "2026-10-31");
    const workbook = await buildRestaurantSalesWorkbook(
      "Chaniche Executive Lodge",
      rows,
      "2026-10-01",
      "2026-10-31",
    );
    const worksheet = workbook.getWorksheet("Restaurant Sales");
    expect(worksheet?.getCell("A1").value).toBe("CHANICHE EXECUTIVE LODGE RESTAURANT SALES REPORT");
    expect(worksheet?.getCell("A4").value).toBe(RESTAURANT_SALES_HEADERS[0]);
    expect(worksheet?.getCell("P4").value).toBe(RESTAURANT_SALES_HEADERS[15]);
    expect(worksheet?.getCell("K5").value).toMatchObject({
      formula: "D5+H5+J5",
      result: 2,
    });
    expect(worksheet?.pageSetup.orientation).toBe("landscape");
    expect(worksheet?.pageSetup.paperSize).toBe(9);
    expect(worksheet?.pageSetup.fitToWidth).toBe(1);
    expect(worksheet?.getRow(4).height).toBe(24);
    expect(worksheet?.getRow(5).height).toBeLessThan(24);

    const report = generateRestaurantSalesReportPdf(
      "Chaniche Executive Lodge",
      rows,
      "2026-10-01",
      "2026-10-31",
    );
    expect(report.filename).toContain("2026-10-01_to_2026-10-31.pdf");
    expect(report.doc.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
    expect(report.doc.internal.pageSize.getHeight()).toBeCloseTo(210, 0);
    expect(report.doc.getNumberOfPages()).toBeGreaterThan(0);
  }, 20_000);

  it("creates a printable receipt using the stored sale receipt number", () => {
    const receipt = generateRestaurantReceiptPdf(
      "Chaniche Executive Lodge",
      sale({ receipt_no: "CHAN-0042" }),
    );

    expect(receipt.receiptNumber).toBe("CHAN-0042");
    expect(receipt.filename).toBe("CHAN-0042_Restaurant_Receipt.pdf");
    expect(receipt.doc.getNumberOfPages()).toBeGreaterThan(0);
  });
});
