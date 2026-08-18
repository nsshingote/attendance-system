import jsPDF from "jspdf";

export function downloadDynamicLetterPdf(title: string, content: string, employeeName?: string) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 17;
  let y = 20;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(title.toUpperCase(), width / 2, y, { align: "center" });
  y += 12;
  pdf.setDrawColor(37, 99, 235);
  pdf.line(margin, y, width - margin, y);
  y += 10;
  pdf.setFont("times", "normal");
  pdf.setFontSize(11);

  for (const paragraph of content.split(/\n\s*\n/)) {
    const lines = pdf.splitTextToSize(paragraph || " ", width - margin * 2);
    const blockHeight = Math.max(lines.length, 1) * 6 + 5;
    if (y + blockHeight > height - 17) {
      pdf.addPage();
      y = 20;
    }
    pdf.text(lines, margin, y);
    y += blockHeight;
  }

  const employeeFileName = employeeName?.replace(/\s+/g, "-").toLowerCase() || "employee";
  const filename = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "letter"}-${employeeFileName}.pdf`;
  pdf.save(filename);
}
