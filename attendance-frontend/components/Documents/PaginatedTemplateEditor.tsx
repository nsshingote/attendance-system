"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";

export interface PaginatedTemplateEditorHandle {
  insertPlaceholder: (token: string) => void;
}

interface PaginatedTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  title: string;
}

export const PAGE_HEIGHT = 1120;
const FIRST_PAGE_CONTENT_HEIGHT = 780;
const OTHER_PAGE_CONTENT_HEIGHT = 920;

export const splitDynamicTemplateBlocks = (value: string) => {
  const blocks = value.split("\n");
  return blocks.length ? blocks : [""];
};

export const joinDynamicTemplateBlocks = (blocks: string[]) => blocks.join("\n");

export type DynamicTemplateFragment = {
  blockIndex: number;
  start: number;
  end: number;
  text: string;
};

const blockHeight = (text: string) => {
  const measure = document.createElement("div");
  const contentWidth = Math.max(240, Math.min(682, window.innerWidth - 96));
  measure.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;width:${contentWidth}px;min-height:64px;padding:8px;border:1px solid transparent;font:14px/1.625 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;white-space:pre-wrap;overflow-wrap:anywhere;`;
  measure.textContent = text || " ";
  document.body.appendChild(measure);
  const height = Math.max(64, Math.ceil(measure.getBoundingClientRect().height) + 4);
  measure.remove();
  return height;
};

const fragmentForHeight = (text: string, maxHeight: number) => {
  if (blockHeight(text) <= maxHeight) return text.length;
  let low = 1;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (blockHeight(text.slice(0, middle)) <= maxHeight) low = middle;
    else high = middle - 1;
  }
  return low;
};

export const paginateDynamicTemplateBlocks = (blocks: string[]): DynamicTemplateFragment[][] => {
  const pages: DynamicTemplateFragment[][] = [[]];
  let used = 0;

  blocks.forEach((block, blockIndex) => {
    let start = 0;
    do {
      const page = pages[pages.length - 1];
      const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const gap = page.length ? 12 : 0;
      const remaining = limit - used - gap;

      if (remaining < 48) {
        pages.push([]);
        used = 0;
        continue;
      }

      const remainder = block.slice(start);
      const length = fragmentForHeight(remainder, remaining);
      const end = start + length;
      const text = block.slice(start, end);
      page.push({ blockIndex, start, end, text });
      used += gap + blockHeight(text);
      start = end;

      if (start < block.length) {
        pages.push([]);
        used = 0;
      }
    } while (start < block.length);
  });

  return pages;
};

const PaginatedTemplateEditor = forwardRef<PaginatedTemplateEditorHandle, PaginatedTemplateEditorProps>(function PaginatedTemplateEditor({ value, onChange, title }, ref) {
  const [blocks, setBlocks] = useState(() => splitDynamicTemplateBlocks(value));
  const [pages, setPages] = useState<DynamicTemplateFragment[][]>([[]]);
  const activeSelection = useRef({ blockIndex: 0, start: 0, end: 0, key: "0:0" });
  const inputs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    const nextBlocks = splitDynamicTemplateBlocks(value);
    setBlocks((current) => JSON.stringify(current) === JSON.stringify(nextBlocks) ? current : nextBlocks);
  }, [value]);

  useLayoutEffect(() => {
    if (typeof document !== "undefined") {
      Object.values(inputs.current).forEach((input) => {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
      });
      setPages(paginateDynamicTemplateBlocks(blocks));
    }
  }, [blocks]);

  useImperativeHandle(ref, () => ({
    insertPlaceholder(token) {
      const active = activeSelection.current;
      const input = inputs.current[active.key];
      if (!input) return;
      const start = active.start;
      const end = active.end;
      const nextBlocks = [...blocks];
      nextBlocks[active.blockIndex] = `${nextBlocks[active.blockIndex].slice(0, start)}${token}${nextBlocks[active.blockIndex].slice(end)}`;
      setBlocks(nextBlocks);
      onChange(joinDynamicTemplateBlocks(nextBlocks));
      requestAnimationFrame(() => {
        input.focus();
        const cursor = start + token.length;
        input.setSelectionRange(cursor - active.start, cursor - active.start);
      });
    },
  }), [blocks, onChange]);

  const updateBlock = (fragment: DynamicTemplateFragment, valueForFragment: string) => {
    const nextValue = `${blocks[fragment.blockIndex].slice(0, fragment.start)}${valueForFragment}${blocks[fragment.blockIndex].slice(fragment.end)}`;
    const pieces = nextValue.split("\n");
    const nextBlocks = [...blocks.slice(0, fragment.blockIndex), ...pieces, ...blocks.slice(fragment.blockIndex + 1)];
    setBlocks(nextBlocks);
    onChange(joinDynamicTemplateBlocks(nextBlocks));
  };

  return (
    <div className="overflow-x-auto rounded-lg bg-ink-100 p-3 sm:p-6">
      <div className="mx-auto flex min-w-0 w-fit flex-col gap-6">
        {pages.map((page, pageIndex) => {
          return (
            <section key={pageIndex} className="mx-auto flex h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-mono text-sm leading-relaxed text-slate-900 shadow-md sm:px-14">
              {pageIndex === 0 && <div className="mb-4 border-b-2 border-brand-600 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" />
                    <div><p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p><p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p></div>
                  </div>
                  <div className="font-sans text-[10px] text-blue-900"><p>{LETTER_BRANDING.website}</p><p>{LETTER_BRANDING.email}</p><p>{LETTER_BRANDING.phone}</p></div>
                </div>
                <p className="mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>
              </div>}
              <div className="mb-4 flex items-center justify-between border-b border-ink-200 pb-2 text-[10px] font-sans uppercase tracking-wide text-ink-400">
                <span>Page {pageIndex + 1}</span>
                <span>A4</span>
              </div>
              <div className={`${pageIndex === 0 ? "h-780px" : "h-920px"} shrink-0 space-y-3`}>
                {page.map((fragment, offset) => {
                  const key = `${fragment.blockIndex}:${fragment.start}`;
                  return (
                    <textarea
                      key={key}
                      ref={(element) => {
                        inputs.current[key] = element;
                        if (element) {
                          element.style.height = "auto";
                          element.style.height = `${element.scrollHeight}px`;
                        }
                      }}
                      value={fragment.text}
                      rows={Math.max(2, fragment.text.split("\n").length)}
                      onFocus={(event) => { const position = fragment.start + event.currentTarget.selectionStart; activeSelection.current = { blockIndex: fragment.blockIndex, start: position, end: fragment.start + event.currentTarget.selectionEnd, key }; }}
                      onSelect={(event) => { activeSelection.current = { blockIndex: fragment.blockIndex, start: fragment.start + event.currentTarget.selectionStart, end: fragment.start + event.currentTarget.selectionEnd, key }; }}
                      onChange={(event) => updateBlock(fragment, event.target.value)}
                      className="block min-h-12 w-full resize-none overflow-hidden rounded border border-transparent bg-transparent p-2 outline-none focus:border-brand-300 focus:bg-brand-50/30"
                      aria-label={`Page ${pageIndex + 1} paragraph ${offset + 1}`}
                    />
                  );
                })}
              </div>
              <div className="mt-4 border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400">
                {pageIndex + 1}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
});

export default PaginatedTemplateEditor;
