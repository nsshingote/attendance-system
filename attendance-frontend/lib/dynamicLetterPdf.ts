import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { deliverPdf } from "@/lib/pdfDownload";

type EmployeeNameParam = string | undefined;
const PDF_PAGE_WIDTH_PX = 794;
const PDF_PAGE_HEIGHT_PX = 1120;

const unsupportedColorPattern = /\b(?:lab|lch|oklab|oklch)\([^)]*\)/gi;
const hasUnsupportedColor = (value: string) => /\b(?:lab|lch|oklab|oklch)\([^)]*\)/i.test(value);

const resolveUnsupportedColor = (document: Document, value: string) => {
  if (!hasUnsupportedColor(value)) return value;
  unsupportedColorPattern.lastIndex = 0;
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = document.defaultView?.getComputedStyle(probe).color;
  probe.remove();
  return resolved && !hasUnsupportedColor(resolved) ? resolved : "rgb(0 0 0)";
};

const replaceUnsupportedColors = (document: Document, value: string) =>
  value.replace(unsupportedColorPattern, color => resolveUnsupportedColor(document, color));

const sanitizeCloneColors = (clonedDocument: Document) => {
  clonedDocument.querySelectorAll("style").forEach(style => {
    style.textContent = replaceUnsupportedColors(clonedDocument, style.textContent || "");
  });
  clonedDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(link => {
    try {
      const sheet = link.sheet;
      const rules = sheet?.cssRules ? Array.from(sheet.cssRules, rule => rule.cssText).join("\n") : "";
      if (!rules) return;
      const replacement = clonedDocument.createElement("style");
      replacement.textContent = replaceUnsupportedColors(clonedDocument, rules);
      link.replaceWith(replacement);
    } catch {
      // Cross-origin stylesheets cannot be read; element-level sanitization below
      // still protects the cloned page without changing the source document.
    }
  });
  clonedDocument.querySelectorAll<HTMLElement>("*").forEach(element => {
    const computed = clonedDocument.defaultView?.getComputedStyle(element);
    if (!computed) return;
    for (const property of ["color", "background-color", "border-color", "outline-color", "text-decoration-color"]) {
      const value = computed.getPropertyValue(property);
      if (/\b(?:lab|lch|oklab|oklch)\(/i.test(value)) {
        element.style.setProperty(property, resolveUnsupportedColor(clonedDocument, value));
      }
    }
    const inlineStyle = element.getAttribute("style");
    if (inlineStyle) element.setAttribute("style", replaceUnsupportedColors(clonedDocument, inlineStyle));
  });
};

export async function downloadDynamicLetterPdf(title: string, content: string, employeeName?: EmployeeNameParam, previewElement?: HTMLElement | null, targetWindow?: Window | null, onIOSFileReady?: (file: File) => void) {
  const employeeFileName = employeeName?.replace(/\s+/g, "-").toLowerCase() || "employee";
  const filename = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "letter"}-${employeeFileName}.pdf`;
  const deliver = (pdf: jsPDF) => deliverPdf(pdf, filename, targetWindow, onIOSFileReady);

  if (!previewElement) {
    throw new Error("The saved template page layout is unavailable. Download is disabled.");
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (previewElement.dataset.layoutOverflow === "true") {
    throw new Error("The document content does not fit within the saved template page layout.");
  }
  const pages = Array.from(previewElement.querySelectorAll<HTMLElement>("article"));
  if (pages.length) {
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          scale: 2,
          width: PDF_PAGE_WIDTH_PX,
          height: PDF_PAGE_HEIGHT_PX,
          windowWidth: PDF_PAGE_WIDTH_PX,
          windowHeight: PDF_PAGE_HEIGHT_PX,
          useCORS: true,
          backgroundColor: "#ffffff",
          onclone: clonedDocument => {
            const clonedPages = clonedDocument.querySelectorAll<HTMLElement>("article");
            clonedPages.forEach(clonedPage => {
              clonedPage.style.width = `${PDF_PAGE_WIDTH_PX}px`;
              clonedPage.style.minWidth = `${PDF_PAGE_WIDTH_PX}px`;
              clonedPage.style.maxWidth = `${PDF_PAGE_WIDTH_PX}px`;
              clonedPage.style.height = `${PDF_PAGE_HEIGHT_PX}px`;
              clonedPage.style.minHeight = `${PDF_PAGE_HEIGHT_PX}px`;
              clonedPage.style.maxHeight = `${PDF_PAGE_HEIGHT_PX}px`;
            });
            sanitizeCloneColors(clonedDocument);
          },
        });
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);
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
  throw new Error("The saved template page layout is unavailable. Download is disabled.");
}
