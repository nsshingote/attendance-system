type DynamicLetterPreviewProps = { title: string; content: string; companyName?: string; companyAddress?: string; logoUrl?: string };

export default function DynamicLetterPreview({ title, content, companyName = "PropCheckup", companyAddress = "Office No. 62, Xth Central Mall, 2nd Floor, Above Kotak Bank, Mahavir Nagar, Kandivali West, Mumbai - 400067", logoUrl = "/logo.jpg" }: DynamicLetterPreviewProps) {
  return (
    <article className="mx-auto flex min-h-1120px max-w-794px flex-col bg-white px-8 py-7 font-serif text-[14px] leading-relaxed text-slate-900 shadow-sm sm:px-12">
      <header className="border-b-2 border-brand-600 pb-5">
        <div className="flex items-center gap-4">
          <img src={logoUrl} alt="Company logo" className="h-14 w-14 object-contain" />
          <div>
            <h2 className="text-xl font-bold tracking-wide text-slate-900">{companyName}</h2>
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-brand-700">Official company document</p>
          </div>
        </div>
        <h1 className="mt-6 text-center text-lg font-bold uppercase tracking-[0.12em]">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 whitespace-pre-wrap py-8">{content}</div>
      <footer className="border-t-2 border-brand-600 pt-4 text-center font-sans text-[10px] text-slate-600">
        <p>{companyAddress}</p>
        <p className="mt-1 text-brand-700">{companyName}</p>
      </footer>
    </article>
  );
}
