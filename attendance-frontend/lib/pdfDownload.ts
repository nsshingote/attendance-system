import type jsPDF from "jspdf";

export const isIOSBrowser = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function deliverPdf(pdf: jsPDF, filename: string, targetWindow?: Window | null, onIOSFileReady?: (file: File) => void) {
  const isIOS = isIOSBrowser();
  if (!isIOS) {
    // jsPDF's save helper is inconsistent in Android WebViews. A DOM download
    // link keeps this synchronous with the user's tap and works in browsers.
    const url = URL.createObjectURL(pdf.output("blob"));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
