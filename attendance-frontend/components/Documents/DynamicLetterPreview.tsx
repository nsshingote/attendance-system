"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; companyName?: string; companyAddress?: string; logoUrl?: string };

export default function DynamicLetterPreview({ title, content }: DynamicLetterPreviewProps) {
  const blocks = useMemo(() => splitDynamicTemplateBlocks(content), [content]);
  const [pages, setPages] = useState<ReturnType<typeof paginateDynamicTemplateBlocks>>([[]]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPages(paginateDynamicTemplateBlocks(blocks)));
    return () => cancelAnimationFrame(frame);
  }, [blocks]);

  return (
    <div className="mx-auto flex w-fit max-w-full flex-col gap-6">
      {pages.map((page, pageIndex) => {
        return (
          <article key={pageIndex} className="mx-auto flex h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-8 py-7 font-serif text-[14px] leading-relaxed text-slate-900 shadow-sm sm:px-12">
            {pageIndex === 0 && <header className="border-b-2 border-brand-600 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-14 w-14 object-contain" />
                  <div>
                    <h2 className="text-xl font-bold tracking-wide text-slate-900">{LETTER_BRANDING.companyName}</h2>
                    <p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p>
                  </div>
                </div>
                <div>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.website}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.email}</p>
                  <p className="text-right font-sans text-[10px] text-blue-900">{LETTER_BRANDING.phone}</p>
                </div>
              </div>
              <h1 className="mt-6 text-center text-lg font-bold uppercase tracking-[0.12em]">{title}</h1>
            </header>}
            <div className={`${pageIndex === 0 ? "h-844px" : "h-984px"} shrink-0 whitespace-pre-wrap py-8`}>
              {page.map((fragment) => <p key={`${fragment.blockIndex}-${fragment.start}`} className="mb-3">{fragment.text}</p>)}
            </div>
            {pageIndex === pages.length - 1 && <footer className="border-t-2 border-brand-600 pt-4 text-center font-sans text-[10px] text-slate-600">
              <p>{LETTER_BRANDING.address}</p>
              <p className="mt-1 text-ink-400">Page {pageIndex + 1}</p>
            </footer>}
          </article>
        );
      })}
    </div>
  );
}
