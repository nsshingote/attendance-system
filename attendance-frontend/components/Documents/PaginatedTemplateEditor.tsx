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
const FIRST_PAGE_CONTENT_HEIGHT = 850;
const OTHER_PAGE_CONTENT_HEIGHT = 1000;

export const splitDynamicTemplateBlocks = (value: string) => {
  const blocks = value.split(/\n\s*\n/);
  return blocks.length ? blocks : [""];
};

export const joinDynamicTemplateBlocks = (blocks: string[]) => blocks.join("\n\n");

const blockHeight = (text: string) => {
  const measure = document.createElement("div");
  const contentWidth = Math.max(240, Math.min(682, window.innerWidth - 96));
  measure.style.cssText = `position:absolute;visibility:hidden;width:${contentWidth}px;padding:10px 12px;font:14px/1.625 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;white-space:pre-wrap;overflow-wrap:anywhere;`;
  measure.textContent = text || " ";
  document.body.appendChild(measure);
  const height = Math.max(48, measure.getBoundingClientRect().height);
  measure.remove();
  return height;
};

export const paginateDynamicTemplateBlocks = (blocks: string[]) => {
  const starts = [0];
  let used = 0;
  blocks.forEach((block, index) => {
    const height = blockHeight(block);
    const limit = starts.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
    if (index > starts[starts.length - 1] && used + height > limit) {
      starts.push(index);
      used = height;
    } else {
      used += height;
    }
  });
  return starts;
};

const PaginatedTemplateEditor = forwardRef<PaginatedTemplateEditorHandle, PaginatedTemplateEditorProps>(function PaginatedTemplateEditor({ value, onChange, title }, ref) {
  const [blocks, setBlocks] = useState(() => splitDynamicTemplateBlocks(value));
  const [pageStarts, setPageStarts] = useState([0]);
  const activeBlock = useRef(0);
  const inputs = useRef<Array<HTMLTextAreaElement | null>>([]);

  useEffect(() => {
    const nextBlocks = splitDynamicTemplateBlocks(value);
    setBlocks((current) => JSON.stringify(current) === JSON.stringify(nextBlocks) ? current : nextBlocks);
  }, [value]);

  useLayoutEffect(() => {
    if (typeof document !== "undefined") {
      inputs.current.forEach((input) => {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
      });
      setPageStarts(paginateDynamicTemplateBlocks(blocks));
    }
  }, [blocks]);

  useImperativeHandle(ref, () => ({
    insertPlaceholder(token) {
      const index = activeBlock.current;
      const input = inputs.current[index];
      if (!input) return;
      const start = input.selectionStart ?? blocks[index].length;
      const end = input.selectionEnd ?? start;
      const nextBlocks = [...blocks];
      nextBlocks[index] = `${nextBlocks[index].slice(0, start)}${token}${nextBlocks[index].slice(end)}`;
      setBlocks(nextBlocks);
      onChange(joinDynamicTemplateBlocks(nextBlocks));
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + token.length, start + token.length);
      });
    },
  }), [blocks, onChange]);

  const updateBlock = (index: number, valueForBlock: string) => {
    const pieces = valueForBlock.split(/\n\s*\n/);
    const nextBlocks = [...blocks.slice(0, index), ...pieces, ...blocks.slice(index + 1)];
    setBlocks(nextBlocks);
    onChange(joinDynamicTemplateBlocks(nextBlocks));
    activeBlock.current = index;
    requestAnimationFrame(() => {
      const input = inputs.current[index];
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg bg-ink-100 p-3 sm:p-6">
      <div className="mx-auto flex min-w-0 w-fit flex-col gap-6">
        {pageStarts.map((start, pageIndex) => {
          const end = pageStarts[pageIndex + 1] ?? blocks.length;
          return (
            <section key={start} className="mx-auto flex min-h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-mono text-sm leading-relaxed text-slate-900 shadow-md sm:px-14">
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
              <div className="min-h-0 flex-1 space-y-3">
                {blocks.slice(start, end).map((block, offset) => {
                  const index = start + offset;
                  return (
                    <textarea
                      key={index}
                      ref={(element) => { inputs.current[index] = element; }}
                      value={block}
                      rows={Math.max(2, block.split("\n").length)}
                      onFocus={() => { activeBlock.current = index; }}
                      onChange={(event) => updateBlock(index, event.target.value)}
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