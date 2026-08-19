import jsPDF from "jspdf";

type CompanyBranding = { company_name: string; company_address: string; logo_url?: string };

const loadImage = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Company logo could not be loaded");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Company logo could not be read"));
    reader.readAsDataURL(blob);
  });
};

export async function downloadDynamicLetterPdf(title: string, content: string, employeeName?: string, company?: CompanyBranding) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 17;
  let y = 18;

  const companyName = company?.company_name || "PropCheckup";
  const companyAddress = company?.company_address || "Office No. 62, Xth Central Mall, 2nd Floor, Above Kotak Bank, Mahavir Nagar, Kandivali West, Mumbai - 400067";
  try {
    const logo = await loadImage(company?.logo_url || "/logo.jpg");
    pdf.addImage(logo, "JPEG", margin, y - 5, 18, 18);
  } catch {
    // Keep the generated document usable when the optional logo cannot load.
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(31, 41, 55);
  pdf.text(companyName, margin + 24, y + 3);
  y += 20;
  pdf.setDrawColor(37, 99, 235); pdf.setLineWidth(0.7); pdf.line(margin, y, width - margin, y); y += 11;
  pdf.setFontSize(15); pdf.text(title.toUpperCase(), width / 2, y, { align: "center" }); y += 12;
  pdf.setFont("times", "normal");
  pdf.setFontSize(11);

  for (const paragraph of content.split(/\n\s*\n/)) {
    const lines = pdf.splitTextToSize(paragraph || " ", width - margin * 2);
    const blockHeight = Math.max(lines.length, 1) * 6 + 5;
    if (y + blockHeight > height - 35) {
      pdf.addPage();
      y = 22;
    }
    pdf.text(lines, margin, y);
    y += blockHeight;
  }

  pdf.setDrawColor(37, 99, 235); pdf.line(margin, height - 28, width - margin, height - 28);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(75, 85, 99);
  pdf.text(pdf.splitTextToSize(companyAddress, width - margin * 2), width / 2, height - 21, { align: "center" });

  const employeeFileName = employeeName?.replace(/\s+/g, "-").toLowerCase() || "employee";
  const filename = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "letter"}-${employeeFileName}.pdf`;
  pdf.save(filename);
}
