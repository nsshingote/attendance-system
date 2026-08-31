import jsPDF from "jspdf";
import { deliverPdf } from "@/lib/pdfDownload";

export type AppointmentLetterValues = {
  employee_name: string; designation: string; department: string; office_location: string;
  start_date: string; letter_date: string; company_address: string; salary: string;
  working_hours: string; working_days: string; authorized_signatory: string;
};

export function downloadAppointmentLetterPdf(values: AppointmentLetterValues, onIOSFileReady?: (file: File) => void) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  let y = 18;
  const paragraph = (text: string, bold = false) => { pdf.setFont("times", bold ? "bold" : "normal"); const lines = pdf.splitTextToSize(text, width - 34); pdf.text(lines, 17, y); y += lines.length * 6 + 4; };
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(20); pdf.setTextColor(234, 88, 12); pdf.text("Prop", 17, y); pdf.setTextColor(30, 58, 138); pdf.text("Checkup", 36, y); pdf.setFontSize(7); pdf.text("India's First Home Inspection Startup", 17, y + 5); y += 12;
  pdf.setDrawColor(249, 115, 22); pdf.setLineWidth(1); pdf.line(17, y, width - 17, y); y += 10;
  pdf.setTextColor(0, 0, 0); pdf.setFont("times", "bold"); pdf.setFontSize(16); pdf.text("APPOINTMENT LETTER", width / 2, y, { align: "center" }); y += 12; pdf.setFontSize(11);
  paragraph(`Date: ${values.letter_date}`); paragraph(`Company Address - ${values.company_address}`); y += 2;
  paragraph("To,"); paragraph(values.employee_name, true); paragraph(`Subject: Appointment for the Position of ${values.designation}`, true); paragraph(`Dear ${values.employee_name},`, true);
  paragraph(`We are pleased to offer you the position of ${values.designation} at PropCheckup. Based on your qualifications and experience, we believe you will be a valuable addition to our team.`);
  paragraph(`• Your appointment will be effective from ${values.start_date}. You will be working at our ${values.office_location} / ${values.department}.`);
  paragraph(`• Your compensation details are as follows: Salary: ${values.salary} per month/year.`);
  paragraph(`• Your working hours will be ${values.working_hours}, ${values.working_days}.`);
  paragraph("You are expected to comply with company policies, rules, and regulations at all times. Any breach may result in disciplinary action. Kindly sign and return a copy of this letter as a token of your acceptance.");
  paragraph("We look forward to having you on our team and wish you a successful career with us."); paragraph("Sincerely,"); y += 8; paragraph(values.authorized_signatory, true); paragraph("PropCheckup", true); y += 6; paragraph("• Employee Acceptance", true); paragraph(`I, ${values.employee_name}, accept the terms and conditions mentioned above.`); paragraph("Signature: ____________________                 Date: ______________");
  deliverPdf(pdf, `appointment-letter-${values.employee_name.replace(/\s+/g, "-").toLowerCase() || "employee"}.pdf`, null, onIOSFileReady);
}
