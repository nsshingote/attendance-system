"use client";

import { ClipboardEvent, FormEvent, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link, Table2, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { FIRST_PAGE_BODY_HEIGHT_PX, FRAGMENT_GAP_PX, OTHER_PAGE_BODY_HEIGHT_PX, normalizeDynamicTemplateHtml, sliceHtml, textLength } from "@/lib/dynamicLetterLayout";
import { DYNAMIC_PAGE_BREAK, isDynamicPageBreak } from "@/lib/dynamicTemplateMarkers";

export interface PaginatedTemplateEditorHandle { insertPlaceholder: (token: string) => void; insertPageBreak: () => void; commit: () => string; }
interface PaginatedTemplateEditorProps { value: string; onChange: (value: string) => void; title: string; }
export const PAGE_HEIGHT = 1120;
const FIRST_PAGE_CONTENT_HEIGHT = FIRST_PAGE_BODY_HEIGHT_PX;
const OTHER_PAGE_CONTENT_HEIGHT = OTHER_PAGE_BODY_HEIGHT_PX;
const TABLE_MIN_WIDTH_PX = 240;
const PAGE_GAP_PX = 24;
const PAGE_PADDING_Y_PX = 28;
const PAGE_HORIZONTAL_PADDING_PX = 56;
const FOOTER_RESERVE_PX = PAGE_HEIGHT - PAGE_PADDING_Y_PX * 2 - OTHER_PAGE_BODY_HEIGHT_PX;
const INTER_BODY_BAND_PX = FOOTER_RESERVE_PX + PAGE_PADDING_Y_PX + PAGE_GAP_PX + PAGE_PADDING_Y_PX;

export const splitDynamicTemplateBlocks = (value: string) => {
  const blocks: string[] = [];
  let text: string[] = [];
  const pushContentBlocks = (content: string) => {
    const source = document.createElement("div");
    source.innerHTML = content;
    const topLevelNodes = Array.from(source.childNodes).filter(node =>
      !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
    );
    const blockNodes = topLevelNodes.filter(node =>
      node.nodeType === Node.ELEMENT_NODE &&
      /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE|TABLE)$/i.test((node as Element).nodeName),
    );
    if (topLevelNodes.length > 1 && blockNodes.length === topLevelNodes.length) {
      blockNodes.forEach(node => blocks.push((node as Element).outerHTML));
      return;
    }

    const parts = content.split(/(<table\b[\s\S]*?<\/table>)/gi);
    if (parts.length === 1) blocks.push(parts[0]);
    else parts.forEach((part, index) => {
      const isTable = /^<table\b/i.test(part.trim());
      if (isTable) {
        blocks.push(part);
        return;
      }
      let normalized = part;
      if (/^<table\b/i.test(parts[index - 1]?.trim() ?? "")) normalized = normalized.replace(/^\r?\n/, "");
      if (/^<table\b/i.test(parts[index + 1]?.trim() ?? "")) normalized = normalized.replace(/\r?\n$/, "");
      if (normalized || /^<table\b/i.test(parts[index - 1]?.trim() ?? "")) blocks.push(normalized);
    });
  };
  value.split("\n").forEach((line) => {
    if (isDynamicPageBreak(line)) {
      if (text.length) pushContentBlocks(text.join("\n"));
      blocks.push(DYNAMIC_PAGE_BREAK);
      text = [];
      return;
    }
    text.push(line);
  });
  if (text.length || !blocks.length || isDynamicPageBreak(blocks[blocks.length - 1])) pushContentBlocks(text.join("\n"));
  return blocks.length ? blocks : [""];
};
const stripEditorScaffolding = (html: string) => {
  const source = document.createElement("div");
  source.innerHTML = html;
  source.querySelectorAll<HTMLElement>("[data-template-editable-block]").forEach(block => {
    block.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = (node.textContent ?? "").replace(/\u200B/g, "");
    });
    if (!block.textContent?.trim() && !block.children.length) block.appendChild(document.createElement("br"));
    block.removeAttribute("data-template-editable-block");
    block.style.removeProperty("min-height");
    block.style.removeProperty("margin");
    const hasText = Boolean(block.textContent?.trim());
    const lastChild = block.lastChild;
    if (hasText && lastChild && lastChild.nodeType === Node.ELEMENT_NODE && (lastChild as Element).nodeName === "BR") lastChild.remove();
  });
  source.querySelectorAll<HTMLElement>("p").forEach(paragraph => {
    paragraph.style.setProperty("margin", "0");
  });
  return source.innerHTML;
};
export const joinDynamicTemplateBlocks = (blocks: string[]) =>
  blocks.map(block => block === "" ? "<p><br></p>" : stripEditorScaffolding(block)).join("\n");
export type DynamicTemplateFragment = { blockIndex: number; start: number; end: number; text: string };
export type DynamicTemplatePage = { fragments: DynamicTemplateFragment[]; manualBreakBefore?: number };
export type DynamicPaginationGeometry = { pageWidth: number; horizontalPadding: number };
export const A4_PAGINATION_GEOMETRY: DynamicPaginationGeometry = { pageWidth: 794, horizontalPadding: 112 };

const blockHeight = (text: string, geometry?: DynamicPaginationGeometry) => {
  const measure = document.createElement("div");
  const pageWidth = geometry?.pageWidth ?? Math.min(794, Math.max(240, window.innerWidth - 48));
  const horizontalPadding = geometry?.horizontalPadding ?? (window.innerWidth >= 640 ? 96 : 64);
  const contentWidth = Math.max(176, pageWidth - horizontalPadding);
  measure.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;width:${contentWidth}px;max-width:none;border:0;padding:0;font:14px/1.625 Georgia, "Times New Roman", Times, serif;white-space:pre-wrap;overflow-wrap:anywhere;`;
  measure.innerHTML = text || " "; document.body.appendChild(measure);
  const height = Math.max(23, Math.ceil(measure.getBoundingClientRect().height) + 4); measure.remove(); return height;
};
const fragmentForHeight = (html: string, maxHeight: number, geometry?: DynamicPaginationGeometry) => {
  const length = textLength(html);
  if (blockHeight(html, geometry) <= maxHeight) return length;
  let low = 1; let high = length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (blockHeight(sliceHtml(html, 0, middle), geometry) <= maxHeight) low = middle; else high = middle - 1; }
  return low;
};
const tableFragmentForPage = (tableHtml: string, start: number, maxHeight: number, geometry?: DynamicPaginationGeometry) => {
  const source = document.createElement("div");
  source.innerHTML = tableHtml;
  const table = source.querySelector("table");
  if (!table) return { html: tableHtml, end: start + 1, rowCount: start + 1 };
  const rows = Array.from(table.rows);
  if (!rows.length) return { html: table.outerHTML, end: 0, rowCount: 0 };
  const visualTable = table.cloneNode(false) as HTMLTableElement;
  const body = document.createElement("tbody");
  visualTable.appendChild(body);
  let end = start;
  while (end < rows.length) {
    body.appendChild(rows[end].cloneNode(true));
    if (end > start && blockHeight(visualTable.outerHTML, geometry) > maxHeight) {
      body.removeChild(body.lastElementChild!);
      break;
    }
    end += 1;
  }
  if (end === start) {
    body.appendChild(rows[end].cloneNode(true));
    end += 1;
  }
  visualTable.dataset.tableRowStart = String(start);
  visualTable.dataset.tableRowEnd = String(end);
  return { html: visualTable.outerHTML, end, rowCount: rows.length };
};
export const paginateDynamicTemplateBlocks = (blocks: string[], geometry?: DynamicPaginationGeometry): DynamicTemplatePage[] => {
  const pages: DynamicTemplatePage[] = [{ fragments: [] }]; let used = 0;
  blocks.forEach((block, blockIndex) => {
    if (isDynamicPageBreak(block)) { pages.push({ fragments: [], manualBreakBefore: blockIndex }); used = 0; return; }
    if (/^<table\b/i.test(block.trim())) {
      let rowStart = 0;
      let rowCount = 1;
      while (rowStart < rowCount) {
        const page = pages[pages.length - 1];
        const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
        const remaining = limit - used;
        const tableFragment = tableFragmentForPage(block, rowStart, Math.max(23, remaining), geometry);
        rowCount = tableFragment.rowCount;
        const height = blockHeight(tableFragment.html, geometry);
        if (page.fragments.length && height > remaining) { pages.push({ fragments: [] }); used = 0; continue; }
        const gap = page.fragments.length ? FRAGMENT_GAP_PX : 0;
        page.fragments.push({ blockIndex, start: 0, end: textLength(block), text: tableFragment.html });
        used += gap + height;
        rowStart = tableFragment.end;
        if (rowStart < rowCount) { pages.push({ fragments: [] }); used = 0; }
      }
      return;
    }
    const blockLength = textLength(block);
    if (!blockLength) {
      const page = pages[pages.length - 1];
      const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const isCaretAfterTable = /^<table\b/i.test(blocks[blockIndex - 1]?.trim());
      const height = isCaretAfterTable ? 0 : blockHeight("", geometry);
      const gap = page.fragments.length ? FRAGMENT_GAP_PX : 0;
      if (!isCaretAfterTable && used + gap + height > limit) { pages.push({ fragments: [] }); used = 0; }
      const target = pages[pages.length - 1];
      target.fragments.push({ blockIndex, start: 0, end: 0, text: "" });
      used += gap + height;
      return;
    }
    let start = 0;
    do {
      const page = pages[pages.length - 1]; const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const gap = page.fragments.length ? FRAGMENT_GAP_PX : 0;
      const remaining = limit - used - gap;
      if (remaining < 23) { pages.push({ fragments: [] }); used = 0; continue; }
      const end = start + fragmentForHeight(sliceHtml(block, start, blockLength), remaining, geometry); const text = sliceHtml(block, start, end);
      page.fragments.push({ blockIndex, start, end, text }); used += gap + blockHeight(text, geometry); start = end;
      if (start < blockLength) { pages.push({ fragments: [] }); used = 0; }
    } while (start < blockLength);
  });
  return pages;
};

const PAGE_BREAK_MARKUP = `<div data-page-break="true" contenteditable="false" class="my-2 flex select-none items-center gap-3 text-xs font-semibold tracking-widest text-brand-700"><span class="h-px flex-1 bg-brand-300"></span><span>PAGE BREAK</span><span class="h-px flex-1 bg-brand-300"></span></div>`;

const documentHtmlFromValue = (value: string) => {
  const html = splitDynamicTemplateBlocks(value || "").map(block => {
    if (isDynamicPageBreak(block)) return PAGE_BREAK_MARKUP;
    return block.trim() ? block : "<p><br></p>";
  }).join("");
  return html || "<p><br></p>";
};

const serializeDocumentHtml = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-page-spacer]").forEach(node => node.remove());
  clone.querySelectorAll<HTMLElement>("[data-page-start]").forEach(node => {
    node.removeAttribute("data-page-start");
    node.style.removeProperty("margin-top");
    if (!node.getAttribute("style")) node.removeAttribute("style");
  });
  clone.querySelectorAll("[data-page-break]").forEach(node => {
    node.replaceWith(document.createTextNode(`\n${DYNAMIC_PAGE_BREAK}\n`));
  });
  clone.querySelectorAll<HTMLElement>("p").forEach(paragraph => {
    paragraph.style.setProperty("margin", "0");
  });
  return stripEditorScaffolding(clone.innerHTML);
};

const clearLivePageStarts = (editor: HTMLElement) => {
  editor.querySelectorAll<HTMLElement>("[data-page-start]").forEach(node => {
    node.removeAttribute("data-page-start");
    node.style.removeProperty("margin-top");
    if (!node.getAttribute("style")) node.removeAttribute("style");
  });
};

const applyLivePageStarts = (editor: HTMLElement) => {
  clearLivePageStarts(editor);
  const children = Array.from(editor.children) as HTMLElement[];
  if (!children.length) {
    editor.innerHTML = "<p><br></p>";
    return 1;
  }
  let pageIndex = 0;
  let used = 0;
  children.forEach(element => {
    if (element.dataset.pageBreak === "true") {
      const limit = pageIndex === 0 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const remaining = Math.max(0, limit - used);
      element.style.marginTop = `${remaining + INTER_BODY_BAND_PX}px`;
      element.dataset.pageStart = "true";
      pageIndex += 1;
      used = 0;
      return;
    }
    const height = element.offsetHeight;
    const limit = pageIndex === 0 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
    const gap = used > 0 ? FRAGMENT_GAP_PX : 0;
    if (used > 0 && used + gap + height > limit) {
      const remaining = Math.max(0, limit - used);
      element.style.marginTop = `${remaining + INTER_BODY_BAND_PX}px`;
      element.dataset.pageStart = "true";
      pageIndex += 1;
      used = height;
      return;
    }
    used += gap + height;
  });
  return pageIndex + 1;
};

const runEditorCommand = (command: string, value?: string) => {
  document.execCommand(command, false, value);
};

const LetterPageChrome = ({ pageIndex, title, bodySlotRef }: { pageIndex: number; title: string; bodySlotRef?: (element: HTMLDivElement | null) => void }) => (
  <article
    aria-hidden="true"
    style={{ width: "794px", height: `${PAGE_HEIGHT}px`, fontFamily: 'Georgia, "Times New Roman", Times, serif' }}
    className="pointer-events-none absolute left-0 top-0 flex flex-col bg-white px-14 py-7 text-sm leading-relaxed text-slate-900 shadow-md"
  >
    {pageIndex === 0 && (
      <div className="border-b-2 border-brand-600 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" />
            <div>
              <p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p>
              <p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p>
            </div>
          </div>
          <div className="font-sans text-[10px] text-blue-900">
            <p>{LETTER_BRANDING.website}</p>
            <p>{LETTER_BRANDING.email}</p>
            <p>{LETTER_BRANDING.phone}</p>
          </div>
        </div>
      </div>
    )}
    {pageIndex === 0 && <p className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>}
    <div
      ref={bodySlotRef}
      style={{ height: `${pageIndex === 0 ? FIRST_PAGE_BODY_HEIGHT_PX : OTHER_PAGE_BODY_HEIGHT_PX}px` }}
      className="shrink-0"
    />
    <footer className="mt-auto border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400">
      <p>{LETTER_BRANDING.address}</p>
      <p className="mt-1">Page {pageIndex + 1}</p>
    </footer>
  </article>
);

const PaginatedTemplateEditor = forwardRef<PaginatedTemplateEditorHandle, PaginatedTemplateEditorProps>(function PaginatedTemplateEditor({ value, onChange, title }, ref) {
  const editor = useRef<HTMLDivElement | null>(null);
  const stack = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef(value);
  const [pageCount, setPageCount] = useState(1);
  const [bodyTop, setBodyTop] = useState(PAGE_PADDING_Y_PX + 126);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(2);
  const [tableCols, setTableCols] = useState(2);
  const [hoveredRows, setHoveredRows] = useState(2);
  const [hoveredCols, setHoveredCols] = useState(2);

  const remasurePages = () => {
    if (!editor.current) return;
    setPageCount(applyLivePageStarts(editor.current));
  };

  const emitDocument = () => {
    if (!editor.current) return "";
    const html = serializeDocumentHtml(editor.current);
    lastEmitted.current = html;
    onChange(html);
    return html;
  };

  useLayoutEffect(() => {
    if (!editor.current) return;
    if (lastEmitted.current === value && editor.current.innerHTML) {
      remasurePages();
      return;
    }
    editor.current.innerHTML = normalizeDynamicTemplateHtml(documentHtmlFromValue(value));
    lastEmitted.current = value;
    remasurePages();
  }, [value]);

  useLayoutEffect(() => {
    const slot = stack.current?.querySelector<HTMLElement>("[data-first-body-slot]");
    if (slot) setBodyTop(slot.offsetTop);
  }, [title, pageCount]);

  const handleInput = (_event?: FormEvent<HTMLDivElement>) => {
    emitDocument();
    requestAnimationFrame(remasurePages);
  };

  const insertPlaceholder = (token: string) => {
    editor.current?.focus();
    runEditorCommand("insertText", token);
    handleInput();
  };

  const insertPageBreak = () => {
    editor.current?.focus();
    runEditorCommand("insertHTML", `${PAGE_BREAK_MARKUP}<p><br></p>`);
    handleInput();
  };

  const commit = () => emitDocument();

  useImperativeHandle(ref, () => ({ insertPlaceholder, insertPageBreak, commit }));

  const format = (command: string, commandValue?: string) => {
    editor.current?.focus();
    runEditorCommand(command, commandValue);
    handleInput();
  };

  const addLink = () => {
    const url = window.prompt("Enter URL");
    if (url) format("createLink", url);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (html) {
      const source = document.createElement("div");
      source.innerHTML = html;
      source.querySelectorAll("script, style, meta, link").forEach(node => node.remove());
      runEditorCommand("insertHTML", source.innerHTML);
    } else {
      runEditorCommand("insertText", text);
    }
    handleInput();
  };

  const handleInsertTable = (rows = tableRows, cols = tableCols) => {
    const cell = `<td style="border:1px solid #cbd5e1;padding:8px;min-width:120px;vertical-align:top;">Cell</td>`;
    const row = `<tr>${Array(cols).fill(cell).join("")}</tr>`;
    const table = `<table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:${TABLE_MIN_WIDTH_PX}px;margin:0;">${Array(rows).fill(row).join("")}</table><p><br></p>`;
    editor.current?.focus();
    runEditorCommand("insertHTML", table);
    handleInput();
    setShowTableDialog(false);
    setTableRows(2);
    setTableCols(2);
    setHoveredRows(2);
    setHoveredCols(2);
  };

  const toolbarButton = (label: string, icon: ReactNode, onClick: () => void) => (
    <button type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-700 hover:bg-ink-100">
      {icon}
    </button>
  );

  const stackHeight = pageCount * PAGE_HEIGHT + Math.max(0, pageCount - 1) * PAGE_GAP_PX;

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
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={insertPageBreak} className="ml-auto rounded border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700">Insert Page Break</button>
    </div>
    <div ref={stack} className="relative mx-auto" style={{ width: "794px", height: `${stackHeight}px` }}>
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <div key={pageIndex} className="absolute left-0 top-0" style={{ top: `${pageIndex * (PAGE_HEIGHT + PAGE_GAP_PX)}px` }}>
          <LetterPageChrome
            pageIndex={pageIndex}
            title={title}
            bodySlotRef={pageIndex === 0 ? element => { if (element) element.setAttribute("data-first-body-slot", "true"); } : undefined}
          />
        </div>
      ))}
      <div
        ref={editor}
        role="textbox"
        aria-label={title || "Letter content"}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        style={{
          top: `${bodyTop}px`,
          left: `${PAGE_HORIZONTAL_PADDING_PX}px`,
          width: `${794 - PAGE_HORIZONTAL_PADDING_PX * 2}px`,
          minHeight: `${FIRST_PAGE_BODY_HEIGHT_PX}px`,
          fontFamily: 'Georgia, "Times New Roman", Times, serif',
        }}
        className="absolute z-10 text-sm leading-relaxed text-slate-900 outline-none [&_p]:m-0 [&_table]:my-0 [&_table]:min-w-60 [&_table]:border-collapse"
      />
    </div>
    {showTableDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
          <h3 className="mb-4 text-lg font-semibold">Insert Table</h3>
          <p className="mb-4 text-sm text-ink-600">Click to select table size: {hoveredRows} × {hoveredCols}</p>
          <div className="mb-6 inline-block rounded border border-ink-300">
            {Array.from({ length: 10 }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex">
                {Array.from({ length: 10 }).map((_, colIndex) => (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    onMouseEnter={() => { setHoveredRows(rowIndex + 1); setHoveredCols(colIndex + 1); }}
                    onClick={() => handleInsertTable(rowIndex + 1, colIndex + 1)}
                    className={`h-6 w-6 border border-ink-200 ${rowIndex < hoveredRows && colIndex < hoveredCols ? "bg-brand-500" : "bg-white hover:bg-ink-50"}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowTableDialog(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      </div>
    )}
  </div>;
});

export default PaginatedTemplateEditor;