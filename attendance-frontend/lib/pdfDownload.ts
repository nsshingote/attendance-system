import type jsPDF from "jspdf";

export function deliverPdf(pdf: jsPDF, filename: string, targetWindow?: Window | null) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) {
    pdf.save(filename);
    return;
  }

  const url = URL.createObjectURL(pdf.output("blob"));
  const destination = targetWindow ?? window.open("about:blank", "_blank");
  if (destination) {
    destination.location.href = url;
  } else {
    window.location.href = url;
  }
  window.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
}
