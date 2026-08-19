import { LETTER_BRANDING } from "@/lib/letterBranding";

type DynamicLetterPreviewProps = { title: string; content: string; companyName?: string; companyAddress?: string; logoUrl?: string };

export default function DynamicLetterPreview({ title, content }: DynamicLetterPreviewProps) {
  return (
    <article className="mx-auto flex min-h-1120px max-w-794px flex-col bg-white px-8 py-7 font-serif text-[14px] leading-relaxed text-slate-900 shadow-sm sm:px-12">
      <header className="border-b-2 border-brand-600 pb-5">
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
      </header>
      <div className="min-h-0 flex-1 whitespace-pre-wrap py-8">{content}</div>
      <footer className="border-t-2 border-brand-600 pt-4 text-center font-sans text-[10px] text-slate-600">
        <p>{LETTER_BRANDING.address}</p>
      </footer>
    </article>
  );
}
