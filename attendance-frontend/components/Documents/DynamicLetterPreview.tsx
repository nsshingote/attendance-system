type DynamicLetterPreviewProps = { title: string; content: string };

export default function DynamicLetterPreview({ title, content }: DynamicLetterPreviewProps) {
  return (
    <article className="mx-auto min-h-[760px] max-w-[794px] bg-white p-8 font-serif text-[14px] leading-relaxed text-slate-900 shadow-sm sm:p-12">
      <header className="border-b-2 border-brand-600 pb-4 text-center">
        <h2 className="text-xl font-bold tracking-wide">{title}</h2>
      </header>
      <div className="mt-8 whitespace-pre-wrap">{content}</div>
    </article>
  );
}
