import type jsPDF from "jspdf";

export const isIOSBrowser = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function deliverPdf(pdf: jsPDF, filename: string, targetWindow?: Window | null, onIOSFileReady?: (file: File) => void) {
  const isIOS = isIOSBrowser();
  if (!isIOS) {
    pdf.save(filename);
    return;
  }

  const file = new File([pdf.output("blob")], filename, { type: "application/pdf" });
  if (onIOSFileReady) {
    onIOSFileReady(file);
    return;
  }

  const url = URL.createObjectURL(file);
  const destination = targetWindow ?? window.open("about:blank", "_blank");
  if (destination) {
    destination.location.href = url;
  } else {
    window.location.href = url;
  }
  window.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
}
