/** Canonical branding source for all employee documents. */
export const EMPLOYEE_DOCUMENT_LOGO_PATH = "/propcheckup-logo.png";

/** Load the canonical employee document logo as a data URL for jsPDF. */
export async function loadEmployeeDocumentLogoDataUrl(): Promise<string> {
  const response = await fetch(EMPLOYEE_DOCUMENT_LOGO_PATH);
  if (!response.ok) throw new Error("Company logo could not be loaded");
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Company logo could not be read"));
    reader.readAsDataURL(blob);
  });
}
