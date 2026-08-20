"use client";

import { useLayoutEffect, useState } from "react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { paginateDynamicTemplateBlocks, splitDynamicTemplateBlocks } from "./PaginatedTemplateEditor";

type DynamicLetterPreviewProps = { title: string; content: string; companyName?: string; companyAddress?: string; logoUrl?: string };

export default function DynamicLetterPreview({ title, content }: DynamicLetterPreviewProps) {
  const blocks = splitDynamicTemplateBlocks(content);
  const [pageStarts, setPageStarts] = useState([0]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPageStarts(paginateDynamicTemplateBlocks(blocks)));
    return () => cancelAnimationFrame(frame);
  }, [blocks]);

  return (
    <div className="mx-auto flex w-fit max-w-full flex-col gap-6">
      {pageStarts.map((start, pageIndex) => {
        const end = pageStarts[pageIndex + 1] ?? blocks.length;
        return (
          <article key={start} className="mx-auto flex min-h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-8 py-7 font-serif text-[14px] leading-relaxed text-slate-900 shadow-sm sm:px-12">
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
            <div className="min-h-0 flex-1 whitespace-pre-wrap py-8">
              {blocks.slice(start, end).map((block, index) => <p key={`${start}-${index}`} className="mb-4">{block}</p>)}
            </div>
            {pageIndex === pageStarts.length - 1 && <footer className="border-t-2 border-brand-600 pt-4 text-center font-sans text-[10px] text-slate-600">
              <p>{LETTER_BRANDING.address}</p>
              <p className="mt-1 text-ink-400">Page {pageIndex + 1}</p>
            </footer>}
          </article>
        );
      })}
    </div>
  );
}
