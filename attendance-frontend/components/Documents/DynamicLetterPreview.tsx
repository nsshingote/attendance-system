"use client";

import { forwardRef, useLayoutEffect, useMemo, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; companyName?: string; companyAddress?: string; logoUrl?: string };

const DynamicLetterPreview = forwardRef<HTMLDivElement, DynamicLetterPreviewProps>(function DynamicLetterPreview({ title, content }, ref) {
  const blocks = useMemo(() => splitDynamicTemplateBlocks(content), [content]);
  const [pages, setPages] = useState<ReturnType<typeof paginateDynamicTemplateBlocks>>([{ fragments: [] }]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPages(paginateDynamicTemplateBlocks(blocks)));
    return () => cancelAnimationFrame(frame);
  }, [blocks]);

  return (
    <div ref={ref} className="mx-auto flex w-fit max-w-full flex-col gap-6">
      {pages.map((page, pageIndex) => {
        return (
          <article key={pageIndex} className="mx-auto flex h-[1120px] w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-serif text-sm leading-relaxed text-slate-900 shadow-sm sm:px-14">
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
            <div className={`${pageIndex === 0 ? "h-[780px]" : "h-[920px]"} shrink-0 overflow-hidden`}>
              {page.fragments.map((fragment) => <div key={`${fragment.blockIndex}-${fragment.start}`} className="mb-3 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />)}
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
