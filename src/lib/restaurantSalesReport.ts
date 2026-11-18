import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saleDate, type Sale } from "./restaurant";

export const RESTAURANT_SALES_HEADERS = [
  "DATE",
  "ROOM NUMBER",
  "ITEM NAME",
  "QTY",
  "PRICE",
  "BEVERAGES AND OTHER",
  "BEV. AND OTHER PRICE",
  "QTY",
  "ROOM SERVICE",
  "ROOM SERVICE QTY",
  "TOTAL SALES QTY",
  "TOTAL SALES",
  "PAYMENT METHOD",
  "STATUS",
  "COMMENTS",
  "RECEIPT NUMBER",
] as const;

export type RestaurantSalesRow = {
  date: string;
  roomNumber: string;
  itemName: string;
  quantity: number;
  price: number;
  beveragesAndOther: string;
  beveragesPrice: number;
  beveragesQuantity: number;
  roomService: string;
  roomServiceQuantity: number;
  totalQuantity: number;
  totalSales: number;
  paymentMethod: string;
  status: string;
  comments: string;
  receiptNumber: string;
};

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function categoryDetails(sale: Sale) {
  if (
    !sale.items.length ||
    !sale.items.every(
      (item) =>
        item.name.trim() &&
        Number.isFinite(item.price) &&
        item.price >= 0 &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    )
  ) {
    throw new Error(`Sale ${sale.id} has invalid items and cannot be included in the report.`);
  }
  const quantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);
  const amount = sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    name: sale.items.map((item) => item.name.trim()).join(", "),
    quantity,
    unitPrice: Math.round((amount / quantity) * 100) / 100,
  };
}

export function buildRestaurantSalesRows(
  sales: Sale[],
  from: string,
  to: string,
): RestaurantSalesRow[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw new RangeError("Choose a valid report start date and end date.");
  }

  return sales
    .filter((sale) => (sale.service ?? "Restaurant") !== "Laundry")
    .map((sale) => {
      const service = sale.service ?? "Restaurant";
      if (!["Restaurant", "Bar", "Room Service"].includes(service)) {
        throw new Error(`Sale ${sale.id} has an unsupported service and cannot be included.`);
      }
      const date = saleDate(sale);
      if (!isIsoDate(date)) {
        throw new Error(
          `Sale ${sale.id} has an invalid date and cannot be included in the report.`,
        );
      }
      if (!Number.isFinite(sale.total) || sale.total < 0) {
        throw new Error(
          `Sale ${sale.id} has an invalid total and cannot be included in the report.`,
        );
      }
      const details = categoryDetails(sale);
      const row: RestaurantSalesRow = {
        date,
        roomNumber: sale.room_number ?? "Walk-in",
        itemName: "",
        quantity: 0,
        price: 0,
        beveragesAndOther: "",
        beveragesPrice: 0,
        beveragesQuantity: 0,
        roomService: "",
        roomServiceQuantity: 0,
        totalQuantity: details.quantity,
        totalSales: sale.total,
        paymentMethod: sale.method === "Card" ? "Visa/Card" : sale.method,
        status:
          sale.method === "Room Charge"
            ? "Room Charge"
            : sale.method === "Complimentary"
              ? "Complimentary"
              : "Paid",
        comments: sale.comments?.trim() ?? "",
        receiptNumber: sale.receipt_no?.trim() || sale.id,
      };

      if (service === "Restaurant") {
        row.itemName = details.name;
        row.quantity = details.quantity;
        row.price = details.unitPrice;
      } else if (service === "Bar") {
        row.beveragesAndOther = details.name;
        row.beveragesPrice = details.unitPrice;
        row.beveragesQuantity = details.quantity;
      } else {
        row.roomService = details.name;
        row.roomServiceQuantity = details.quantity;
      }
      return row;
    })
    .filter((row) => row.date >= from && row.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.receiptNumber.localeCompare(b.receiptNumber));
}

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const moneyFormat = '"K "#,##0.00;("K "#,##0.00);"-"';

export async function buildRestaurantSalesWorkbook(
  propertyName: string,
  rows: RestaurantSalesRow[],
  from: string,
  to: string,
  printedBy = "",
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GILNET GPM CONNECT";
  const worksheet = workbook.addWorksheet("Restaurant Sales", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  const lastColumn = RESTAURANT_SALES_HEADERS.length;
  const lastLetter = "P";
  const font = { name: "Arial", size: 8 };
  const columnWidths = [12, 8, 22, 6, 9, 20, 10, 6, 18, 10, 12, 12, 12, 14, 18, 16];
  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  worksheet.mergeCells(`A1:${lastLetter}1`);
  worksheet.getCell("A1").value = `${propertyName.toUpperCase()} RESTAURANT SALES REPORT`;
  worksheet.getCell("A1").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  worksheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 22;
  for (let column = 1; column <= lastColumn; column++) {
    worksheet.getCell(1, column).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0D5961" },
    };
  }
  worksheet.mergeCells(`A2:${lastLetter}2`);
  worksheet.getCell("A2").value = `Period: ${from} to ${to}`;
  worksheet.getCell("A2").font = { ...font, color: { argb: "FF555555" } };
  worksheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(2).height = 16;
  worksheet.mergeCells(`A3:${lastLetter}3`);
  worksheet.getCell("A3").value =
    `Restaurant, bar, and room-service sales${printedBy ? ` · Printed by ${printedBy}` : ""}`;
  worksheet.getCell("A3").font = { ...font, italic: true, color: { argb: "FF555555" } };
  worksheet.getCell("A3").alignment = { horizontal: "center", vertical: "middle" };

  const header = worksheet.getRow(4);
  RESTAURANT_SALES_HEADERS.forEach((value, index) => {
    const cell = header.getCell(index + 1);
    cell.value = value;
    cell.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D5961" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  header.height = 24;

  const firstRow = 5;
  rows.forEach((rowData, index) => {
    const rowNumber = firstRow + index;
    const row = worksheet.getRow(rowNumber);
    row.values = [
      asDate(rowData.date),
      rowData.roomNumber,
      rowData.itemName,
      rowData.quantity,
      rowData.price,
      rowData.beveragesAndOther,
      rowData.beveragesPrice,
      rowData.beveragesQuantity,
      rowData.roomService,
      rowData.roomServiceQuantity,
      { formula: `D${rowNumber}+H${rowNumber}+J${rowNumber}`, result: rowData.totalQuantity },
      rowData.totalSales,
      rowData.paymentMethod,
      rowData.status,
      rowData.comments,
      rowData.receiptNumber,
    ];
    const displayValues = [
      rowData.date,
      rowData.roomNumber,
      rowData.itemName,
      rowData.quantity,
      rowData.price,
      rowData.beveragesAndOther,
      rowData.beveragesPrice,
      rowData.beveragesQuantity,
      rowData.roomService,
      rowData.roomServiceQuantity,
      rowData.totalQuantity,
      rowData.totalSales,
      rowData.paymentMethod,
      rowData.status,
      rowData.comments,
      rowData.receiptNumber,
    ];
    const estimatedLines = displayValues.reduce<number>(
      (maximum, value, columnIndex) =>
        Math.max(
          maximum,
          Math.ceil(String(value ?? "").length / (columnWidths[columnIndex] ?? 10)),
        ),
      1,
    );
    row.height = Math.max(16, 5 + estimatedLines * 8);
    row.font = { ...font, color: { argb: "FF333333" } };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (index % 2) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      });
    }
  });

  const lastRow = firstRow + rows.length - 1;
  const totalRowNumber = lastRow + 1;
  const totalRow = worksheet.getRow(totalRowNumber);
  const sum = (column: string, value: number) =>
    rows.length ? { formula: `SUM(${column}${firstRow}:${column}${lastRow})`, result: value } : 0;
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(4).value = sum(
    "D",
    rows.reduce((total, row) => total + row.quantity, 0),
  );
  totalRow.getCell(8).value = sum(
    "H",
    rows.reduce((total, row) => total + row.beveragesQuantity, 0),
  );
  totalRow.getCell(10).value = sum(
    "J",
    rows.reduce((total, row) => total + row.roomServiceQuantity, 0),
  );
  totalRow.getCell(11).value = sum(
    "K",
    rows.reduce((total, row) => total + row.totalQuantity, 0),
  );
  totalRow.getCell(12).value = sum(
    "L",
    rows.reduce((total, row) => total + row.totalSales, 0),
  );
  totalRow.font = { ...font, bold: true };
  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
  });

  const totalSales = rows.reduce((total, row) => total + row.totalSales, 0);
  worksheet.getRow(totalRowNumber + 2).getCell(11).value = "Transactions";
  worksheet.getRow(totalRowNumber + 2).getCell(12).value = rows.length;
  worksheet.getRow(totalRowNumber + 3).getCell(11).value = "Total Sales";
  worksheet.getRow(totalRowNumber + 3).getCell(12).value = rows.length
    ? { formula: `SUM(L${firstRow}:L${lastRow})`, result: totalSales }
    : 0;
  worksheet.getRow(totalRowNumber + 2).font = { ...font, bold: true };
  worksheet.getRow(totalRowNumber + 3).font = { ...font, bold: true };

  ["E", "G", "L"].forEach((column) => {
    worksheet.getColumn(column).numFmt = moneyFormat;
  });
  worksheet.getColumn("A").numFmt = "yyyy-mm-dd";
  for (let rowNumber = 4; rowNumber <= totalRowNumber; rowNumber++) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        ...cell.border,
        left: { style: "thin", color: { argb: "FFC8C8C8" } },
        right: { style: "thin", color: { argb: "FFC8C8C8" } },
        bottom: cell.border?.bottom ?? { style: "thin", color: { argb: "FFC8C8C8" } },
      };
    });
  }
  worksheet.autoFilter = { from: "A4", to: `P${Math.max(4, lastRow)}` };
  worksheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printArea: `A1:P${totalRowNumber + 3}`,
    printTitlesRow: "1:4",
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  worksheet.headerFooter.oddFooter = "&L&GILNET GPM CONNECT&CPage &P of &N&R&F";
  return workbook;
}

export async function downloadRestaurantSalesExcel(
  propertyName: string,
  rows: RestaurantSalesRow[],
  from: string,
  to: string,
  printedBy = "",
) {
  const workbook = await buildRestaurantSalesWorkbook(propertyName, rows, from, to, printedBy);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${propertyName.replace(/[^\w-]+/g, "_")}_Restaurant_Sales_Report_${from}_to_${to}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function generateRestaurantSalesReportPdf(
  propertyName: string,
  rows: RestaurantSalesRow[],
  from: string,
  to: string,
  printedBy = "",
) {
  const document = new jsPDF("landscape", "mm", "a4");
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  document.setFont("helvetica", "bold");
  document.setFontSize(12);
  document.setTextColor(0, 0, 0);
  document.text(`${propertyName.toUpperCase()} RESTAURANT SALES REPORT`, pageWidth / 2, 14, {
    align: "center",
    maxWidth: pageWidth - 20,
  });
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.setTextColor(80, 80, 80);
  document.text(`Period: ${from} to ${to}`, pageWidth / 2, 20, { align: "center" });

  autoTable(document, {
    startY: 24,
    head: [[...RESTAURANT_SALES_HEADERS]],
    body: rows.length
      ? rows.map((row) => [
          row.date,
          row.roomNumber,
          row.itemName,
          row.quantity,
          row.price.toFixed(2),
          row.beveragesAndOther,
          row.beveragesPrice.toFixed(2),
          row.beveragesQuantity,
          row.roomService,
          row.roomServiceQuantity,
          row.totalQuantity,
          row.totalSales.toFixed(2),
          row.paymentMethod,
          row.status,
          row.comments,
          row.receiptNumber,
        ])
      : [
          [
            "No restaurant sales recorded for this period",
            ...Array(RESTAURANT_SALES_HEADERS.length - 1).fill(""),
          ],
        ],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 5,
      cellPadding: 0.7,
      overflow: "linebreak",
      textColor: [51, 51, 51],
    },
    headStyles: {
      fillColor: [13, 89, 97],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 5,
    },
    alternateRowStyles: { fillColor: [242, 246, 250] },
    margin: { left: 5, right: 5, bottom: 15 },
    didDrawPage: () => {
      document.setFont("helvetica", "normal");
      document.setFontSize(7);
      document.setTextColor(100, 100, 100);
      document.text(
        `Printed by ${printedBy || "Unknown"} · ${new Date().toLocaleString()}`,
        5,
        pageHeight - 5,
      );
      document.text(`${document.getCurrentPageInfo().pageNumber}`, pageWidth - 5, pageHeight - 5, {
        align: "right",
      });
    },
  });

  const totalSales = rows.reduce((sum, row) => sum + row.totalSales, 0);
  const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0);
  const lastTable = (document as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let summaryY = (lastTable?.finalY ?? 24) + 5;
  if (summaryY > pageHeight - 12) {
    document.addPage();
    summaryY = 15;
  }
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.setTextColor(0, 0, 0);
  document.text(
    `Transactions: ${rows.length}   Total quantity: ${totalQuantity}   Total sales: K ${totalSales.toFixed(2)}`,
    5,
    summaryY,
    { maxWidth: pageWidth - 10 },
  );

  return {
    doc: document,
    filename: `${propertyName.replace(/[^\w-]+/g, "_")}_Restaurant_Sales_Report_${from}_to_${to}.pdf`,
  };
}
