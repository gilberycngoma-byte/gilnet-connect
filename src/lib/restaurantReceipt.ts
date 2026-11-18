import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money } from "./payments";
import { saleDate, type Sale } from "./restaurant";

export function generateRestaurantReceiptPdf(propertyName: string, sale: Sale) {
  const doc = new jsPDF("portrait", "mm", "a5");
  const pageWidth = doc.internal.pageSize.getWidth();
  const receiptNumber = sale.receipt_no?.trim() || sale.id;
  const date = saleDate(sale);
  const service = sale.service ?? "Restaurant";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(propertyName, pageWidth / 2, 16, { align: "center", maxWidth: pageWidth - 24 });
  doc.setFontSize(12);
  doc.text("RESTAURANT RECEIPT", pageWidth / 2, 25, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Receipt No: ${receiptNumber}`, 12, 35);
  doc.text(`Date: ${date}`, 12, 41);
  doc.text(`Service: ${service}`, 12, 47);
  doc.text(`Room: ${sale.room_number ?? "Walk-in"}`, 12, 53);
  doc.text(`Payment: ${sale.method === "Card" ? "Visa/Card" : sale.method}`, 12, 59);
  doc.text(`Recorded by: ${sale.staff}`, 12, 65);

  autoTable(doc, {
    startY: 71,
    head: [["Item", "Qty", "Price", "Amount"]],
    body: sale.items.map((item) => [
      item.name,
      String(item.quantity),
      money(item.price),
      money(item.price * item.quantity),
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [13, 89, 97], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 13, halign: "right" },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 27, halign: "right" },
    },
    margin: { left: 12, right: 12, bottom: 20 },
    foot: [["TOTAL", "", "", money(sale.total)]],
    showFoot: "lastPage",
    footStyles: { fontStyle: "bold", textColor: [0, 0, 0], fillColor: [245, 248, 249] },
  });

  const lastTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let footerY = (lastTable?.finalY ?? 65) + 10;
  const comments = sale.comments?.trim();
  if (comments) {
    if (footerY > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      footerY = 15;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Comments:", 12, footerY);
    doc.setFont("helvetica", "normal");
    const commentLines = doc.splitTextToSize(comments, pageWidth - 24);
    doc.text(commentLines, 12, footerY + 5);
    footerY += 7 + commentLines.length * 4;
  }
  if (footerY < doc.internal.pageSize.getHeight() - 12) {
    doc.setFontSize(9);
    doc.text("Thank you for your visit.", pageWidth / 2, footerY, { align: "center" });
  }

  return {
    doc,
    receiptNumber,
    filename: `${receiptNumber.replace(/[^\w-]+/g, "_")}_Restaurant_Receipt.pdf`,
  };
}
