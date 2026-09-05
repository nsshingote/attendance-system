"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; templateContent?: string; companyName?: string; companyAddress?: string; logoUrl?: string };

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
      mapped.push(resolvedBlocks[resolvedIndex] || templateBlock);
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

const DynamicLetterPreview = forwardRef<HTMLDivElement, DynamicLetterPreviewProps>(function DynamicLetterPreview({ title, content, templateContent }, ref) {
  const blocks = useMemo(() => splitDynamicTemplateBlocks(content), [content]);
  const bodyRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [overflow, setOverflow] = useState(false);
  const { pages, mappingValid } = useMemo(() => {
    if (!templateContent) return { pages: paginateDynamicTemplateBlocks(blocks), mappingValid: true };
    const templateBlocks = splitDynamicTemplateBlocks(templateContent);
    const templatePages = paginateDynamicTemplateBlocks(templateBlocks);
    const resolvedMapping = mapResolvedBlocks(templateBlocks, blocks);
    return {
      pages: templatePages.map(page => ({
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
      })),
      mappingValid: resolvedMapping.valid,
    };
  }, [blocks, templateContent]);

  useLayoutEffect(() => {
    const hasOverflow = pages.some((_, pageIndex) => {
      const body = bodyRefs.current[pageIndex];
      return Boolean(body && body.scrollHeight > body.clientHeight + 1);
    });
    setOverflow(current => current === hasOverflow ? current : hasOverflow);
  }, [pages]);

  return (
    <div ref={ref} data-layout-overflow={overflow || !mappingValid ? "true" : "false"} className="mx-auto flex w-full max-w-full flex-col gap-6 overflow-x-auto">
      {(!mappingValid || overflow) && <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{mappingValid ? "This document content does not fit within the saved template page layout. Download is disabled until the content is adjusted." : "This document could not be mapped to the saved template layout. Download is disabled."}</p>}
      {pages.map((page, pageIndex) => {
        return (
          <article key={pageIndex} className="mx-auto flex h-280 w-198.5 shrink-0 flex-col bg-white px-6 py-7 font-serif text-sm leading-relaxed text-slate-900 shadow-sm sm:px-14">
            {pageIndex === 0 && <header className="border-b-2 border-brand-600 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</h2>
                    <p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p>
                  </div>
                </div>
                <div>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.website}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.email}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.phone}</p>
                </div>
              </div>
            </header>}
            {pageIndex === 0 && <h1 className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</h1>}
            <div ref={element => { bodyRefs.current[pageIndex] = element; }} className={`${pageIndex === 0 ? "h-195" : "h-230"} shrink-0 overflow-hidden`}>
              {page.fragments.map((fragment) => <div key={`${fragment.blockIndex}-${fragment.start}`} className="mb-3 whitespace-pre-wrap wrap-break-words" dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />)}
            </div>
            <footer className="mt-auto border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400">
              <p>{LETTER_BRANDING.address}</p>
              <p className="mt-1 text-ink-400">Page {pageIndex + 1}</p>
            </footer>
          </article>
        );
      })}
    </div>
  );
});

export default DynamicLetterPreview;
