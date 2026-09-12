"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import {
  FRAGMENT_GAP_PX,
  normalizeDynamicTemplateHtml,
  pageBodyHeightPx,
  measurePageBodyOverflow,
  nextAnimationFrames,
  waitForElementImages,
} from "@/lib/dynamicLetterLayout";
import { A4_PAGINATION_GEOMETRY, paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks, type DynamicTemplatePage } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; templateContent?: string; templateLayout?: unknown; layoutValidated?: boolean; companyName?: string; companyAddress?: string; logoUrl?: string };

const hasMeaningfulHtml = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  if (container.querySelector("table, img, hr, svg, video, iframe")) return true;
  return Boolean(container.textContent?.replace(/\u200b/g, "").trim());
};
const trimTrailingEmptyPages = (pages: DynamicTemplatePage[]) => {
  const trimmed = [...pages];
  while (trimmed.length > 1) {
    const last = trimmed[trimmed.length - 1];
    const hasContent = last.fragments.some(fragment => hasMeaningfulHtml(fragment.text));
    if (hasContent || last.manualBreakBefore !== undefined) break;
    trimmed.pop();
  }
  return trimmed;
};

const isSavedTemplateLayout = (layout: unknown): layout is DynamicTemplatePage[] => Array.isArray(layout)
  && layout.length > 0
  && layout.every(page => typeof page === "object" && page !== null && Array.isArray((page as DynamicTemplatePage).fragments)
    && (page as DynamicTemplatePage).fragments.every(fragment => Number.isInteger(fragment.blockIndex)
      && Number.isInteger(fragment.start) && Number.isInteger(fragment.end) && typeof fragment.text === "string"));

const resolveTemplatePages = (content: string, savedLayout?: unknown) => {
  if (isSavedTemplateLayout(savedLayout)) {
    const pages = savedLayout.map(page => ({ ...page, fragments: page.fragments.map(fragment => ({ ...fragment })) }));
    return { savedPages: pages, exportPages: pages, mappingValid: true };
  }
  if (!content) return { savedPages: [] as DynamicTemplatePage[], exportPages: [] as DynamicTemplatePage[], mappingValid: false };
  const pages = trimTrailingEmptyPages(paginateDynamicTemplateBlocks(splitDynamicTemplateBlocks(content), A4_PAGINATION_GEOMETRY));
  return { savedPages: pages, exportPages: pages, mappingValid: true };
};

const DynamicLetterPreview = forwardRef<HTMLDivElement, DynamicLetterPreviewProps>(function DynamicLetterPreview({ title, content, templateContent, templateLayout, layoutValidated = false }, ref) {
  const bodyRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastMeasurement = useRef<{ overflow: boolean; pageCount: number } | null>(null);
  const stablePasses = useRef(0);
  const [overflow, setOverflow] = useState(false);
  const [layoutMeasured, setLayoutMeasured] = useState(false);
  const [layoutStable, setLayoutStable] = useState(false);

  const { savedPages, exportPages, mappingValid } = useMemo(() => {
    if (isSavedTemplateLayout(templateLayout)) return resolveTemplatePages(content, templateLayout);
    const visible = content || templateContent || "";
    if (!visible) return { savedPages: [] as DynamicTemplatePage[], exportPages: [] as DynamicTemplatePage[], mappingValid: false };
    return resolveTemplatePages(visible);
  }, [content, templateContent, templateLayout]);

  useLayoutEffect(() => {
    bodyRefs.current = {};
    setLayoutMeasured(false);
    setLayoutStable(false);
    lastMeasurement.current = null;
    stablePasses.current = 0;
    let cancelled = false;
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void (async () => {
          await nextAnimationFrames(2);
          if (cancelled || !rootRef.current) return;
          await waitForElementImages(rootRef.current);
          if (cancelled) return;
          await nextAnimationFrames(1);
          if (cancelled) return;

          const overflowingPage = exportPages.map((_, pageIndex) => {
            const body = bodyRefs.current[pageIndex];
            return body ? measurePageBodyOverflow(body, pageIndex) : null;
          }).find(Boolean);
          const hasOverflow = Boolean(overflowingPage);
          const snapshot = { overflow: hasOverflow, pageCount: exportPages.length };
          const previous = lastMeasurement.current;
          if (previous && previous.overflow === snapshot.overflow && previous.pageCount === snapshot.pageCount) {
            stablePasses.current += 1;
          } else {
            stablePasses.current = 0;
          }
          lastMeasurement.current = snapshot;
          setOverflow(current => current === hasOverflow ? current : hasOverflow);
          setLayoutMeasured(true);
          setLayoutStable(stablePasses.current >= 1);
        })();
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const observedBodies = () => Object.values(bodyRefs.current).filter(Boolean) as HTMLDivElement[];
    observedBodies().forEach(body => resizeObserver?.observe(body));
    window.addEventListener("resize", measure);
    const fontsReady = document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      void fontsReady;
    };
  }, [exportPages]);

  const setRootRef = (element: HTMLDivElement | null) => {
    rootRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };

  return (
    <div
      ref={setRootRef}
      data-saved-template-page-count={savedPages.length}
      data-template-page-count={exportPages.length}
      data-layout-measured={layoutMeasured ? "true" : "false"}
      data-layout-stable={layoutStable ? "true" : "false"}
      // A sent letter was measured before generation. Rechecking the same
      // immutable page snapshot on iOS can only introduce font-engine noise;
      // validation remains mandatory before that snapshot is created.
      data-layout-overflow={!layoutValidated && (overflow || !mappingValid) ? "true" : "false"}
      className="mx-auto flex w-full max-w-full flex-col gap-6 overflow-x-auto"
    >
      {(!layoutValidated && (!mappingValid || overflow)) && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {mappingValid
            ? "This document content does not fit within the saved template page layout. Download is disabled until the content is adjusted."
            : "This document could not be mapped to the saved template layout. Download is disabled."}
        </p>
      )}
      {exportPages.map((page, pageIndex) => (
        <article data-template-page={pageIndex} key={pageIndex} style={{ width: "794px", minWidth: "794px", maxWidth: "none", height: "1120px", fontFamily: 'Georgia, "Times New Roman", Times, serif' }} className="mx-auto flex shrink-0 flex-col bg-white px-14 py-7 text-sm leading-relaxed text-slate-900 shadow-sm">
          {pageIndex === 0 && (
            <header className="border-b-2 border-brand-600 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" />
                  <div className="min-w-0">
                    <p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p>
                    <p className="wrap-break-words font-sans text-[10px] font-semibold text-brand-700">
                      {LETTER_BRANDING.tagline.split(" ").map((word, wordIndex, words) => (
                        <span key={`${word}-${wordIndex}`} className={wordIndex < words.length - 1 ? "mr-1 inline-block" : "inline-block"}>
                          {word}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.website}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.email}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.phone}</p>
                </div>
              </div>
            </header>
          )}
          {pageIndex === 0 && <p className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>}
          <div ref={element => { bodyRefs.current[pageIndex] = element; }} style={{ height: `${pageBodyHeightPx(pageIndex)}px` }} className="shrink-0 overflow-hidden">
            {page.fragments.map((fragment, fragmentIndex) => {
              return <div key={`${fragment.blockIndex}-${fragment.start}-${fragmentIndex}`} style={{ ...(fragment.text ? {} : { minHeight: "1.625em" }), marginBottom: page.fragments[fragmentIndex + 1]?.text.trim() ? `${FRAGMENT_GAP_PX}px` : undefined }} className="w-full min-w-0 whitespace-pre-wrap wrap-break-words overflow-wrap-break [&_table]:relative [&_table]:my-0 [&_table]:min-w-60 [&_table]:overflow-auto" dangerouslySetInnerHTML={{ __html: normalizeDynamicTemplateHtml(fragment.text || "") }} />;
            })}
          </div>
          <footer className="mt-auto border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400">
            <p>{LETTER_BRANDING.address}</p>
            <p className="mt-1 text-ink-400">Page {pageIndex + 1}</p>
          </footer>
        </article>
      ))}
    </div>
  );
});

export default DynamicLetterPreview;
