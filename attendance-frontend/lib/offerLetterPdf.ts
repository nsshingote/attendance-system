import jsPDF from "jspdf";
import { deliverPdf } from "@/lib/pdfDownload";

export type OfferLetterValues = {
  employee_name: string;
  designation: string;
  department: string;
  place_of_posting: string;
  date_of_joining: string;
  letter_date: string;
  company_address: string;
  acceptance_date?: string;
};

export function downloadOfferLetterPdf(values: OfferLetterValues, onIOSFileReady?: (file: File) => void) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  let y = 18;
  
  const paragraph = (text: string, bold = false) => {
    pdf.setFont("times", bold ? "bold" : "normal");
    const lines = pdf.splitTextToSize(text, width - 34);
    pdf.text(lines, 17, y);
    y += lines.length * 6 + 4;
  };

  // Header
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(234, 88, 12);
  pdf.text("Prop", 17, y);
  pdf.setTextColor(30, 58, 138);
  pdf.text("Checkup", 36, y);
  pdf.setFontSize(7);
  pdf.text("India's First Home Inspection Startup", 17, y + 5);
  y += 12;

  // Divider line
  pdf.setDrawColor(249, 115, 22);
  pdf.setLineWidth(1);
  pdf.line(17, y, width - 17, y);
  y += 10;

  // Title
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("times", "bold");
  pdf.setFontSize(16);
  pdf.text("OFFER LETTER", width / 2, y, { align: "center" });
  y += 12;
  pdf.setFontSize(11);

  // Content
  paragraph(`Date: ${values.letter_date}`);
  paragraph(`Company Address - ${values.company_address}`);
  y += 2;

  paragraph("To,");
  paragraph(values.employee_name, true);
  paragraph(`Subject: Offer for Position of ${values.designation}`, true);
  paragraph(`Dear ${values.employee_name},`, true);

  paragraph(`We are pleased to extend an offer of employment to you for the position of ${values.designation} at PropCheckup. We believe your skills and experience make you an excellent fit for our organization.`);

  paragraph(`Position: ${values.designation}`);
  paragraph(`Department: ${values.department}`);
  paragraph(`Place of Posting: ${values.place_of_posting}`);
  paragraph(`Date of Joining: ${values.date_of_joining}`);

  paragraph("This offer is contingent upon:");
  paragraph("• Satisfactory background verification");
  paragraph("• Submission of required documents");
  paragraph("• Compliance with company policies");

  paragraph("The compensation and benefits will be discussed and finalized with the HR department. We look forward to your positive response by the date specified below.");

  if (values.acceptance_date) {
    paragraph(`Expected Response Date: ${values.acceptance_date}`);
  }

  paragraph("Please confirm your acceptance or discuss any queries with our HR department.");
  paragraph("We look forward to having you join PropCheckup.");
  paragraph("Sincerely,");
  y += 8;
  paragraph("Authorized Signatory", true);
  paragraph("PropCheckup", true);
  y += 6;

  paragraph("• Offer Acceptance", true);
  paragraph(`I, ${values.employee_name}, accept the terms and conditions mentioned in this offer letter.`);
  paragraph("Signature: ____________________                 Date: ______________");

  deliverPdf(pdf, `offer-letter-${values.employee_name.replace(/\s+/g, "-").toLowerCase() || "employee"}.pdf`, null, onIOSFileReady);
}
