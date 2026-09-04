"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; templateContent?: string; companyName?: string; companyAddress?: string; logoUrl?: string };

const DynamicLetterPreview = forwardRef<HTMLDivElement, DynamicLetterPreviewProps>(function DynamicLetterPreview({ title, content, templateContent }, ref) {
  const blocks = useMemo(() => splitDynamicTemplateBlocks(content), [content]);
  const savedPageCount = useMemo(
    () => templateContent ? paginateDynamicTemplateBlocks(splitDynamicTemplateBlocks(templateContent)).length : 0,
    [templateContent],
  );
  const paginatedPages = useMemo(() => paginateDynamicTemplateBlocks(blocks), [blocks]);
  const pages = useMemo(() => {
    if (savedPageCount !== 1 || paginatedPages.length <= 1) return paginatedPages;
    return [{
      fragments: [{
        blockIndex: 0,
        start: 0,
        end: content.length,
        text: content,
      }],
    }];
  }, [content, paginatedPages, savedPageCount]);
  const fitContentRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    const contentElement = fitContentRef.current;
    if (!contentElement || savedPageCount !== 1) return;
    const availableHeight = 900;
    setFitScale(Math.min(1, availableHeight / Math.max(availableHeight, contentElement.scrollHeight)));
  }, [content, savedPageCount]);

  return (
    <div ref={ref} className="mx-auto flex w-fit max-w-full flex-col gap-6">
      {pages.map((page, pageIndex) => {
        return (
          <article key={pageIndex} className="mx-auto flex h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-serif text-sm leading-relaxed text-slate-900 shadow-sm sm:px-14">
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
            <div className={`${pageIndex === 0 ? "h-900px" : "h-920px"} shrink-0 overflow-hidden`}>
              <div ref={pageIndex === 0 ? fitContentRef : undefined} style={pageIndex === 0 && savedPageCount === 1 ? { transform: `scale(${fitScale})`, transformOrigin: "top left", width: `${100 / fitScale}%` } : undefined}>
                {page.fragments.map((fragment) => <div key={`${fragment.blockIndex}-${fragment.start}`} className="mb-3 whitespace-pre-wrap wrap-break-words" dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />)}
              </div>
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
