import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, useSession } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { createDailyReport } from "@/lib/report";
import { buildCheckInRows, generateCheckInStatusPdf, totalsLine } from "@/lib/pdfReport";
import {
  buildSalesRows,
  downloadSalesExcel,
  generateSalesReportPdf,
  getMonthDateRange,
} from "@/lib/salesReport";
import {
  buildRestaurantSalesRows,
  downloadRestaurantSalesExcel,
  generateRestaurantSalesReportPdf,
} from "@/lib/restaurantSalesReport";
import { money } from "@/lib/payments";
import type { Notice, Property, Reservation, Room } from "@/lib/types";
import type { Sale } from "@/lib/restaurant";

function useReportData() {
  const s = useSession();
  const c = s?.property_code ?? "";
  return {
    session: s,
    property: useStored<Property | null>(keys.property(c), null),
    rooms: useStored<Room[]>(keys.rooms(c), []),
    reservations: useStored<Reservation[]>(keys.reservations(c), []),
    notices: useStored<Notice[]>(keys.notices(c), []),
    sales: useStored<Sale[]>(keys.sales(c), []),
  };
}

export function ReportButton() {
  const d = useReportData();
  const printedBy = `${d.session?.user_name ?? "Unknown"} (${d.session?.role ?? "Unknown"})`;
  return (
    <Button
      variant="outline"
      onClick={() =>
        createDailyReport(
          d.property,
          d.rooms,
          d.reservations,
          d.notices,
          d.sales,
          undefined,
          printedBy,
        ).save(`GILNET-Report-${new Date().toISOString().slice(0, 10)}.pdf`)
      }
    >
      <Download className="h-4 w-4" /> Export
    </Button>
  );
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function ReportsPanel() {
  const d = useReportData();
  const name = d.property?.name ?? d.session?.property_code ?? "Property";
  const printedBy = `${d.session?.user_name ?? "Unknown"} (${d.session?.role ?? "Unknown"})`;
  const initialMonth = today().slice(0, 7);
  const initialRange = getMonthDateRange(initialMonth) ?? { from: today(), to: today() };
  const [month, setMonth] = useState(initialMonth);
  const [sFrom, setSFrom] = useState(initialRange.from);
  const [sTo, setSTo] = useState(initialRange.to);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [shown, setShown] = useState(true);
  const [reportType, setReportType] = useState<"room-status" | "restaurant-sales">("room-status");
  const restaurantReport = useMemo(() => {
    try {
      return { rows: buildRestaurantSalesRows(d.sales, sFrom, sTo), error: "" };
    } catch (error) {
      return {
        rows: [],
        error:
          error instanceof Error ? error.message : "Could not prepare the restaurant sales report.",
      };
    }
  }, [d.sales, sFrom, sTo]);
  if (!can(d.session?.role, "reports"))
    return (
      <p className="text-sm text-muted-foreground">
        Reports are available to front desk, supervisors and managers.
      </p>
    );
  const preview = buildCheckInRows(d.rooms, d.reservations, from, to, d.sales);
  const pdf = () =>
    generateCheckInStatusPdf({
      propertyName: name,
      rooms: d.rooms,
      reservations: d.reservations,
      sales: d.sales,
      dateFrom: from,
      dateTo: to,
      frontDeskUserName: d.session?.user_name ?? "",
      frontDeskRole: d.session?.role ?? "Front Desk",
    });
  const getSalesRows = () => {
    if (!sFrom || !sTo || sFrom > sTo) {
      toast.error("Choose a valid report start date and end date.");
      return null;
    }
    try {
      return buildSalesRows(d.rooms, d.reservations, d.sales, sFrom, sTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare the sales report.");
      return null;
    }
  };
  const exportSalesExcel = async () => {
    const rows = getSalesRows();
    if (!rows) return;
    try {
      await downloadSalesExcel(name, rows, sFrom, sTo, printedBy);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the Excel report.");
    }
  };
  const exportSalesPdf = (print = false) => {
    const rows = getSalesRows();
    if (!rows) return;
    const report = generateSalesReportPdf(name, rows, sFrom, sTo, printedBy);
    if (print) {
      report.doc.autoPrint();
      window.open(report.doc.output("bloburl"), "_blank");
    } else {
      report.doc.save(report.filename);
    }
  };
  const exportRestaurantExcel = async () => {
    if (restaurantReport.error) {
      toast.error(restaurantReport.error);
      return;
    }
    try {
      await downloadRestaurantSalesExcel(name, restaurantReport.rows, sFrom, sTo, printedBy);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the Excel report.");
    }
  };
  const exportRestaurantPdf = (print = false) => {
    if (restaurantReport.error) {
      toast.error(restaurantReport.error);
      return;
    }
    const report = generateRestaurantSalesReportPdf(
      name,
      restaurantReport.rows,
      sFrom,
      sTo,
      printedBy,
    );
    if (print) {
      report.doc.autoPrint();
      window.open(report.doc.output("bloburl"), "_blank");
    } else {
      report.doc.save(report.filename);
    }
  };
  return (
    <div className="space-y-6">
      <div role="group" aria-label="Report type" className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={reportType === "room-status" ? "default" : "outline"}
          aria-pressed={reportType === "room-status"}
          onClick={() => setReportType("room-status")}
        >
          Room Status
        </Button>
        <Button
          type="button"
          variant={reportType === "restaurant-sales" ? "default" : "outline"}
          aria-pressed={reportType === "restaurant-sales"}
          onClick={() => setReportType("restaurant-sales")}
        >
          Restaurant Sales
        </Button>
      </div>
      {reportType === "room-status" ? (
        <>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <FileSpreadsheet className="h-5 w-5 text-primary" /> Room Status Sales Report
            </h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="sales-month">Full month</Label>
                <Input
                  id="sales-month"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    const range = getMonthDateRange(e.target.value);
                    if (range) {
                      setSFrom(range.from);
                      setSTo(range.to);
                    }
                  }}
                />
              </div>
              <div>
                <Label htmlFor="sf">Date from</Label>
                <Input
                  id="sf"
                  type="date"
                  value={sFrom}
                  onChange={(e) => setSFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="st">Date to</Label>
                <Input id="st" type="date" value={sTo} onChange={(e) => setSTo(e.target.value)} />
              </div>
              <Button onClick={() => void exportSalesExcel()}>
                <Download /> Export Excel
              </Button>
              <Button variant="outline" onClick={() => exportSalesPdf()}>
                <FileText /> Export PDF
              </Button>
              <Button variant="outline" onClick={() => exportSalesPdf(true)}>
                <Printer /> Print PDF
              </Button>
            </div>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <FileText className="h-5 w-5 text-primary" /> Room Check-In Status Report (PDF)
            </h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="pf">Date from</Label>
                <Input id="pf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pt">Date to</Label>
                <Input id="pt" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => setShown(true)}>
                Preview
              </Button>
              <Button
                onClick={() => {
                  const r = pdf();
                  r.doc.save(r.filename);
                }}
              >
                <Download /> Export PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const r = pdf();
                  r.doc.autoPrint();
                  window.open(r.doc.output("bloburl"), "_blank");
                }}
              >
                <Printer /> Print
              </Button>
            </div>
            {shown && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1500px] text-left text-sm">
                  <thead className="bg-report-blue text-primary-foreground">
                    <tr>
                      {[
                        "Room",
                        "Guest",
                        "Check-In",
                        "Actual Check-In",
                        "Checked In By / Role",
                        "Scheduled Check-Out",
                        "Actual Check-Out",
                        "Checked Out By / Role",
                        "Plan",
                        "Amount Paid",
                        "Balance",
                        "Due Date",
                        "Balance Reason",
                        "Extensions",
                        "Status",
                        "Receipt",
                      ].map((h) => (
                        <th key={h} className="p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={`${r.room}-${i}`} className={i % 2 ? "bg-muted" : "bg-card"}>
                        <td className="p-2">{r.room}</td>
                        <td className="p-2">{r.guest}</td>
                        <td className="p-2">{r.checkIn}</td>
                        <td className="p-2">{r.checkInAt}</td>
                        <td className="p-2">
                          {[r.user, r.checkInRole].filter(Boolean).join(" / ")}
                        </td>
                        <td className="p-2">{r.checkOut}</td>
                        <td className="p-2">{r.checkOutAt}</td>
                        <td className="p-2">
                          {[r.checkOutBy, r.checkOutRole].filter(Boolean).join(" / ")}
                        </td>
                        <td className="p-2">{r.paymentPlan}</td>
                        <td className="p-2">
                          {r.amount == null ? "" : money(r.amount - r.balance)}
                        </td>
                        <td className="p-2">{money(r.balance)}</td>
                        <td className="p-2">{r.dueDate}</td>
                        <td className="p-2">{r.balanceReason}</td>
                        <td className="whitespace-pre-wrap p-2">{r.extensions}</td>
                        <td className="p-2">{r.status}</td>
                        <td className="p-2">{r.receipt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-sm font-bold">
                  {totalsLine(preview.totals)} · Printed by {printedBy}
                </p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Restaurant Sales Report
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Includes restaurant, bar, and room-service sales. Laundry is excluded.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="restaurant-sales-month">Full month</Label>
              <Input
                id="restaurant-sales-month"
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  const range = getMonthDateRange(e.target.value);
                  if (range) {
                    setSFrom(range.from);
                    setSTo(range.to);
                  }
                }}
              />
            </div>
            <div>
              <Label htmlFor="restaurant-sales-from">Date from</Label>
              <Input
                id="restaurant-sales-from"
                type="date"
                value={sFrom}
                onChange={(e) => setSFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="restaurant-sales-to">Date to</Label>
              <Input
                id="restaurant-sales-to"
                type="date"
                value={sTo}
                onChange={(e) => setSTo(e.target.value)}
              />
            </div>
            <Button onClick={() => void exportRestaurantExcel()}>
              <Download /> Export Excel
            </Button>
            <Button variant="outline" onClick={() => exportRestaurantPdf()}>
              <FileText /> Export PDF
            </Button>
            <Button variant="outline" onClick={() => exportRestaurantPdf(true)}>
              <Printer /> Print PDF
            </Button>
          </div>
          {restaurantReport.error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {restaurantReport.error}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1500px] text-left text-xs">
                <thead className="bg-report-blue text-primary-foreground">
                  <tr>
                    {[
                      "Date",
                      "Room Number",
                      "Item Name",
                      "Qty",
                      "Price",
                      "Beverages and Other",
                      "Bev. and Other Price",
                      "Qty",
                      "Room Service",
                      "Room Service Qty",
                      "Total Sales Qty",
                      "Total Sales",
                      "Payment Method",
                      "Status",
                      "Comments",
                      "Receipt Number",
                    ].map((header, index) => (
                      <th key={`${header}-${index}`} className="p-2">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {restaurantReport.rows.map((row, index) => (
                    <tr key={row.receiptNumber} className={index % 2 ? "bg-muted" : "bg-card"}>
                      <td className="p-2">{row.date}</td>
                      <td className="p-2">{row.roomNumber}</td>
                      <td className="p-2">{row.itemName}</td>
                      <td className="p-2">{row.quantity || ""}</td>
                      <td className="p-2">{row.quantity ? money(row.price) : ""}</td>
                      <td className="p-2">{row.beveragesAndOther}</td>
                      <td className="p-2">
                        {row.beveragesQuantity ? money(row.beveragesPrice) : ""}
                      </td>
                      <td className="p-2">{row.beveragesQuantity || ""}</td>
                      <td className="p-2">{row.roomService}</td>
                      <td className="p-2">{row.roomServiceQuantity || ""}</td>
                      <td className="p-2">{row.totalQuantity}</td>
                      <td className="p-2">{money(row.totalSales)}</td>
                      <td className="p-2">{row.paymentMethod}</td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2">{row.comments}</td>
                      <td className="p-2">{row.receiptNumber}</td>
                    </tr>
                  ))}
                  {!restaurantReport.rows.length && (
                    <tr>
                      <td colSpan={16} className="p-6 text-center text-muted-foreground">
                        No restaurant sales recorded for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-3 text-sm font-bold">
                Transactions: {restaurantReport.rows.length} · Total quantity:{" "}
                {restaurantReport.rows.reduce((sum, row) => sum + row.totalQuantity, 0)} · Total
                sales: {money(restaurantReport.rows.reduce((sum, row) => sum + row.totalSales, 0))}{" "}
                · Printed by {printedBy}
              </p>
            </div>
          )}
        </section>
      )}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Daily operations report (PDF)</h2>
          <p className="text-sm text-muted-foreground">
            Occupancy, arrivals, tasks and restaurant sales.
          </p>
        </div>
        <ReportButton />
      </section>
    </div>
  );
}
