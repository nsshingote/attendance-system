import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { isDynamicPageBreak } from "@/lib/dynamicTemplateMarkers";
import { deliverPdf } from "@/lib/pdfDownload";

type EmployeeNameParam = string | undefined;

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

export async function downloadDynamicLetterPdf(title: string, content: string, employeeName?: EmployeeNameParam, previewElement?: HTMLElement | null, targetWindow?: Window | null) {
  const employeeFileName = employeeName?.replace(/\s+/g, "-").toLowerCase() || "employee";
  const filename = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "letter"}-${employeeFileName}.pdf`;
  const deliver = (pdf: jsPDF) => deliverPdf(pdf, filename, targetWindow);

  if (previewElement) {
    const pages = Array.from(previewElement.querySelectorAll<HTMLElement>("article"));
    if (pages.length) {
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
        const pageRect = page.getBoundingClientRect();
        page.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(anchor => {
          const rect = anchor.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          pdf.link(
            ((rect.left - pageRect.left) / pageRect.width) * 210,
            ((rect.top - pageRect.top) / pageRect.height) * 297,
            (rect.width / pageRect.width) * 210,
            (rect.height / pageRect.height) * 297,
            { url: anchor.href },
          );
        });
      }
      deliver(pdf);
      return;
    }
  }

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 17;
  let y = 18;

  const companyName = LETTER_BRANDING.companyName;
  const companyAddress = LETTER_BRANDING.address;
  try {
    const logo = await loadImage(LETTER_BRANDING.logoUrl);
    pdf.addImage(logo, "JPEG", margin, y - 5, 18, 18);
  } catch {
    // Keep the generated document usable when the optional logo cannot load.
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(31, 41, 55);
  pdf.text(companyName, margin + 24, y + 3);
  pdf.setFontSize(7);
  pdf.setTextColor(234, 88, 12);
  pdf.text(LETTER_BRANDING.tagline, margin + 24, y + 8);
  pdf.setFontSize(8);
  pdf.setTextColor(30, 58, 138);
  pdf.text(LETTER_BRANDING.website, width - margin, y - 2, { align: "right" });
  pdf.text(LETTER_BRANDING.email, width - margin, y + 3, { align: "right" });
  pdf.text(LETTER_BRANDING.phone, width - margin, y + 8, { align: "right" });
  y += 20;
  pdf.setDrawColor(37, 99, 235); pdf.setLineWidth(0.7); pdf.line(margin, y, width - margin, y); y += 11;
  pdf.setFontSize(15); pdf.text(title.toUpperCase(), width / 2, y, { align: "center" }); y += 12;
  pdf.setFont("times", "normal");
  pdf.setFontSize(11);

  const writeSection = (section: string) => {
    for (const paragraph of section.split(/\n\s*\n/)) {
      const lines = pdf.splitTextToSize(paragraph || " ", width - margin * 2);
      const blockHeight = Math.max(lines.length, 1) * 6 + 5;
      if (y + blockHeight > height - 35) {
        pdf.addPage();
        y = 22;
      }
      pdf.text(lines, margin, y);
      y += blockHeight;
    }
  };

  let section: string[] = [];
  content.split("\n").forEach((line) => {
    if (isDynamicPageBreak(line)) {
      writeSection(section.join("\n"));
      pdf.addPage();
      y = 22;
      section = [];
      return;
    }
    section.push(line);
  });
  if (section.length) {
    writeSection(section.join("\n"));
  }

  pdf.setDrawColor(37, 99, 235); pdf.line(margin, height - 28, width - margin, height - 28);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(75, 85, 99);
  pdf.text(pdf.splitTextToSize(companyAddress, width - margin * 2), width / 2, height - 21, { align: "center" });

  deliver(pdf);
}
