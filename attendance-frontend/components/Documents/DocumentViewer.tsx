"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type Props = { url: string; filename: string; mimeType?: string | null; onClose: () => void };

export default function DocumentViewer({ url, filename, mimeType, onClose }: Props) {
  const isPdf = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const isImage = mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(isPdf || isImage);
  const [error, setError] = useState("");
  const [fitScale, setFitScale] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => setViewportWidth(entries[0]?.contentRect.width || 0));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPdf || !url) return;
    let cancelled = false;
    const task = pdfjs.getDocument({ url });
    loadingTaskRef.current = task;
    void task.promise.then(pdf => {
      if (cancelled) { void task.destroy(); return; }
      pdfRef.current = pdf;
      setPageCount(pdf.numPages);
      setPage(1);
    }).catch(() => { if (!cancelled) setError("This PDF could not be opened."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      const loadingTask = loadingTaskRef.current;
      loadingTaskRef.current = null;
      pdfRef.current = null;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [isPdf, url]);

  useEffect(() => {
    if (!isPdf || !pdfRef.current || !canvasRef.current || !containerRef.current || !viewportWidth) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    const renderPage = async () => {
      try {
        const pdf = pdfRef.current;
        if (!pdf) return;
        const currentPage = await pdf.getPage(page);
        if (cancelled) return;
        const base = currentPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(240, viewportWidth - 24);
        const scale = Math.min(1.5, availableWidth / base.width) * zoom;
        setFitScale(Math.min(1.5, availableWidth / base.width));
        const viewport = currentPage.getViewport({ scale });
        const canvas = canvasRef.current!;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const task = currentPage.render({ canvas: canvasRef.current!, canvasContext: context, viewport });
        cancelRender = () => task.cancel();
        await task.promise;
      } catch { if (!cancelled) setError("This PDF page could not be rendered."); }
    };
    void renderPage();
    return () => { cancelled = true; cancelRender?.(); };
  }, [isPdf, page, zoom, pageCount, viewportWidth]);

  useEffect(() => {
    if (!isImage || !url || !containerRef.current || !viewportWidth) return;
    const image = new Image();
    image.onload = () => {
      const host = containerRef.current;
      if (host) setFitScale(Math.min(1, (viewportWidth - 32) / image.naturalWidth, (host.clientHeight - 32) / image.naturalHeight));
      setLoading(false);
    };
    image.onerror = () => { setError("This image could not be opened."); setLoading(false); };
    image.src = url;
  }, [isImage, url, viewportWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-70 flex flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label={`Document viewer: ${filename}`}>
    <header className="flex min-h-14 items-center gap-3 border-b border-white/15 px-3 sm:px-5">
      <button onClick={onClose} aria-label="Close document viewer" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-white/10"><X size={22}/></button>
      <p className="min-w-0 flex-1 truncate text-sm font-medium sm:text-base">{filename}</p>
      {isPdf && pageCount > 0 && <div className="flex items-center gap-1">
        <button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.5, value - .2))} className="min-h-10 min-w-10 rounded-lg hover:bg-white/10"><Minus size={18}/></button>
        <span className="min-w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2.5, value + .2))} className="min-h-10 min-w-10 rounded-lg hover:bg-white/10"><Plus size={18}/></button>
      </div>}
    </header>
    {isPdf && pageCount > 0 && <nav aria-label="PDF page navigation" className="flex items-center justify-center gap-4 border-b border-white/10 py-2">
      <button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 disabled:opacity-40"><ChevronLeft size={18}/>Previous</button>
      <span className="text-sm">Page {page} of {pageCount}</span>
      <button aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 disabled:opacity-40">Next<ChevronRight size={18}/></button>
    </nav>}
    <main ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-800 p-3 sm:p-6">
      {loading && <p role="status">Loading document…</p>}
      {error && <div role="alert" className="rounded-lg bg-red-950 p-4 text-center text-sm">{error}</div>}
      {!isPdf && !isImage && !error && <p role="alert" className="text-center text-sm">Preview is available for PDF and image files only.</p>}
      {isPdf && <canvas ref={canvasRef} className={loading || error ? "hidden" : "max-w-none shadow-xl"}/>}
      {isImage && url && !error && <img src={url} alt={filename} onLoad={() => setLoading(false)} style={{ transform: `scale(${zoom})`, maxWidth: `${fitScale * 100}%`, maxHeight: `${fitScale * 100}%`, objectFit: "contain" }} className={loading ? "hidden" : "origin-center"}/>}
      {isImage && !error && <div className="absolute bottom-4 right-4 flex gap-2 rounded-lg bg-slate-950/80 p-1">
        <button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.5, value - .2))} className="min-h-10 min-w-10 rounded"><Minus size={18}/></button><span className="flex items-center text-xs">{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, value + .2))} className="min-h-10 min-w-10 rounded"><Plus size={18}/></button><button aria-label="Fit image" onClick={() => setZoom(1)} className="px-2 text-xs">Fit</button>
      </div>}
    </main>
  </div>;
}
