import { isIOSBrowser } from "@/lib/pdfDownload";

export async function prepareIOSFileDownload(url: string, filename: string) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error("Unable to prepare file for download");
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "application/octet-stream" });
}

export async function shareIOSFile(file: File) {
  if (!isIOSBrowser() || !navigator.canShare?.({ files: [file] })) {
    throw new Error("This browser cannot save this file. Update iOS Safari and try again.");
  }
  await navigator.share({ files: [file], title: file.name });
}
