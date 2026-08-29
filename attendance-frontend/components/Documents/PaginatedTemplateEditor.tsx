"use client";

import { ClipboardEvent, forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link, Table2, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { DYNAMIC_PAGE_BREAK, isDynamicPageBreak } from "@/lib/dynamicTemplateMarkers";

export interface PaginatedTemplateEditorHandle { insertPlaceholder: (token: string) => void; insertPageBreak: () => void; }
interface PaginatedTemplateEditorProps { value: string; onChange: (value: string) => void; title: string; }
export const PAGE_HEIGHT = 1120;
const FIRST_PAGE_CONTENT_HEIGHT = 780;
const OTHER_PAGE_CONTENT_HEIGHT = 920;

export const splitDynamicTemplateBlocks = (value: string) => {
  const blocks: string[] = [];
  let text: string[] = [];
  value.split("\n").forEach((line) => {
    if (isDynamicPageBreak(line)) {
      if (text.length) blocks.push(text.join("\n"));
      blocks.push(DYNAMIC_PAGE_BREAK);
      text = [];
      return;
    }
    text.push(line);
  });
  if (text.length || !blocks.length || isDynamicPageBreak(blocks[blocks.length - 1])) blocks.push(text.join("\n"));
  return blocks.length ? blocks : [""];
};
export const joinDynamicTemplateBlocks = (blocks: string[]) => blocks.join("\n");
export type DynamicTemplateFragment = { blockIndex: number; start: number; end: number; text: string };
export type DynamicTemplatePage = { fragments: DynamicTemplateFragment[]; manualBreakBefore?: number };

const blockHeight = (text: string) => {
  const measure = document.createElement("div");
  const pageWidth = Math.min(794, Math.max(240, window.innerWidth - 48));
  const contentWidth = Math.max(176, pageWidth - (window.innerWidth >= 640 ? 96 : 64));
  measure.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;width:${contentWidth}px;border:0;padding:0;font:14px/1.625 ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;white-space:pre-wrap;overflow-wrap:anywhere;`;
  measure.innerHTML = text || " "; document.body.appendChild(measure);
  const height = Math.max(23, Math.ceil(measure.getBoundingClientRect().height) + 4); measure.remove(); return height;
};
const textLength = (html: string) => {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.innerText.length;
};
const sliceHtml = (html: string, start: number, end: number) => {
  const source = document.createElement("div");
  source.innerHTML = html;
  let position = 0;
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
    node.childNodes.forEach(child => { const copied = copy(child); if (copied) element.appendChild(copied); });
    return element.childNodes.length || node.nodeName === "BR" ? element : null;
  };
  const result = document.createElement("div");
  source.childNodes.forEach(node => { const copied = copy(node); if (copied) result.appendChild(copied); });
  return result.innerHTML;
};
const fragmentForHeight = (html: string, maxHeight: number) => {
  const length = textLength(html);
  if (blockHeight(html) <= maxHeight) return length;
  let low = 1; let high = length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (blockHeight(sliceHtml(html, 0, middle)) <= maxHeight) low = middle; else high = middle - 1; }
  return low;
};

const runEditorCommand = (command: string, value?: string) => {
  document.execCommand(command, false, value);
};
export const paginateDynamicTemplateBlocks = (blocks: string[]): DynamicTemplatePage[] => {
  const pages: DynamicTemplatePage[] = [{ fragments: [] }]; let used = 0;
  blocks.forEach((block, blockIndex) => {
    if (isDynamicPageBreak(block)) { pages.push({ fragments: [], manualBreakBefore: blockIndex }); used = 0; return; }
    const blockLength = textLength(block);
    if (!blockLength) {
      const page = pages[pages.length - 1];
      const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const gap = page.fragments.length ? 12 : 0;
      const height = blockHeight("");
      if (used + gap + height > limit) { pages.push({ fragments: [] }); used = 0; }
      const target = pages[pages.length - 1];
      target.fragments.push({ blockIndex, start: 0, end: 0, text: "" });
      used += (target.fragments.length > 1 ? 12 : 0) + height;
      return;
    }
    let start = 0;
    do {
      const page = pages[pages.length - 1]; const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const gap = page.fragments.length ? 12 : 0; const remaining = limit - used - gap;
      if (remaining < 23) { pages.push({ fragments: [] }); used = 0; continue; }
      const end = start + fragmentForHeight(sliceHtml(block, start, blockLength), remaining); const text = sliceHtml(block, start, end);
      page.fragments.push({ blockIndex, start, end, text }); used += gap + blockHeight(text); start = end;
      if (start < blockLength) { pages.push({ fragments: [] }); used = 0; }
    } while (start < blockLength);
  });
  return pages;
};

const PaginatedTemplateEditor = forwardRef<PaginatedTemplateEditorHandle, PaginatedTemplateEditorProps>(function PaginatedTemplateEditor({ value, onChange, title }, ref) {
  const [blocks, setBlocks] = useState(() => splitDynamicTemplateBlocks(value));
  const [pages, setPages] = useState<DynamicTemplatePage[]>([{ fragments: [] }]);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(2);
  const [tableCols, setTableCols] = useState(2);
  const [hoveredRows, setHoveredRows] = useState(2);
  const [hoveredCols, setHoveredCols] = useState(2);
  const activeSelection = useRef({ blockIndex: 0, start: 0, end: 0, fragmentStart: 0, fragmentEnd: 0 });
  const pendingCaret = useRef<{ blockIndex: number; position: number } | null>(null);
  const editor = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const next = splitDynamicTemplateBlocks(value); setBlocks(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); }, [value]);
  useLayoutEffect(() => { if (typeof document !== "undefined") setPages(paginateDynamicTemplateBlocks(blocks)); }, [blocks]);
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (!caret || !editor.current) return;
    const fragment = Array.from(editor.current.querySelectorAll<HTMLElement>(`[data-block-index="${caret.blockIndex}"]`)).find(element => {
      const start = Number(element.dataset.fragmentStart);
      return caret.position >= start && caret.position <= start + element.innerText.length;
    });
    if (!fragment) return;
    const localPosition = caret.position - Number(fragment.dataset.fragmentStart);
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    if (!node) {
      node = document.createTextNode("");
      fragment.appendChild(node);
    }
    let remaining = localPosition;
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        pendingCaret.current = null;
        return;
      }
      remaining -= length;
      node = walker.nextNode();
    }
  }, [pages]);

  const updateActiveSelection = () => {
    const selection = window.getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const findFragment = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-template-fragment]");
    const startElement = findFragment(range.startContainer); const endElement = findFragment(range.endContainer);
    if (!startElement || startElement !== endElement) return;
    const offsetIn = (node: Node, offset: number) => { const before = document.createRange(); before.selectNodeContents(startElement); before.setEnd(node, offset); return before.toString().length; };
    const blockIndex = Number(startElement.dataset.blockIndex); const fragmentStart = Number(startElement.dataset.fragmentStart);
    activeSelection.current = { blockIndex, start: fragmentStart + offsetIn(range.startContainer, range.startOffset), end: fragmentStart + offsetIn(range.endContainer, range.endOffset), fragmentStart, fragmentEnd: Number(startElement.dataset.fragmentEnd) };
  };
  const applyBlocks = (next: string[]) => { setBlocks(next); onChange(joinDynamicTemplateBlocks(next)); };
  const replaceActiveSelection = (replacement: string) => {
    const active = activeSelection.current; const block = blocks[active.blockIndex]; if (block === undefined || isDynamicPageBreak(block)) return;
    const nextValue = `${sliceHtml(block, 0, active.start)}${replacement}${sliceHtml(block, active.end, textLength(block))}`;
    pendingCaret.current = { blockIndex: active.blockIndex, position: active.start + replacement.length };
    applyBlocks([...blocks.slice(0, active.blockIndex), ...splitDynamicTemplateBlocks(nextValue), ...blocks.slice(active.blockIndex + 1)]);
  };
  const insertPageBreak = () => {
    const active = activeSelection.current; const block = blocks[active.blockIndex]; if (block === undefined || isDynamicPageBreak(block)) return;
    const parts = [block.slice(0, active.start), DYNAMIC_PAGE_BREAK, block.slice(active.end)].filter((part, index) => part || index === 1);
    applyBlocks([...blocks.slice(0, active.blockIndex), ...parts, ...blocks.slice(active.blockIndex + 1)]);
    requestAnimationFrame(() => editor.current?.focus());
  };
  const removePageBreak = (blockIndex: number) => applyBlocks(blocks.filter((_, index) => index !== blockIndex));
  useImperativeHandle(ref, () => ({ insertPlaceholder: replaceActiveSelection, insertPageBreak }));
  const updateDocument = () => {
    if (!editor.current) return;
    const active = activeSelection.current;
    const fragment = editor.current.querySelector<HTMLElement>(`[data-block-index="${active.blockIndex}"][data-fragment-start="${active.fragmentStart}"]`);
    const block = blocks[active.blockIndex];
    if (!fragment || block === undefined) return;
    const nextFragmentText = fragment.innerHTML;
    const previousFragmentLength = active.fragmentEnd - active.fragmentStart;
    const selectedLength = active.end - active.start;
    const insertedLength = textLength(nextFragmentText) - (previousFragmentLength - selectedLength);
    const nextValue = `${sliceHtml(block, 0, active.fragmentStart)}${nextFragmentText}${sliceHtml(block, active.fragmentEnd, textLength(block))}`;
    pendingCaret.current = { blockIndex: active.blockIndex, position: active.start + insertedLength };
    applyBlocks([...blocks.slice(0, active.blockIndex), ...splitDynamicTemplateBlocks(nextValue), ...blocks.slice(active.blockIndex + 1)]);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["Enter", "Backspace", "Delete"].includes(event.key)) return;
    updateActiveSelection();
    const active = activeSelection.current;
    const block = blocks[active.blockIndex];
    if (block === undefined || isDynamicPageBreak(block)) return;
    event.preventDefault();
    if (event.key === "Enter") { replaceActiveSelection("\n"); return; }
    if (active.start !== active.end) { replaceActiveSelection(""); return; }
    if (event.key === "Backspace" && active.start > 0) {
      activeSelection.current = { ...active, start: active.start - 1 };
      replaceActiveSelection("");
      return;
    }
    if (event.key === "Delete" && active.end < block.length) {
      activeSelection.current = { ...active, end: active.end + 1 };
      replaceActiveSelection("");
    }
  };
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => { event.preventDefault(); updateActiveSelection(); replaceActiveSelection(event.clipboardData.getData("text/plain")); };

  const format = (command: string, value?: string) => {
    editor.current?.focus();
    runEditorCommand(command, value);
    updateDocument();
  };
  const addLink = () => {
    const url = window.prompt("Enter URL");
    if (url) format("createLink", url);
  };
  const handleInsertTable = () => {
    const rows = hoveredRows;
    const cols = hoveredCols;
    
    // Generate table HTML
    const cells = Array(cols)
      .fill(null)
      .map(() => '<td style="border:1px solid #cbd5e1;padding:6px">Cell</td>')
      .join("");
    const tr = `<tr>${cells}</tr>`;
    const tbody = Array(rows)
      .fill(null)
      .map(() => tr)
      .join("");
    const table = `<table style="width:100%;border-collapse:collapse"><tbody>${tbody}</tbody></table><p><br></p>`;
    
    runEditorCommand("insertHTML", table);
    setShowTableDialog(false);
    setTableRows(2);
    setTableCols(2);
    setHoveredRows(2);
    setHoveredCols(2);
    updateDocument();
  };
  const toolbarButton = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-700 hover:bg-ink-100">
      {icon}
    </button>
  );

  return <div className="overflow-x-auto rounded-lg bg-ink-100 p-3 sm:p-6">
    <div className="mb-3 flex flex-wrap items-center gap-1 rounded border border-ink-200 bg-white p-1">
      {toolbarButton("Bold", <Bold size={16} />, () => format("bold"))}
      {toolbarButton("Italic", <Italic size={16} />, () => format("italic"))}
      {toolbarButton("Underline", <Underline size={16} />, () => format("underline"))}
      <select aria-label="Font size" title="Font size" defaultValue="3" onChange={event => format("fontSize", event.target.value)} className="h-8 rounded border-0 bg-transparent px-1 text-xs text-ink-700">
        <option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Title</option>
      </select>
      <select aria-label="Paragraph style" title="Paragraph style" defaultValue="p" onChange={event => format("formatBlock", event.target.value)} className="h-8 rounded border-0 bg-transparent px-1 text-xs text-ink-700">
        <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option>
      </select>
      {toolbarButton("Align left", <AlignLeft size={16} />, () => format("justifyLeft"))}
      {toolbarButton("Align center", <AlignCenter size={16} />, () => format("justifyCenter"))}
      {toolbarButton("Align right", <AlignRight size={16} />, () => format("justifyRight"))}
      {toolbarButton("Bulleted list", <List size={16} />, () => format("insertUnorderedList"))}
      {toolbarButton("Numbered list", <ListOrdered size={16} />, () => format("insertOrderedList"))}
      {toolbarButton("Insert link", <Link size={16} />, addLink)}
      {toolbarButton("Insert table", <Table2 size={16} />, () => setShowTableDialog(true))}
      <span className="mx-1 h-6 w-px bg-ink-200" />
      {toolbarButton("Undo", <Undo2 size={16} />, () => format("undo"))}
      {toolbarButton("Redo", <Redo2 size={16} />, () => format("redo"))}
      <button type="button" onClick={insertPageBreak} className="ml-auto rounded border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700">Insert Page Break</button>
    </div>
    <div ref={editor} contentEditable={true} tabIndex={0} role="textbox" aria-multiline="true" suppressContentEditableWarning onBeforeInput={updateActiveSelection} onInput={updateDocument} onSelect={updateActiveSelection} onKeyUp={updateActiveSelection} onMouseUp={updateActiveSelection} onKeyDown={handleKeyDown} onPaste={handlePaste} className="mx-auto flex min-w-0 w-fit flex-col gap-6 outline-none">
      {pages.map((page, pageIndex) => <div key={pageIndex} className="contents">
        {page.manualBreakBefore !== undefined && <div contentEditable={false} className="mx-auto flex w-[min(794px,calc(100vw-48px))] items-center gap-3 text-xs font-semibold tracking-widest text-brand-700 before:h-px before:flex-1 before:bg-brand-300 after:h-px after:flex-1 after:bg-brand-300"><span>PAGE BREAK</span><button type="button" onClick={() => removePageBreak(page.manualBreakBefore!)} className="rounded border border-brand-300 bg-white px-2 py-1 text-[10px] tracking-normal">Remove</button></div>}
        <section className="mx-auto flex h-[1120px] w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-serif text-sm leading-relaxed text-slate-900 shadow-md sm:px-14">
          {pageIndex === 0 && <div contentEditable={false} className="border-b-2 border-brand-600 pb-4"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" /><div><p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p><p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p></div></div><div className="font-sans text-[10px] text-blue-900"><p>{LETTER_BRANDING.website}</p><p>{LETTER_BRANDING.email}</p><p>{LETTER_BRANDING.phone}</p></div></div></div>}
          {pageIndex === 0 && <p contentEditable={false} className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>}
          <div className={`${pageIndex === 0 ? "h-[780px]" : "h-[920px]"} shrink-0 overflow-hidden`}>
            {page.fragments.map(fragment => <div key={`${fragment.blockIndex}:${fragment.start}`} data-template-fragment data-block-index={fragment.blockIndex} data-fragment-start={fragment.start} data-fragment-end={fragment.end} className={`whitespace-pre-wrap wrap-break-words overflow-wrap-break outline-none ${fragment.end === textLength(blocks[fragment.blockIndex]) ? "mb-3" : ""}`} dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />)}
          </div>
          <footer contentEditable={false} className="mt-auto border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400"><p>{LETTER_BRANDING.address}</p><p className="mt-1">Page {pageIndex + 1}</p></footer>
        </section>
      </div>)}
    </div>
    {showTableDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="rounded-lg bg-white p-6 shadow-lg max-w-sm w-full">
          <h3 className="mb-4 text-lg font-semibold">Insert Table</h3>
          <p className="mb-4 text-sm text-ink-600">Click to select table size: {hoveredRows} × {hoveredCols}</p>
          <div className="mb-6 inline-block border border-ink-300 rounded">
            {Array.from({ length: 10 }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex">
                {Array.from({ length: 10 }).map((_, colIndex) => (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    onMouseEnter={() => {
                      setHoveredRows(rowIndex + 1);
                      setHoveredCols(colIndex + 1);
                    }}
                    onClick={() => {
                      setTableRows(rowIndex + 1);
                      setTableCols(colIndex + 1);
                      setHoveredRows(rowIndex + 1);
                      setHoveredCols(colIndex + 1);
                    }}
                    className={`h-6 w-6 border border-ink-200 transition-colors ${
                      rowIndex < hoveredRows && colIndex < hoveredCols
                        ? "bg-brand-500"
                        : "bg-white hover:bg-ink-50"
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setShowTableDialog(false);
                setTableRows(2);
                setTableCols(2);
                setHoveredRows(2);
                setHoveredCols(2);
              }}
              className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium hover:bg-ink-50"
            >
              Cancel
            </button>
            <button
              onClick={handleInsertTable}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Insert
            </button>
          </div>
        </div>
      </div>
    )}
  </div>;
});

export default PaginatedTemplateEditor;
