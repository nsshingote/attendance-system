"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import {
  mergeSpuriousTrailingPages,
  measurePageBodyOverflow,
  nextAnimationFrames,
  waitForElementImages,
} from "@/lib/dynamicLetterLayout";
import { A4_PAGINATION_GEOMETRY, paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks, type DynamicTemplatePage } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; templateContent?: string; templateLayout?: unknown; layoutValidated?: boolean; companyName?: string; companyAddress?: string; logoUrl?: string };

const sliceHtml = (html: string, start: number, end: number) => {
  const source = document.createElement("div");
  source.innerHTML = html;
  let position = 0;
  const voidElements = new Set(["AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"]);
  const copy = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "";
      const from = Math.max(0, start - position);
      const to = Math.min(value.length, end - position);
      position += value.length;
      return from < to ? document.createTextNode(value.slice(from, to)) : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node.cloneNode(false) as HTMLElement;
    node.childNodes.forEach(child => {
      const copied = copy(child);
      if (copied) element.appendChild(copied);
    });
    return element.childNodes.length || voidElements.has(node.nodeName) ? element : null;
  };
  const result = document.createElement("div");
  source.childNodes.forEach(node => {
    const copied = copy(node);
    if (copied) result.appendChild(copied);
  });
  return result.innerHTML;
};

const resolvedFragment = (sourceFragment: string, sourceBlock: string, resolvedBlock: string, start: number, end: number) => {
  if (!/^<table\b/i.test(sourceFragment.trim())) {
    if (start === 0 && end >= sourceBlock.replace(/<[^>]+>/g, "").length) return resolvedBlock;
    const sourceLength = Math.max(1, sourceBlock.replace(/<[^>]+>/g, "").length);
    const resolvedLength = resolvedBlock.replace(/<[^>]+>/g, "").length;
    const resolvedStart = Math.floor((start / sourceLength) * resolvedLength);
    const resolvedEnd = Math.min(resolvedLength, Math.ceil((end / sourceLength) * resolvedLength));
    return sliceHtml(resolvedBlock, resolvedStart, resolvedEnd);
  }
  const source = document.createElement("div");
  source.innerHTML = sourceFragment;
  const sourceTable = source.querySelector("table");
  const resolved = document.createElement("div");
  resolved.innerHTML = resolvedBlock;
  const resolvedTable = resolved.querySelector("table");
  if (!sourceTable || !resolvedTable) return resolvedBlock;
  const rowStart = Number(sourceTable.dataset.tableRowStart || 0);
  const rowEnd = Number(sourceTable.dataset.tableRowEnd || resolvedTable.rows.length);
  const table = resolvedTable.cloneNode(false) as HTMLTableElement;
  const body = document.createElement("tbody");
  Array.from(resolvedTable.rows).slice(rowStart, rowEnd).forEach(row => body.appendChild(row.cloneNode(true)));
  table.appendChild(body);
  return table.outerHTML;
};

const isTableBlock = (block: string) => /^<table\b/i.test(block.trim());
const isBreakBlock = (block: string) => /^(\[\[dynamic:page-break\]\])$/i.test(block.trim());
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
const sameTableStructure = (sourceBlock: string, resolvedBlock: string) => {
  const source = document.createElement("div");
  source.innerHTML = sourceBlock;
  const resolved = document.createElement("div");
  resolved.innerHTML = resolvedBlock;
  const sourceRows = Array.from(source.querySelector("table")?.rows ?? []);
  const resolvedRows = Array.from(resolved.querySelector("table")?.rows ?? []);
  return sourceRows.length === resolvedRows.length
    && sourceRows.every((row, index) => row.cells.length === resolvedRows[index]?.cells.length);
};

const mapResolvedBlocks = (templateBlocks: string[], resolvedBlocks: string[]) => {
  const mapped: string[] = [];
  let resolvedIndex = 0;
  let valid = true;
  templateBlocks.forEach(templateBlock => {
    if (isBreakBlock(templateBlock)) {
      while (resolvedIndex < resolvedBlocks.length && !isBreakBlock(resolvedBlocks[resolvedIndex])) resolvedIndex += 1;
      if (resolvedIndex >= resolvedBlocks.length) valid = false;
      mapped.push(resolvedBlocks[resolvedIndex] || templateBlock);
      resolvedIndex += 1;
      return;
    }
    if (isTableBlock(templateBlock)) {
      while (resolvedIndex < resolvedBlocks.length && !isTableBlock(resolvedBlocks[resolvedIndex])) resolvedIndex += 1;
      if (resolvedIndex >= resolvedBlocks.length) valid = false;
      const resolvedBlock = resolvedBlocks[resolvedIndex] || templateBlock;
      if (!sameTableStructure(templateBlock, resolvedBlock)) valid = false;
      mapped.push(resolvedBlock);
      resolvedIndex += 1;
      return;
    }
    const parts: string[] = [];
    while (resolvedIndex < resolvedBlocks.length && !isTableBlock(resolvedBlocks[resolvedIndex]) && !isBreakBlock(resolvedBlocks[resolvedIndex])) {
      parts.push(resolvedBlocks[resolvedIndex]);
      resolvedIndex += 1;
    }
    if (!parts.length) valid = false;
    mapped.push(parts.join("\n"));
  });
  if (resolvedIndex < resolvedBlocks.length) valid = false;
  return { blocks: mapped, valid };
};

const isSavedTemplateLayout = (layout: unknown): layout is DynamicTemplatePage[] => Array.isArray(layout)
  && layout.length > 0
  && layout.every(page => typeof page === "object" && page !== null && Array.isArray((page as DynamicTemplatePage).fragments)
    && (page as DynamicTemplatePage).fragments.every(fragment => Number.isInteger(fragment.blockIndex)
      && Number.isInteger(fragment.start) && Number.isInteger(fragment.end) && typeof fragment.text === "string"));

const resolveTemplatePages = (templateContent: string, content: string, savedLayout?: unknown) => {
  const templateBlocks = splitDynamicTemplateBlocks(templateContent);
  const hasSavedLayout = isSavedTemplateLayout(savedLayout);
  // A generated document owns its page boundaries. Do not re-paginate it on a
  // recipient device, whose font metrics can otherwise turn one saved page
  // into two. Legacy documents without this snapshot retain the fallback.
  const templatePages = hasSavedLayout
    ? savedLayout.map(page => ({ ...page, fragments: page.fragments.map(fragment => ({ ...fragment })) }))
    : trimTrailingEmptyPages(paginateDynamicTemplateBlocks(templateBlocks, A4_PAGINATION_GEOMETRY));
  const resolvedMapping = mapResolvedBlocks(templateBlocks, splitDynamicTemplateBlocks(content));
  const resolvedPages = templatePages.map(page => ({
    ...page,
    fragments: page.fragments.map(fragment => ({
      ...fragment,
      text: resolvedFragment(
        fragment.text,
        templateBlocks[fragment.blockIndex] || "",
        resolvedMapping.blocks[fragment.blockIndex] || "",
        fragment.start,
        fragment.end,
      ),
    })),
  }));
  return {
    savedPages: resolvedPages,
    exportPages: hasSavedLayout ? resolvedPages : mergeSpuriousTrailingPages(resolvedPages),
    mappingValid: resolvedMapping.valid,
  };
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
    if (!templateContent) return { savedPages: [] as DynamicTemplatePage[], exportPages: [] as DynamicTemplatePage[], mappingValid: false };
    return resolveTemplatePages(templateContent, content, templateLayout);
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
                    <h2 className="text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</h2>
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
          {pageIndex === 0 && <h1 className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</h1>}
          <div ref={element => { bodyRefs.current[pageIndex] = element; }} style={{ height: pageIndex === 0 ? "780px" : "920px" }} className="shrink-0 overflow-hidden">
            {page.fragments.map((fragment, fragmentIndex) => {
              const isTable = /^<table\b/i.test(fragment.text.trim());
              const previousFragment = page.fragments[fragmentIndex - 1]?.text.trim() ?? "";
              const nextFragment = page.fragments[fragmentIndex + 1]?.text.trim() ?? "";
              const adjacentToTable = isTable || /^<table\b/i.test(previousFragment) || /^<table\b/i.test(nextFragment);
              const hasFollowingContent = page.fragments.slice(fragmentIndex + 1).some(next => next.text.trim().length > 0);
              const addParagraphSpacing = hasFollowingContent && !adjacentToTable;
              return <div key={`${fragment.blockIndex}-${fragment.start}-${fragmentIndex}`} className={`${addParagraphSpacing ? "mb-3" : ""} whitespace-pre-wrap wrap-break-words`} dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />;
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
