"use client";

import { ClipboardEvent, FocusEvent, FormEvent, forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const pushContentBlocks = (content: string) => {
    // A table must never enter the generic text slicing path below. That path
    // clones ancestor nodes for each page fragment, which creates partial table
    // DOM that browsers normalise differently on every edit.
    const parts = content.split(/(<table\b[\s\S]*?<\/table>)/gi);
    if (parts.length === 1) blocks.push(parts[0]);
    else parts.forEach(part => { if (part) blocks.push(part); });
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
const tableFragmentForPage = (tableHtml: string, start: number, maxHeight: number) => {
  const source = document.createElement("div");
  source.innerHTML = tableHtml;
  const table = source.querySelector("table");
  if (!table) return { html: tableHtml, end: start + 1, rowCount: start + 1 };
  const rows = Array.from(table.rows);
  if (!rows.length) return { html: table.outerHTML, end: 0, rowCount: 0 };
  const visualTable = table.cloneNode(false) as HTMLTableElement;
  // This is applied to the page-only clone. Resizing never mutates the source
  // table during pagination; persistTable saves a completed user resize.
  visualTable.style.resize = "both";
  visualTable.style.overflow = "auto";
  if (!visualTable.style.minWidth) visualTable.style.minWidth = "240px";
  const body = document.createElement("tbody");
  visualTable.appendChild(body);
  let end = start;
  while (end < rows.length) {
    body.appendChild(rows[end].cloneNode(true));
    if (end > start && blockHeight(visualTable.outerHTML) > maxHeight) {
      body.removeChild(body.lastElementChild!);
      break;
    }
    end += 1;
  }
  // A single unusually tall row is still rendered as one visual fragment; it
  // is never duplicated or split into a new source row.
  if (end === start) {
    body.appendChild(rows[end].cloneNode(true));
    end += 1;
  }
  visualTable.dataset.tableRowStart = String(start);
  visualTable.dataset.tableRowEnd = String(end);
  return { html: visualTable.outerHTML, end, rowCount: rows.length };
};
export const paginateDynamicTemplateBlocks = (blocks: string[]): DynamicTemplatePage[] => {
  const pages: DynamicTemplatePage[] = [{ fragments: [] }]; let used = 0;
  blocks.forEach((block, blockIndex) => {
    if (isDynamicPageBreak(block)) { pages.push({ fragments: [], manualBreakBefore: blockIndex }); used = 0; return; }
    if (/^<table\b/i.test(block.trim())) {
      let rowStart = 0;
      let rowCount = 1;
      while (rowStart < rowCount) {
        const page = pages[pages.length - 1];
        const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
        const gap = page.fragments.length ? 12 : 0;
        const remaining = limit - used - gap;
        const tableFragment = tableFragmentForPage(block, rowStart, Math.max(23, remaining));
        rowCount = tableFragment.rowCount;
        const height = blockHeight(tableFragment.html);
        if (page.fragments.length && height > remaining) { pages.push({ fragments: [] }); used = 0; continue; }
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
      const gap = page.fragments.length ? 12 : 0;
      const isCaretAfterTable = /^<table\b/i.test(blocks[blockIndex - 1]?.trim());
      const height = isCaretAfterTable ? 0 : blockHeight("");
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
  const blocksRef = useRef(blocks);
  const historyRef = useRef<{ past: string[][]; future: string[][] }>({ past: [], future: [] });
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(2);
  const [tableCols, setTableCols] = useState(2);
  const [hoveredRows, setHoveredRows] = useState(2);
  const [hoveredCols, setHoveredCols] = useState(2);
  const activeSelection = useRef({ blockIndex: 0, start: 0, end: 0, fragmentStart: 0, fragmentEnd: 0 });
  const tableSelection = useRef<Range | null>(null);
  const resizingTable = useRef<HTMLTableElement | null>(null);
  const resizeStart = useRef<{ table: HTMLTableElement; x: number; y: number; width: number; height: number } | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const pendingCaret = useRef<{ blockIndex: number; position: number } | null>(null);
  const tableEditPending = useRef(false);
  const editor = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const next = splitDynamicTemplateBlocks(value);
    setBlocks(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    blocksRef.current = next;
  }, [value]);
  useLayoutEffect(() => { blocksRef.current = blocks; }, [blocks]);
  const pages = useMemo(() => paginateDynamicTemplateBlocks(blocks), [blocks]);
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
    const findTableCell = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("td, th");
    const startCell = findTableCell(range.startContainer); const endCell = findTableCell(range.endContainer);
    tableSelection.current = startCell && startCell === endCell ? range.cloneRange() : null;
    const offsetIn = (node: Node, offset: number) => { const before = document.createRange(); before.selectNodeContents(startElement); before.setEnd(node, offset); return before.toString().length; };
    const blockIndex = Number(startElement.dataset.blockIndex); const fragmentStart = Number(startElement.dataset.fragmentStart);
    activeSelection.current = { blockIndex, start: fragmentStart + offsetIn(range.startContainer, range.startOffset), end: fragmentStart + offsetIn(range.endContainer, range.endOffset), fragmentStart, fragmentEnd: Number(startElement.dataset.fragmentEnd) };
  };
  const applyBlocks = (next: string[]) => {
    const normalized = next.length ? next : [""];
    const current = blocksRef.current;
    if (JSON.stringify(current) === JSON.stringify(normalized)) return;
    historyRef.current.past.push(current);
    if (historyRef.current.past.length > 100) historyRef.current.past.shift();
    historyRef.current.future = [];
    blocksRef.current = normalized;
    setBlocks(normalized);
    onChange(joinDynamicTemplateBlocks(normalized));
  };
  const undoBlocks = () => {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(blocksRef.current);
    blocksRef.current = previous;
    setBlocks(previous);
    onChange(joinDynamicTemplateBlocks(previous));
  };
  const redoBlocks = () => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(blocksRef.current);
    blocksRef.current = next;
    setBlocks(next);
    onChange(joinDynamicTemplateBlocks(next));
  };
  const replaceActiveSelection = (replacement: string) => {
    const range = tableSelection.current;
    const tableCell = range && (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>("td, th");
    const tableFragment = tableCell?.closest<HTMLElement>("[data-template-fragment]");
    const table = tableCell?.closest<HTMLTableElement>("table");
    if (range && tableCell && table && tableFragment && editor.current?.contains(tableCell)) {
      range.deleteContents();
      const inserted = document.createTextNode(replacement);
      range.insertNode(inserted);
      range.setStartAfter(inserted);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      tableSelection.current = range.cloneRange();
      persistTable(table);
      return;
    }
    const active = activeSelection.current; const block = blocksRef.current[active.blockIndex]; if (block === undefined || isDynamicPageBreak(block)) return;
    const nextValue = `${sliceHtml(block, 0, active.start)}${replacement}${sliceHtml(block, active.end, textLength(block))}`;
    pendingCaret.current = { blockIndex: active.blockIndex, position: active.start + replacement.length };
    applyBlocks([...blocksRef.current.slice(0, active.blockIndex), ...splitDynamicTemplateBlocks(nextValue), ...blocksRef.current.slice(active.blockIndex + 1)]);
  };
  const insertPageBreak = () => {
    const active = activeSelection.current; const block = blocksRef.current[active.blockIndex]; if (block === undefined || isDynamicPageBreak(block)) return;
    const parts = [block.slice(0, active.start), DYNAMIC_PAGE_BREAK, block.slice(active.end)].filter((part, index) => part || index === 1);
    applyBlocks([...blocksRef.current.slice(0, active.blockIndex), ...parts, ...blocksRef.current.slice(active.blockIndex + 1)]);
    requestAnimationFrame(() => editor.current?.focus());
  };
  const removePageBreak = (blockIndex: number) => applyBlocks(blocksRef.current.filter((_, index) => index !== blockIndex));
  useImperativeHandle(ref, () => ({ insertPlaceholder: replaceActiveSelection, insertPageBreak }));
  const commitDocument = (restoreCaret = true) => {
    if (!editor.current) return;
    const active = activeSelection.current;
    const fragment = editor.current.querySelector<HTMLElement>(`[data-block-index="${active.blockIndex}"][data-fragment-start="${active.fragmentStart}"]`);
    const block = blocksRef.current[active.blockIndex];
    if (!fragment || block === undefined) return;
    const nextFragmentText = fragment.innerHTML;
    const previousFragmentLength = active.fragmentEnd - active.fragmentStart;
    const selectedLength = active.end - active.start;
    const insertedLength = textLength(nextFragmentText) - (previousFragmentLength - selectedLength);
    const nextValue = `${sliceHtml(block, 0, active.fragmentStart)}${nextFragmentText}${sliceHtml(block, active.fragmentEnd, textLength(block))}`;
    if (restoreCaret) pendingCaret.current = { blockIndex: active.blockIndex, position: active.start + insertedLength };
    applyBlocks([...blocksRef.current.slice(0, active.blockIndex), ...splitDynamicTemplateBlocks(nextValue), ...blocksRef.current.slice(active.blockIndex + 1)]);
  };
  const editingTable = (event?: { target: EventTarget | null; nativeEvent?: Event }) => {
    const elementFor = (node: EventTarget | Node | null) => node instanceof HTMLElement ? node : node instanceof Node ? node.parentElement : null;
    const eventPath = event?.nativeEvent?.composedPath?.() ?? [];
    const eventTable = elementFor(event?.target ?? null)?.closest("table") ||
      eventPath.map(elementFor).find(element => element?.closest("table"))?.closest("table");
    if (eventTable) return eventTable;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const startTable = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest("table");
    const endTable = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement)?.closest("table");
    return startTable && startTable === endTable ? startTable : null;
  };
  const isTableEdit = (event?: { target: EventTarget | null; nativeEvent?: Event }) => Boolean(editingTable(event));
  const persistTable = (table: HTMLTableElement) => {
    const fragment = table.closest<HTMLElement>("[data-template-fragment]");
    const blockIndex = Number(fragment?.dataset.blockIndex);
    const currentBlocks = blocksRef.current;
    if (!Number.isInteger(blockIndex) || currentBlocks[blockIndex] === undefined) return;
    const source = document.createElement("div");
    source.innerHTML = currentBlocks[blockIndex];
    const renderedTables = Array.from(fragment?.querySelectorAll("table") ?? []);
    const tableIndex = renderedTables.indexOf(table);
    const sourceTable = source.querySelectorAll("table")[tableIndex];
    if (!sourceTable) return;
    const rowStart = Number(table.dataset.tableRowStart ?? 0);
    const rowEnd = Number(table.dataset.tableRowEnd ?? 0);
    const renderedRows = Array.from(table.rows);
    const sourceRows = Array.from(sourceTable.rows);
    // A paginated table edit is valid only when it maps to the exact source
    // row range that pagination rendered. Never replace the source table with
    // a page-local fragment when that mapping is unavailable or inconsistent.
    if (!Number.isInteger(rowStart) || !Number.isInteger(rowEnd) || rowStart < 0 || rowEnd !== rowStart + renderedRows.length || sourceRows.length < rowEnd) return;
    renderedRows.forEach((row, index) => { sourceRows[rowStart + index].outerHTML = row.outerHTML; });
    const style = table.getAttribute("style");
    if (style !== null) sourceTable.setAttribute("style", style);
    applyBlocks([...currentBlocks.slice(0, blockIndex), source.innerHTML, ...currentBlocks.slice(blockIndex + 1)]);
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const table = (event.target as HTMLElement).closest<HTMLTableElement>("table");
    if (!table) return;
    const bounds = table.getBoundingClientRect();
    const nearResizeHandle = event.clientX >= bounds.right - 18 && event.clientY >= bounds.bottom - 18;
    if (!nearResizeHandle) {
      resizingTable.current = null;
      resizeStart.current = null;
      return;
    }
    event.preventDefault();
    resizingTable.current = table;
    resizeStart.current = { table, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
    const move = (moveEvent: PointerEvent) => {
      const start = resizeStart.current;
      if (!start) return;
      moveEvent.preventDefault();
      start.table.style.width = `${Math.max(240, Math.round(start.width + moveEvent.clientX - start.x))}px`;
      start.table.style.height = `${Math.max(40, Math.round(start.height + moveEvent.clientY - start.y))}px`;
    };
    const up = () => {
      resizeCleanup.current?.();
      const resizedTable = resizingTable.current;
      resizingTable.current = null;
      resizeStart.current = null;
      if (!resizedTable) return;
      const resizedBounds = resizedTable.getBoundingClientRect();
      resizedTable.style.width = `${Math.round(resizedBounds.width)}px`;
      resizedTable.style.height = `${Math.round(resizedBounds.height)}px`;
      persistTable(resizedTable);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (resizeCleanup.current === cleanup) resizeCleanup.current = null;
    };
    resizeCleanup.current?.();
    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const updateDocument = (event?: FormEvent<HTMLDivElement>) => {
    if (isTableEdit(event)) {
      tableEditPending.current = true;
      return;
    }
    commitDocument();
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const table = editingTable(event);
    if (table && event.relatedTarget instanceof Node && table.contains(event.relatedTarget)) return;
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-template-placeholder]")) return;
    if (!tableEditPending.current) return;
    tableEditPending.current = false;
    if (table) persistTable(table);
    else commitDocument(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const table = editingTable(event);
    if (table) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const tableRange = document.createRange();
      tableRange.selectNode(table);
      const wholeTableSelected = range && range.compareBoundaryPoints(Range.START_TO_START, tableRange) === 0 && range.compareBoundaryPoints(Range.END_TO_END, tableRange) === 0;
      if ((event.key === "Backspace" || event.key === "Delete") && wholeTableSelected) {
        const fragment = table.closest<HTMLElement>("[data-template-fragment]");
        const tableIndex = Number(fragment?.dataset.blockIndex);
        if (Number.isInteger(tableIndex)) {
          event.preventDefault();
          tableSelection.current = null;
          pendingCaret.current = { blockIndex: Math.max(0, tableIndex - 1), position: tableIndex > 0 ? textLength(blocksRef.current[tableIndex - 1]) : 0 };
          applyBlocks(blocksRef.current.filter((_, index) => index !== tableIndex));
        }
      }
      return;
    }
    if (!["Enter", "Backspace", "Delete"].includes(event.key)) return;
    updateActiveSelection();
    const active = activeSelection.current;
    const block = blocksRef.current[active.blockIndex];
    if (block === undefined || isDynamicPageBreak(block)) return;
    event.preventDefault();
    if (event.key === "Enter") { replaceActiveSelection("\n"); return; }
    if (active.start !== active.end) { replaceActiveSelection(""); return; }
    if (event.key === "Backspace" && active.start > 0) {
      activeSelection.current = { ...active, start: active.start - 1 };
      replaceActiveSelection("");
      return;
    }
    if (event.key === "Delete" && active.end < textLength(block)) {
      activeSelection.current = { ...active, end: active.end + 1 };
      replaceActiveSelection("");
      return;
    }
    if (event.key === "Backspace" && active.start === 0 && active.blockIndex > 0) {
      const previous = blocksRef.current[active.blockIndex - 1];
      if (isDynamicPageBreak(previous) || /^<table\b/i.test(previous.trim())) return;
      event.preventDefault();
      const previousLength = textLength(previous);
      pendingCaret.current = { blockIndex: active.blockIndex - 1, position: previousLength };
      applyBlocks([
        ...blocksRef.current.slice(0, active.blockIndex - 1),
        `${previous}${block}`,
        ...blocksRef.current.slice(active.blockIndex + 1),
      ]);
      return;
    }
    if (event.key === "Delete" && active.end === textLength(block) && active.blockIndex < blocksRef.current.length - 1) {
      const next = blocksRef.current[active.blockIndex + 1];
      if (isDynamicPageBreak(next) || /^<table\b/i.test(next.trim())) return;
      event.preventDefault();
      pendingCaret.current = { blockIndex: active.blockIndex, position: textLength(block) };
      applyBlocks([
        ...blocksRef.current.slice(0, active.blockIndex),
        `${block}${next}`,
        ...blocksRef.current.slice(active.blockIndex + 2),
      ]);
    }
  };
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (isTableEdit(event)) return;
    event.preventDefault(); updateActiveSelection(); replaceActiveSelection(event.clipboardData.getData("text/plain"));
  };

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
    const rows = tableRows;
    const cols = tableCols;
    const active = activeSelection.current;

    const cellMarkup = Array(cols)
      .fill(null)
      .map(() => '<td contenteditable="true" spellcheck="true" style="border:1px solid #cbd5e1;padding:8px;min-width:120px;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word;outline:none;">Cell</td>')
      .join("");
    const tr = `<tr>${cellMarkup}</tr>`;
    const tbody = Array(rows)
      .fill(null)
      .map(() => tr)
      .join("");
    const table = `<table contenteditable="false" style="width:100%;border-collapse:collapse;table-layout:fixed;resize:both;overflow:auto;min-width:240px;">${tbody}</table>`;

    const block = blocksRef.current[active.blockIndex];
    if (block === undefined || isDynamicPageBreak(block)) return;
    const before = sliceHtml(block, 0, active.start);
    const after = sliceHtml(block, active.end, textLength(block));
    const tableIndex = active.blockIndex + (before ? 1 : 0);
    const nextBlocks = [
      ...blocksRef.current.slice(0, active.blockIndex),
      ...(before ? [before] : []),
      table,
      ...(after ? [after] : []),
      ...blocksRef.current.slice(active.blockIndex + 1),
    ];
    // Only create a caret-owning text block when the original content after
    // the insertion point actually exists. A trailing empty block creates
    // avoidable space below the table and is not part of the document.
    if (after) pendingCaret.current = { blockIndex: tableIndex + 1, position: 0 };
    applyBlocks(nextBlocks);
    setShowTableDialog(false);
    setTableRows(2);
    setTableCols(2);
    setHoveredRows(2);
    setHoveredCols(2);
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
      {toolbarButton("Undo", <Undo2 size={16} />, undoBlocks)}
      {toolbarButton("Redo", <Redo2 size={16} />, redoBlocks)}
      <button type="button" onClick={insertPageBreak} className="ml-auto rounded border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700">Insert Page Break</button>
    </div>
    <div ref={editor} contentEditable={true} tabIndex={0} role="textbox" aria-multiline="true" suppressContentEditableWarning onBeforeInput={updateActiveSelection} onInput={updateDocument} onBlur={handleBlur} onSelect={updateActiveSelection} onPointerDown={handlePointerDown} onKeyDown={handleKeyDown} onPaste={handlePaste} className="mx-auto flex min-w-0 w-fit flex-col gap-6 outline-none">
      {pages.map((page, pageIndex) => <div key={pageIndex} className="contents">
        {page.manualBreakBefore !== undefined && <div contentEditable={false} className="mx-auto flex w-[min(794px,calc(100vw-48px))] items-center gap-3 text-xs font-semibold tracking-widest text-brand-700 before:h-px before:flex-1 before:bg-brand-300 after:h-px after:flex-1 after:bg-brand-300"><span>PAGE BREAK</span><button type="button" onClick={() => removePageBreak(page.manualBreakBefore!)} className="rounded border border-brand-300 bg-white px-2 py-1 text-[10px] tracking-normal">Remove</button></div>}
        <section className="mx-auto flex h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-6 py-7 font-serif text-sm leading-relaxed text-slate-900 shadow-md sm:px-14">
          {pageIndex === 0 && <div contentEditable={false} className="border-b-2 border-brand-600 pb-4"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" /><div><p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p><p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline}</p></div></div><div className="font-sans text-[10px] text-blue-900"><p>{LETTER_BRANDING.website}</p><p>{LETTER_BRANDING.email}</p><p>{LETTER_BRANDING.phone}</p></div></div></div>}
          {pageIndex === 0 && <p contentEditable={false} className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>}
          <div className={`${pageIndex === 0 ? "h-780px" : "h-920px"} shrink-0 overflow-hidden`}>
            {page.fragments.map((fragment, fragmentIndex) => {
              const tableCaretBlock = !fragment.text && /^<table\b/i.test(blocks[fragment.blockIndex - 1]?.trim());
              const isTable = /^<table\b/i.test(fragment.text.trim());
              const hasFollowingContent = fragmentIndex < page.fragments.length - 1;
              return <div key={`${fragment.blockIndex}:${fragment.start}:${fragment.text.match(/data-table-row-start=\"(\d+)\"/)?.[1] ?? ""}`} data-template-fragment data-block-index={fragment.blockIndex} data-fragment-start={fragment.start} data-fragment-end={fragment.end} className={`w-full min-w-0 whitespace-pre-wrap wrap-break-words overflow-wrap-break outline-none [&_table]:min-w-60 [&_table]:resize [&_table]:overflow-auto ${hasFollowingContent && !isTable && !tableCaretBlock ? "mb-3" : ""}`} dangerouslySetInnerHTML={{ __html: fragment.text || "" }} />;
            })}
          </div>
          <footer contentEditable={false} className="mt-auto border-t border-ink-200 pt-2 text-center font-sans text-[10px] text-ink-400"><p>{LETTER_BRANDING.address}</p><p className="mt-1">Page {pageIndex + 1}</p></footer>
        </section>
      </div>)} 
    </div> 
    {showTableDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="rounded-lg bg-white p-6 shadow-lg max-w-sm w-full">
          <h3 className="mb-4 text-lg font-semibold">Insert Table</h3>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-ink-700">Rows
              <select value={tableRows} onChange={event => { const rows = Number(event.target.value); setTableRows(rows); setHoveredRows(rows); }} className="mt-1 block w-full rounded border border-ink-300 bg-white px-2 py-2">
                {Array.from({ length: 10 }, (_, index) => index + 1).map(rows => <option key={rows} value={rows}>{rows}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink-700">Columns
              <select value={tableCols} onChange={event => { const cols = Number(event.target.value); setTableCols(cols); setHoveredCols(cols); }} className="mt-1 block w-full rounded border border-ink-300 bg-white px-2 py-2">
                {Array.from({ length: 10 }, (_, index) => index + 1).map(cols => <option key={cols} value={cols}>{cols}</option>)}
              </select>
            </label>
          </div>
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
