/** Shared logo used by the Salary Slip and employee letters. */
export const EMPLOYEE_DOCUMENT_LOGO_PATH = "/propcheckup-logo.png";

async function loadLogoDataUrl(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Company logo could not be loaded");
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Company logo could not be read"));
    reader.readAsDataURL(blob);
  });
}

/** Load the canonical employee document logo as a data URL for jsPDF. */
export function loadEmployeeDocumentLogoDataUrl(): Promise<string> {
  return loadLogoDataUrl(EMPLOYEE_DOCUMENT_LOGO_PATH);
}
