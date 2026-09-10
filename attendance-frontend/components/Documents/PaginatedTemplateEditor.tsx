"use client";

import { ClipboardEvent, FocusEvent, FormEvent, forwardRef, KeyboardEvent, MutableRefObject, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link, Table2, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { LETTER_BRANDING } from "@/lib/letterBranding";
import { DYNAMIC_PAGE_BREAK, isDynamicPageBreak } from "@/lib/dynamicTemplateMarkers";

export interface PaginatedTemplateEditorHandle { insertPlaceholder: (token: string) => void; insertPageBreak: () => void; }
interface PaginatedTemplateEditorProps { value: string; onChange: (value: string) => void; title: string; }
export const PAGE_HEIGHT = 1120;
const FIRST_PAGE_CONTENT_HEIGHT = 780;
const OTHER_PAGE_CONTENT_HEIGHT = 920;
const TABLE_MIN_WIDTH_PX = 240;
const TABLE_MIN_HEIGHT_PX = 40;
const TABLE_COLUMN_MIN_WIDTH_PX = 48;
const TABLE_ROW_MIN_HEIGHT_PX = 24;
const TABLE_RESIZE_HANDLE_PX = 18;

export const splitDynamicTemplateBlocks = (value: string) => {
  const blocks: string[] = [];
  let text: string[] = [];
  const pushContentBlocks = (content: string) => {
    // A table must never enter the generic text slicing path below. That path
    // clones ancestor nodes for each page fragment, which creates partial table
    // DOM that browsers normalise differently on every edit.
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
    if (!block.textContent?.trim() && !block.children.length) {
      block.remove();
      return;
    }
    block.removeAttribute("data-template-editable-block");
    block.style.removeProperty("min-height");
    block.style.removeProperty("margin");
    const hasText = Boolean(block.textContent?.trim());
    const lastChild = block.lastChild;
    if (
      hasText &&
      lastChild &&
      lastChild.nodeType === Node.ELEMENT_NODE &&
      (lastChild as Element).nodeName === "BR"
    ) {
      lastChild.remove();
    }
  });
  const serialized = source.innerHTML;
  return serialized === "<p></p>" ? "" : serialized;
};
export const joinDynamicTemplateBlocks = (blocks: string[]) => blocks.map(stripEditorScaffolding).join("\n");
export type DynamicTemplateFragment = { blockIndex: number; start: number; end: number; text: string };
export type DynamicTemplatePage = { fragments: DynamicTemplateFragment[]; manualBreakBefore?: number };

export type DynamicPaginationGeometry = { pageWidth: number; horizontalPadding: number };
// Preview and PDF always render at 794px with px-14 (112px total horizontal
// padding). The editor must paginate with the same geometry so saved templates
// match downloaded page counts on every device.
export const A4_PAGINATION_GEOMETRY: DynamicPaginationGeometry = { pageWidth: 794, horizontalPadding: 112 };
const blockHeight = (text: string, geometry?: DynamicPaginationGeometry) => {
  const measure = document.createElement("div");
  const pageWidth = geometry?.pageWidth ?? Math.min(794, Math.max(240, window.innerWidth - 48));
  const horizontalPadding = geometry?.horizontalPadding ?? (window.innerWidth >= 640 ? 96 : 64);
  const contentWidth = Math.max(176, pageWidth - horizontalPadding);
  // The application-wide mobile guard sets `max-width: 100%` on every
  // element.  Explicitly opt this A4 measurement node out: otherwise Android
  // measures at the phone viewport width even when the requested geometry is
  // 794px and invents an extra page.
  measure.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;width:${contentWidth}px;max-width:none;border:0;padding:0;font:14px/1.625 Georgia, "Times New Roman", Times, serif;white-space:pre-wrap;overflow-wrap:anywhere;`;
  measure.innerHTML = text || " "; document.body.appendChild(measure);
  const height = Math.max(23, Math.ceil(measure.getBoundingClientRect().height) + 4); measure.remove(); return height;
};
const splitTableBlockHtml = (html: string) => {
  const trimmed = html.trim();
  if (!/^<table\b/i.test(trimmed)) return null;
  const match = html.match(/^(\s*<table\b[\s\S]*?<\/table>)([\s\S]*)$/i);
  if (!match) return null;
  return { table: match[1], trailing: stripEditorScaffolding(match[2]) };
};
const canonicalizeHtml = (html: string) => {
  const source = document.createElement("div");
  // A controlled-value echo has the serialized form (without temporary
  // caret nodes), while the live editor may still contain an anchor.
  source.innerHTML = stripEditorScaffolding(html);
  return source.innerHTML;
};
const sameBlocks = (left: string[], right: string[]) =>
  left.length === right.length && left.every((block, index) => canonicalizeHtml(block) === canonicalizeHtml(right[index]));
const logicalTextLength = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\u200B/g, "").length;
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).nodeName === "BR") return 1;
  return Array.from(node.childNodes).reduce((length, child) => length + logicalTextLength(child), 0);
};
const textLength = (html: string) => {
  const element = document.createElement("div");
  element.innerHTML = html;
  return logicalTextLength(element);
};
const textOffsetInContainer = (container: HTMLElement, node: Node, offset: number) => {
  const measure = (current: Node): number => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        return (current.textContent || "").slice(0, offset).replace(/\u200B/g, "").length;
      }
      return Array.from(current.childNodes).slice(0, offset).reduce((length, child) => length + logicalTextLength(child), 0);
    }
    if (current.nodeType === Node.TEXT_NODE || (current.nodeType === Node.ELEMENT_NODE && (current as Element).nodeName === "BR")) {
      return logicalTextLength(current);
    }
    let total = 0;
    for (const child of current.childNodes) {
      if (child === node || child.contains(node)) return total + measure(child);
      total += logicalTextLength(child);
    }
    return total;
  };
  return measure(container);
};
const sliceHtml = (html: string, start: number, end: number) => {
  const source = document.createElement("div");
  source.innerHTML = html;
  let position = 0;
  const copy = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "";
      let logicalPosition = position;
      let copied = "";
      for (const character of value) {
        if (character === "\u200B") continue;
        if (logicalPosition >= start && logicalPosition < end) copied += character;
        logicalPosition += 1;
      }
      position = logicalPosition;
      return copied ? document.createTextNode(copied) : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.nodeName === "BR") {
      const included = position >= start && position < end;
      position += 1;
      return included ? node.cloneNode(false) : null;
    }
    const element = node.cloneNode(false) as HTMLElement;
    node.childNodes.forEach(child => { const copied = copy(child); if (copied) element.appendChild(copied); });
    return element.childNodes.length ? element : null;
  };
  const result = document.createElement("div");
  source.childNodes.forEach(node => { const copied = copy(node); if (copied) result.appendChild(copied); });
  return result.innerHTML;
};
const caretOffsetInTextNode = (value: string, logicalOffset: number) => {
  let logical = 0;
  let rawOffset = 0;
  while (rawOffset < value.length && logical < logicalOffset) {
    if (value[rawOffset] !== "\u200B") logical += 1;
    rawOffset += 1;
  }
  while (rawOffset < value.length && value[rawOffset] === "\u200B") rawOffset += 1;
  return rawOffset;
};
const caretTargetAtLogicalOffset = (container: HTMLElement, target: number) => {
  let position = 0;
  let previousWasBreak = false;
  let fallback: { node: Text; offset: number } | null = null;
  const visit = (node: Node): { node: Text; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const length = logicalTextLength(node);
      fallback = { node: node as Text, offset: text.length };
      if (target >= position && target <= position + length && (target < position + length || target === position && previousWasBreak || length === 0)) {
        return { node: node as Text, offset: caretOffsetInTextNode(text, target - position) };
      }
      position += length;
      previousWasBreak = false;
      return null;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).nodeName === "BR") {
      position += 1;
      previousWasBreak = true;
      return null;
    }
    for (const child of node.childNodes) {
      const result = visit(child);
      if (result) return result;
    }
    return null;
  };
  return visit(container) ?? fallback;
};
const isEmptyEditableParagraph = (paragraph: HTMLElement) => {
  const text = paragraph.textContent?.replace(/\u200B/g, "") ?? "";
  if (text.trim()) return false;
  if (!paragraph.childNodes.length) return true;
  return Array.from(paragraph.childNodes).every(node =>
    node.nodeType === Node.ELEMENT_NODE && (node as Element).nodeName === "BR"
  );
};
const restoreCaretInFragment = (
  fragment: HTMLElement,
  localPosition: number,
  caret: { blockIndex: number; position: number },
  activeSelectionRef: MutableRefObject<{
    blockIndex: number;
    start: number;
    end: number;
    fragmentStart: number;
    fragmentEnd: number;
  }>,
  pendingCaretRef: MutableRefObject<{
    blockIndex: number;
    position: number;
  } | null>,
) => {
  const paragraph = fragment.querySelector<HTMLElement>("p") ?? fragment;

  const selection = window.getSelection();
  if (!selection) return;

  /*
   * Empty fragment created by Enter.
   *
   * Do not try to calculate a text-node offset here.
   * Give the browser an actual editable paragraph and place the
   * selection directly inside that paragraph.
   */
  if (localPosition === 0 && isEmptyEditableParagraph(paragraph)) {
    paragraph.focus({ preventScroll: true });

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    activeSelectionRef.current = {
      blockIndex: caret.blockIndex,
      start: caret.position,
      end: caret.position,
      fragmentStart: Number(
        fragment.dataset.fragmentStart ?? 0,
      ),
      fragmentEnd: Number(
        fragment.dataset.fragmentEnd ?? 0,
      ),
    };
    pendingCaretRef.current = null;
    return;
  }

  const target = caretTargetAtLogicalOffset(
    fragment,
    localPosition,
  );

  if (!target) {
    pendingCaretRef.current = null;
    return;
  }

  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);

  /*
   * Focus the actual editing host first, then install the range.
   * This is important because the fragment is inside the
   * contentEditable={false} outer editor.
   */
  fragment.focus({ preventScroll: true });

  selection.removeAllRanges();
  selection.addRange(range);

  activeSelectionRef.current = {
    blockIndex: caret.blockIndex,
    start: caret.position,
    end: caret.position,
    fragmentStart: Number(
      fragment.dataset.fragmentStart ?? 0,
    ),
    fragmentEnd: Number(
      fragment.dataset.fragmentEnd ?? 0,
    ),
  };
  pendingCaretRef.current = null;
};
const fragmentForHeight = (html: string, maxHeight: number, geometry?: DynamicPaginationGeometry) => {
  const length = textLength(html);
  if (blockHeight(html, geometry) <= maxHeight) return length;
  let low = 1; let high = length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (blockHeight(sliceHtml(html, 0, middle), geometry) <= maxHeight) low = middle; else high = middle - 1; }
  return low;
};

const runEditorCommand = (command: string, value?: string) => {
  document.execCommand(command, false, value);
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
        page.fragments.push({ blockIndex, start: 0, end: textLength(block), text: tableFragment.html });
        used += height;
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
      const gap = isCaretAfterTable ? 0 : (page.fragments.length ? 12 : 0);
      const height = isCaretAfterTable ? 0 : blockHeight("", geometry);
      if (!isCaretAfterTable && used + gap + height > limit) { pages.push({ fragments: [] }); used = 0; }
      const target = pages[pages.length - 1];
      // The empty logical block is rendered as a real editable paragraph below.
      // Keep it in the page even when it has no measurable text height.
      target.fragments.push({ blockIndex, start: 0, end: 0, text: "" });
      used += gap + height;
      return;
    }
    let start = 0;
    do {
      const page = pages[pages.length - 1]; const limit = pages.length === 1 ? FIRST_PAGE_CONTENT_HEIGHT : OTHER_PAGE_CONTENT_HEIGHT;
      const gap = page.fragments.length ? 12 : 0; const remaining = limit - used - gap;
      if (remaining < 23) { pages.push({ fragments: [] }); used = 0; continue; }
      const end = start + fragmentForHeight(sliceHtml(block, start, blockLength), remaining, geometry); const text = sliceHtml(block, start, end);
      page.fragments.push({ blockIndex, start, end, text }); used += gap + blockHeight(text, geometry); start = end;
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
  const resizeStart = useRef<{ table: HTMLTableElement; x: number; y: number; width: number; height: number; logicalHeight: number; columnWidths: number[]; rowHeights: number[] } | null>(null);
  const rowResizeStart = useRef<{ table: HTMLTableElement; rowIndex: number; y: number; heights: number[] } | null>(null);
  const columnResizeStart = useRef<{ table: HTMLTableElement; colIndex: number; x: number; widths: number[] } | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const pendingCaret = useRef<{ blockIndex: number; position: number } | null>(null);
  const pendingTableCaret = useRef<{ blockIndex: number; rowIndex: number; cellIndex: number; position: number } | null>(null);
  const tableEditPending = useRef(false);
  const editor = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const next = splitDynamicTemplateBlocks(value);
    // onInput serializes the live DOM before notifying the parent. Ignore that
    // matching controlled-value echo so React does not replace the active
    // contentEditable fragment between keystrokes.
    if (sameBlocks(blocksRef.current, next)) return;
    setBlocks(current => sameBlocks(current, next) ? current : next);
    blocksRef.current = next;
  }, [value]);
  useLayoutEffect(() => { blocksRef.current = blocks; }, [blocks]);
  const pages = useMemo(() => paginateDynamicTemplateBlocks(blocks, A4_PAGINATION_GEOMETRY), [blocks]);
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (!editor.current) return;
    if (!caret) {
      const tableCaret = pendingTableCaret.current;
      if (!tableCaret) return;
      const fragment = Array.from(editor.current.querySelectorAll<HTMLElement>(`[data-block-index="${tableCaret.blockIndex}"]`)).find(element => {
        const table = element.querySelector<HTMLTableElement>("table");
        const start = Number(table?.dataset.tableRowStart ?? -1);
        const end = Number(table?.dataset.tableRowEnd ?? -1);
        return start <= tableCaret.rowIndex && tableCaret.rowIndex < end;
      });
      const table = fragment?.querySelector<HTMLTableElement>("table");
      const rowStart = Number(table?.dataset.tableRowStart ?? 0);
      const cell = table?.rows[tableCaret.rowIndex - rowStart]?.cells[tableCaret.cellIndex];
      if (!cell) return;
      const target = caretTargetAtLogicalOffset(cell, tableCaret.position);
      const textNode = target?.node ?? document.createTextNode("");
      if (!target) cell.appendChild(textNode);
      const range = document.createRange();
      range.setStart(textNode, target?.offset ?? 0);
      range.collapse(true);
      cell.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      tableSelection.current = range.cloneRange();
      pendingTableCaret.current = null;
      return;
    }
    const fragments = Array.from(editor.current.querySelectorAll<HTMLElement>(`[data-block-index="${caret.blockIndex}"]`));
    const blockLength = textLength(blocksRef.current[caret.blockIndex] ?? "");
    const fragment = fragments.find(element => {
      const fragmentStart = Number(element.dataset.fragmentStart ?? 0);
      const fragmentEnd = Number(element.dataset.fragmentEnd ?? 0);

      // Exact empty fragment: this is the important Enter case.
      if (
        caret.position === fragmentStart &&
        caret.position === fragmentEnd
      ) {
        return true;
      }

      // Normal fragment containing the caret.
      if (
        caret.position >= fragmentStart &&
        caret.position < fragmentEnd
      ) {
        return true;
      }

      // Caret at the very end of the block.
      return (
        caret.position === blockLength &&
        fragmentEnd === caret.position
      );
    });
    if (!fragment) return;
    // This runs after React has committed the replacement blocks but before
    // the browser paints. Restoring in requestAnimationFrame left one frame in
    // which contentEditable could discard the selection in a new empty <p>.
    restoreCaretInFragment(
      fragment,
      caret.position - Number(fragment.dataset.fragmentStart ?? 0),
      caret,
      activeSelection,
      pendingCaret,
    );
  }, [pages]);
  const updateActiveSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return;
    }
    const range = selection.getRangeAt(0);
    const findFragment = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-template-fragment]");
    const startElement = findFragment(range.startContainer); const endElement = findFragment(range.endContainer);
    if (!startElement || !endElement || startElement.dataset.blockIndex !== endElement.dataset.blockIndex) {
      return;
    }
    const findTableCell = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("td, th");
    const startCell = findTableCell(range.startContainer); const endCell = findTableCell(range.endContainer);
    tableSelection.current = startCell && startCell === endCell ? range.cloneRange() : null;
    const blockIndex = Number(startElement.dataset.blockIndex); const fragmentStart = Number(startElement.dataset.fragmentStart);
    activeSelection.current = {
      blockIndex,
      start: fragmentStart + textOffsetInContainer(startElement, range.startContainer, range.startOffset),
      end: Number(endElement.dataset.fragmentStart) + textOffsetInContainer(endElement, range.endContainer, range.endOffset),
      fragmentStart,
      fragmentEnd: Number(startElement.dataset.fragmentEnd),
    };
  };
  const applyBlocks = (next: string[], render = true, notifyParent = render) => {
    const normalized = next.length ? next : [""];
    const current = blocksRef.current;
    if (sameBlocks(current, normalized)) return;
    historyRef.current.past.push(current);
    if (historyRef.current.past.length > 100) historyRef.current.past.shift();
    historyRef.current.future = [];
    blocksRef.current = normalized;
    if (render) setBlocks(normalized);
    if (notifyParent) {
      const serialized = joinDynamicTemplateBlocks(normalized);
      onChange(serialized);
    }
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
  const renderedFragmentTailStart = (active: typeof activeSelection.current, block: string) => {
    if (!editor.current) return textLength(block);
    const current = editor.current.querySelector<HTMLElement>(`[data-block-index="${active.blockIndex}"][data-fragment-start="${active.fragmentStart}"]`);
    if (!current) return textLength(block);
    const fragments = Array.from(editor.current.querySelectorAll<HTMLElement>("[data-template-fragment]"))
      .filter(fragment => Number(fragment.dataset.blockIndex) === active.blockIndex);
    return fragments[fragments.length - 1] === current ? textLength(block) : active.fragmentEnd;
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
      const row = tableCell.parentElement as HTMLTableRowElement;
      pendingTableCaret.current = {
        blockIndex: Number(tableFragment.dataset.blockIndex),
        rowIndex: Number(table.dataset.tableRowStart ?? 0) + Array.from(table.rows).indexOf(row),
        cellIndex: Array.from(row.cells).indexOf(tableCell as HTMLTableCellElement),
        position: textOffsetInContainer(tableCell, range.startContainer, range.startOffset),
      };
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
    // Selection offsets are logical text offsets, not offsets in the HTML
    // string.  Slicing the raw markup can cut through a table, placeholder,
    // or formatting tag and corrupt the document around the page break.
    const parts = [
      sliceHtml(block, 0, active.start),
      DYNAMIC_PAGE_BREAK,
      sliceHtml(block, active.end, textLength(block)),
    ].filter((part, index) => part || index === 1);
    applyBlocks([...blocksRef.current.slice(0, active.blockIndex), ...parts, ...blocksRef.current.slice(active.blockIndex + 1)]);
    requestAnimationFrame(() => editor.current?.focus());
  };
  const removePageBreak = (blockIndex: number) => applyBlocks(blocksRef.current.filter((_, index) => index !== blockIndex));
  const insertPlaceholder = (replacement: string) => {
    // Re-read the browser selection immediately before a toolbar insertion.
    // This keeps the selected table cell authoritative even if focus changed.
    updateActiveSelection();
    replaceActiveSelection(replacement);
  };
  useImperativeHandle(ref, () => ({ insertPlaceholder, insertPageBreak }));
  const commitDocument = (restoreCaret = true, render = true, notifyParent = render) => {
    if (!editor.current) return;
    const active = activeSelection.current;
    const fragment = editor.current.querySelector<HTMLElement>(`[data-block-index="${active.blockIndex}"][data-fragment-start="${active.fragmentStart}"]`);
    const block = blocksRef.current[active.blockIndex];
    if (!fragment || block === undefined) return;
    let nextFragmentText = stripEditorScaffolding(fragment.innerHTML);
    const tableSplit = splitTableBlockHtml(nextFragmentText);
    if (tableSplit?.trailing) {
      const nextBlockIndex = active.blockIndex + 1;
      const nextBlock = blocksRef.current[nextBlockIndex] ?? "";
      const trailingWrapped = /^<(p|div|h[1-6]|ul|ol|blockquote)\b/i.test(tableSplit.trailing.trim())
        ? tableSplit.trailing
        : `<p>${tableSplit.trailing}</p>`;
      const mergedNext = `${trailingWrapped}${nextBlock}`;
      if (render && restoreCaret) {
        pendingCaret.current = { blockIndex: nextBlockIndex, position: textLength(trailingWrapped) };
      }
      applyBlocks([
        ...blocksRef.current.slice(0, active.blockIndex),
        tableSplit.table,
        ...splitDynamicTemplateBlocks(mergedNext),
        ...blocksRef.current.slice(nextBlockIndex + 1),
      ], render, notifyParent);
      return;
    }
    if (tableSplit) nextFragmentText = tableSplit.table;
    const previousFragmentLength = active.fragmentEnd - active.fragmentStart;
    const selectedLength = active.end - active.start;
    const insertedLength = textLength(nextFragmentText) - (previousFragmentLength - selectedLength);
    const tailStart = renderedFragmentTailStart(active, block);
    const nextValue = `${sliceHtml(block, 0, active.fragmentStart)}${nextFragmentText}${sliceHtml(block, tailStart, textLength(block))}`;
    if (render && restoreCaret) {
      pendingCaret.current = { blockIndex: active.blockIndex, position: active.start + insertedLength };
    }
    applyBlocks([...blocksRef.current.slice(0, active.blockIndex), ...splitDynamicTemplateBlocks(nextValue), ...blocksRef.current.slice(active.blockIndex + 1)], render, notifyParent);
    // Native typing keeps this DOM fragment mounted between input events. Its
    // data-fragment-end came from the pre-input render, so keep the in-memory
    // boundary in sync with the serialized fragment before the next key.
    activeSelection.current = {
      ...active,
      fragmentEnd: active.fragmentStart + textLength(nextFragmentText),
    };
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
  const persistTable = (table: HTMLTableElement, resize?: { columnWidths?: number[]; heightScale?: number }) => {
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
    const sourceRowHeights = sourceRows.map(row => Number.parseFloat(row.style.height) || TABLE_ROW_MIN_HEIGHT_PX);
    // A paginated table edit is valid only when it maps to the exact source
    // row range that pagination rendered. Never replace the source table with
    // a page-local fragment when that mapping is unavailable or inconsistent.
    if (!Number.isInteger(rowStart) || !Number.isInteger(rowEnd) || rowStart < 0 || rowEnd !== rowStart + renderedRows.length || sourceRows.length < rowEnd) return;
    renderedRows.forEach((row, index) => { sourceRows[rowStart + index].outerHTML = row.outerHTML; });
    if (resize?.columnWidths) {
      sourceRows.forEach(row => Array.from(row.cells).forEach((cell, index) => {
        const width = resize.columnWidths?.[index];
        if (width) cell.style.width = `${Math.max(TABLE_COLUMN_MIN_WIDTH_PX, Math.round(width))}px`;
      }));
    }
    if (resize?.heightScale) {
      sourceRows.forEach((row, index) => {
        row.style.height = `${Math.max(TABLE_ROW_MIN_HEIGHT_PX, Math.round(sourceRowHeights[index] * resize.heightScale!))}px`;
      });
    }
    const style = table.getAttribute("style");
    if (style !== null) {
      sourceTable.setAttribute("style", style);
      // applyTableSize records the requested height on rows, which stays
      // correct when the table is split across pages.  A table-level height
      // would instead be applied again to every visual fragment.
      sourceTable.style.removeProperty("height");
    }
    applyBlocks([...currentBlocks.slice(0, blockIndex), source.innerHTML, ...currentBlocks.slice(blockIndex + 1)]);
  };
  const tableColumnWidths = (table: HTMLTableElement) => {
    const firstRow = table.rows[0];
    if (!firstRow) return [];
    return Array.from(firstRow.cells).map(cell => cell.getBoundingClientRect().width);
  };
  const tableRowHeights = (table: HTMLTableElement) => Array.from(table.rows).map(row => row.getBoundingClientRect().height);
  const logicalTableHeight = (table: HTMLTableElement) => {
    const fragment = table.closest<HTMLElement>("[data-template-fragment]");
    const blockIndex = Number(fragment?.dataset.blockIndex);
    const currentBlock = blocksRef.current[blockIndex];
    if (!Number.isInteger(blockIndex) || currentBlock === undefined) return tableRowHeights(table).reduce((total, height) => total + height, 0);
    const source = document.createElement("div");
    source.innerHTML = currentBlock;
    const tableIndex = Array.from(fragment?.querySelectorAll("table") ?? []).indexOf(table);
    const sourceTable = source.querySelectorAll("table")[tableIndex];
    if (!sourceTable) return tableRowHeights(table).reduce((total, height) => total + height, 0);
    return Math.max(TABLE_MIN_HEIGHT_PX, Array.from(sourceTable.rows).reduce((total, row) => total + (Number.parseFloat(row.style.height) || TABLE_ROW_MIN_HEIGHT_PX), 0));
  };
  const applyTableColumnWidths = (table: HTMLTableElement, widths: number[]) => {
    Array.from(table.rows).forEach(row => {
      Array.from(row.cells).forEach((cell, index) => {
        if (widths[index]) cell.style.width = `${Math.max(TABLE_COLUMN_MIN_WIDTH_PX, Math.round(widths[index]))}px`;
      });
    });
  };
  const applyTableRowHeights = (table: HTMLTableElement, heights: number[]) => {
    Array.from(table.rows).forEach((row, index) => {
      if (heights[index]) row.style.height = `${Math.max(TABLE_ROW_MIN_HEIGHT_PX, Math.round(heights[index]))}px`;
    });
  };
  const applyTableSize = (
    table: HTMLTableElement,
    nextWidth: number,
    nextHeight: number,
    baseWidth: number,
    baseHeight: number,
    baseColumnWidths: number[],
    baseRowHeights: number[],
  ) => {
    const width = Math.max(TABLE_MIN_WIDTH_PX, Math.round(nextWidth));
    const height = Math.max(TABLE_MIN_HEIGHT_PX, Math.round(nextHeight));
    const widthScale = baseWidth > 0 ? width / baseWidth : 1;
    const heightScale = baseHeight > 0 ? height / baseHeight : 1;
    applyTableColumnWidths(
      table,
      baseColumnWidths.map(columnWidth => Math.max(TABLE_COLUMN_MIN_WIDTH_PX, Math.round(columnWidth * widthScale))),
    );
    applyTableRowHeights(
      table,
      baseRowHeights.map(rowHeight => Math.max(TABLE_ROW_MIN_HEIGHT_PX, Math.round(rowHeight * heightScale))),
    );
    table.style.width = `${width}px`;
    table.style.height = `${height}px`;
  };
  const columnResizeTarget = (event: React.PointerEvent<HTMLDivElement>, table: HTMLTableElement) => {
    const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>("td, th");
    if (!cell || !table.contains(cell)) return null;
    const bounds = cell.getBoundingClientRect();
    if (event.clientX < bounds.right - 8) return null;
    const row = cell.parentElement as HTMLTableRowElement;
    const colIndex = Array.from(row.cells).indexOf(cell);
    if (colIndex < 0) return null;
    return { table, colIndex };
  };
  const rowResizeTarget = (event: React.PointerEvent<HTMLDivElement>, table: HTMLTableElement) => {
    const row = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr");
    if (!row || !table.contains(row)) return null;
    const bounds = row.getBoundingClientRect();
    if (event.clientY < bounds.bottom - 8 || event.clientY > bounds.bottom + 8) return null;
    const rowIndex = Array.from(table.rows).indexOf(row);
    return rowIndex >= 0 && rowIndex < table.rows.length - 1 ? { table, rowIndex } : null;
  };
  const tableEdgeResizeTarget = (event: React.PointerEvent<HTMLDivElement>, table: HTMLTableElement) => {
    const bounds = table.getBoundingClientRect();
    const nearRight = event.clientX >= bounds.right - TABLE_RESIZE_HANDLE_PX;
    const nearBottom = event.clientY >= bounds.bottom - TABLE_RESIZE_HANDLE_PX;
    const nearLeft = event.clientX <= bounds.left + TABLE_RESIZE_HANDLE_PX;
    if (nearRight && nearBottom) return { axis: "both" as const, direction: 1 };
    if (nearRight && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return { axis: "width" as const, direction: 1 };
    if (nearLeft && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return { axis: "width" as const, direction: -1 };
    if (nearBottom && event.clientX >= bounds.left && event.clientX <= bounds.right) return { axis: "height" as const, direction: 1 };
    return null;
  };
  const setResizeSelection = (disabled: boolean) => {
    document.body.style.userSelect = disabled ? "none" : "";
  };
  const beginPointerDrag = (move: (event: PointerEvent) => void, up: (event: PointerEvent) => void) => {
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
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const table = target.closest<HTMLTableElement>("table");
    if (table) {
      const edgeTarget = tableEdgeResizeTarget(event, table);
      if (edgeTarget) {
        event.preventDefault();
        setResizeSelection(true);
        document.body.style.cursor = edgeTarget.axis === "width" ? "ew-resize" : edgeTarget.axis === "height" ? "ns-resize" : "nwse-resize";
        const bounds = table.getBoundingClientRect();
        const start = {
          table,
          x: event.clientX,
          y: event.clientY,
          width: bounds.width,
          height: bounds.height,
          logicalHeight: logicalTableHeight(table),
          columnWidths: tableColumnWidths(table),
          rowHeights: tableRowHeights(table),
        };
        resizeStart.current = start;
        const move = (moveEvent: PointerEvent) => {
          if (!resizeStart.current) return;
          moveEvent.preventDefault();
          applyTableSize(
            table,
            start.width + (edgeTarget.axis === "width" || edgeTarget.axis === "both" ? edgeTarget.direction * (moveEvent.clientX - start.x) : 0),
            start.height + (edgeTarget.axis === "height" || edgeTarget.axis === "both" ? edgeTarget.direction * (moveEvent.clientY - start.y) : 0),
            start.width,
            start.height,
            start.columnWidths,
            start.rowHeights,
          );
        };
        const up = (upEvent: PointerEvent) => {
          resizeCleanup.current?.();
          document.body.style.cursor = "";
          setResizeSelection(false);
          resizeStart.current = null;
          const heightDelta = edgeTarget.axis === "height" || edgeTarget.axis === "both"
            ? edgeTarget.direction * (upEvent.clientY - start.y)
            : 0;
          const logicalHeight = Math.max(TABLE_MIN_HEIGHT_PX, start.logicalHeight + heightDelta);
          persistTable(table, {
            columnWidths: edgeTarget.axis === "width" || edgeTarget.axis === "both" ? tableColumnWidths(table) : undefined,
            heightScale: edgeTarget.axis === "height" || edgeTarget.axis === "both" ? logicalHeight / start.logicalHeight : undefined,
          });
        };
        beginPointerDrag(move, up);
        return;
      }
      const columnTarget = columnResizeTarget(event, table);
      if (columnTarget) {
        event.preventDefault();
        setResizeSelection(true);
        document.body.style.cursor = "col-resize";
        columnResizeStart.current = {
          table,
          colIndex: columnTarget.colIndex,
          x: event.clientX,
          widths: tableColumnWidths(table),
        };
        const move = (moveEvent: PointerEvent) => {
          const start = columnResizeStart.current;
          if (!start) return;
          moveEvent.preventDefault();
          const nextWidths = [...start.widths];
          nextWidths[start.colIndex] = Math.max(TABLE_COLUMN_MIN_WIDTH_PX, Math.round(start.widths[start.colIndex] + moveEvent.clientX - start.x));
          applyTableColumnWidths(start.table, nextWidths);
        };
        const up = () => {
          resizeCleanup.current?.();
          document.body.style.cursor = "";
          setResizeSelection(false);
          const resizedTable = columnResizeStart.current?.table;
          columnResizeStart.current = null;
          if (resizedTable) persistTable(resizedTable, { columnWidths: tableColumnWidths(resizedTable) });
        };
        beginPointerDrag(move, up);
        return;
      }
      const rowTarget = rowResizeTarget(event, table);
      if (rowTarget) {
        event.preventDefault();
        setResizeSelection(true);
        document.body.style.cursor = "ns-resize";
        rowResizeStart.current = {
          table,
          rowIndex: rowTarget.rowIndex,
          y: event.clientY,
          heights: tableRowHeights(table),
        };
        const move = (moveEvent: PointerEvent) => {
          const start = rowResizeStart.current;
          if (!start) return;
          moveEvent.preventDefault();
          const heights = [...start.heights];
          heights[start.rowIndex] = Math.max(TABLE_ROW_MIN_HEIGHT_PX, Math.round(start.heights[start.rowIndex] + moveEvent.clientY - start.y));
          applyTableRowHeights(start.table, heights);
        };
        const up = () => {
          resizeCleanup.current?.();
          document.body.style.cursor = "";
          setResizeSelection(false);
          const resizedTable = rowResizeStart.current?.table;
          rowResizeStart.current = null;
          if (resizedTable) persistTable(resizedTable);
        };
        beginPointerDrag(move, up);
        return;
      }
    }
  };
  const handleEditableFragmentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handleKeyDown(event);
    event.stopPropagation();
  };
  const updateDocument = (event?: FormEvent<HTMLDivElement>) => {
    if (isTableEdit(event)) {
      tableEditPending.current = true;
      return;
    }
    // onInput fires after the browser moves the caret. Reading that live range
    // is required before serializing; otherwise the first character typed
    // after Enter is committed using Enter's old (zero-length) caret range.
    updateActiveSelection();
    // Keep native typing in the live fragment. Serialization still happens,
    // but defer both React re-render and parent onChange so dangerouslySetInnerHTML
    // does not reset the active fragment mid-keystroke.
    commitDocument(false, false, false);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (pendingCaret.current) return;
    const table = editingTable(event);
    if (table && event.relatedTarget instanceof Node && table.contains(event.relatedTarget)) return;
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-template-placeholder]")) return;
    if (tableEditPending.current) {
      tableEditPending.current = false;
      if (table) persistTable(table);
      else commitDocument(false, false, true);
      setBlocks(blocksRef.current);
      return;
    }
    commitDocument(false, false, true);
    setBlocks(blocksRef.current);
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
    if (event.key === "Enter") {
      const selection = window.getSelection();
      let splitStart = active.start;
      let splitEnd = active.end;
      if (selection?.rangeCount && selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const findFragment = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-template-fragment]");
        const fragment = findFragment(range.startContainer);
        if (fragment) {
          const fragmentStart = Number(fragment.dataset.fragmentStart ?? 0);
          splitStart = splitEnd = fragmentStart + textOffsetInContainer(fragment, range.startContainer, range.startOffset);
        }
      }
      const before = sliceHtml(block, 0, splitStart);
      const after = sliceHtml(block, splitEnd, textLength(block));
      if (!before && !after && textLength(block) === 0) {
        pendingCaret.current = { blockIndex: active.blockIndex + 1, position: 0 };
        applyBlocks([
          ...blocksRef.current.slice(0, active.blockIndex + 1),
          "",
          ...blocksRef.current.slice(active.blockIndex + 1),
        ]);
        return;
      }
      // Keep each line in its own logical block. Keeping the synthetic line
      // break inside one paginated fragment caused the browser to restore the
      // caret above the previous line after a table.
      const beforeBlocks = before ? splitDynamicTemplateBlocks(before) : [""];
      const afterBlocks = after ? splitDynamicTemplateBlocks(after) : [""];
      const nextCaretBlock = active.blockIndex + beforeBlocks.length;
      pendingCaret.current = {
        blockIndex: nextCaretBlock,
        position: 0,
      };
      applyBlocks([
        ...blocksRef.current.slice(0, active.blockIndex),
        ...beforeBlocks,
        ...afterBlocks,
        ...blocksRef.current.slice(active.blockIndex + 1),
      ]);
      return;
    }
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
      if (isDynamicPageBreak(previous) || /^<table\b/i.test(previous.trim())) {
        return;
      }
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
      if (isDynamicPageBreak(next) || /^<table\b/i.test(next.trim())) {
        return;
      }
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
    updateActiveSelection();
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
    const table = `<table contenteditable="false" style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:${TABLE_MIN_WIDTH_PX}px;margin:0;">${tbody}</table>`;

    const block = blocksRef.current[active.blockIndex];
    if (block === undefined || isDynamicPageBreak(block)) return;
    const before = sliceHtml(block, 0, active.start);
    const after = sliceHtml(block, active.end, textLength(block));
    const afterIsUntouchedCaretLine = /^<p>\s*<br\s*\/?\s*>\s*<\/p>$/i.test(after.trim());
    const trailingContent = afterIsUntouchedCaretLine ? "" : after;
    const tableIndex = active.blockIndex + (before ? 1 : 0);
    const followingBlocks = blocksRef.current.slice(active.blockIndex + 1);
    const followingBlock = followingBlocks[0];
    const needsFollowingEditableBlock = !trailingContent && (
      followingBlock === undefined ||
      isDynamicPageBreak(followingBlock) ||
      /^<table\b/i.test(followingBlock.trim())
    );
    const nextBlocks = [
      ...blocksRef.current.slice(0, active.blockIndex),
      ...(before ? [before] : []),
      table,
      ...(trailingContent ? [trailingContent] : (needsFollowingEditableBlock ? [""] : [])),
      ...followingBlocks,
    ];
    const followingIndex = tableIndex + 1;
    pendingCaret.current = { blockIndex: followingIndex, position: 0 };
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
    <div ref={editor} contentEditable={false} tabIndex={0} role="group" aria-label={title} onBeforeInput={updateActiveSelection} onInput={updateDocument} onBlur={handleBlur} onSelect={updateActiveSelection} onPointerDown={handlePointerDown} onKeyDown={handleKeyDown} onPaste={handlePaste} className="mx-auto flex min-w-0 w-fit flex-col gap-6 outline-none [&_table_td]:hover:shadow-[inset_-3px_0_0_0_rgba(59,130,246,0.35)] [&_table_th]:hover:shadow-[inset_-3px_0_0_0_rgba(59,130,246,0.35)]">
      {pages.map((page, pageIndex) => <div key={pageIndex} className="contents">
        {page.manualBreakBefore !== undefined && <div contentEditable={false} className="mx-auto flex w-[min(794px,calc(100vw-48px))] items-center gap-3 text-xs font-semibold tracking-widest text-brand-700 before:h-px before:flex-1 before:bg-brand-300 after:h-px after:flex-1 after:bg-brand-300"><span>PAGE BREAK</span><button type="button" onClick={() => removePageBreak(page.manualBreakBefore!)} className="rounded border border-brand-300 bg-white px-2 py-1 text-[10px] tracking-normal">Remove</button></div>}
        <section style={{ fontFamily: 'Georgia, "Times New Roman", Times, serif' }} className="mx-auto flex h-1120px w-[min(794px,calc(100vw-48px))] flex-col bg-white px-14 py-7 text-sm leading-relaxed text-slate-900 shadow-md">
          {pageIndex === 0 && <div contentEditable={false} className="border-b-2 border-brand-600 pb-4"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><img src={LETTER_BRANDING.logoUrl} alt="PropCheckup logo" className="h-12 w-12 object-contain" /><div><p className="font-sans text-lg font-bold text-slate-900">{LETTER_BRANDING.companyName}</p><p className="font-sans text-[10px] font-semibold text-brand-700">{LETTER_BRANDING.tagline.split(" ").map((word, wordIndex, words) => <span key={`${word}-${wordIndex}`} className={wordIndex < words.length - 1 ? "mr-1 inline-block" : "inline-block"}>{word}</span>)}</p></div></div><div className="font-sans text-[10px] text-blue-900"><p>{LETTER_BRANDING.website}</p><p>{LETTER_BRANDING.email}</p><p>{LETTER_BRANDING.phone}</p></div></div></div>}
          {pageIndex === 0 && <p contentEditable={false} className="mb-4 mt-4 text-center font-sans text-lg font-bold uppercase tracking-wide">{title}</p>}
          <div className={`${pageIndex === 0 ? "h-780px" : "h-920px"} shrink-0 overflow-hidden`}>
            {page.fragments.map((fragment, fragmentIndex) => {
              const isTable = /^<table\b/i.test(fragment.text.trim());
              const hasFollowingContent = fragmentIndex < page.fragments.length - 1;
              const previousFragment = page.fragments[fragmentIndex - 1]?.text.trim() ?? "";
              const nextFragment = page.fragments[fragmentIndex + 1]?.text.trim() ?? "";
              const adjacentToTable = /^<table\b/i.test(previousFragment) || /^<table\b/i.test(nextFragment);
              const addParagraphSpacing = hasFollowingContent && !isTable && !adjacentToTable;
              const fragmentClass = `w-full min-w-0 whitespace-pre-wrap wrap-break-words overflow-wrap-break outline-none [&_table]:relative [&_table]:my-0 [&_table]:min-w-60 [&_table]:overflow-auto [&_table_td]:relative [&_table_th]:relative [&_table_td]:cursor-text [&_table_th]:cursor-text [&_table]:after:pointer-events-none [&_table]:after:absolute [&_table]:after:bottom-0 [&_table]:after:right-0 [&_table]:after:h-3 [&_table]:after:w-3 [&_table]:after:border-r-2 [&_table]:after:border-b-2 [&_table]:after:border-brand-500 [&_table]:after:content-[''] ${addParagraphSpacing ? "mb-3" : ""}`;
              if (isTable) {
                return <div key={`fragment-${fragment.blockIndex}-${pageIndex}`} contentEditable={false} data-template-fragment data-block-index={fragment.blockIndex} data-fragment-start={fragment.start} data-fragment-end={fragment.end} className={fragmentClass} dangerouslySetInnerHTML={{ __html: fragment.text }} />;
              }
              if (!fragment.text) {
                return <div key={`fragment-${fragment.blockIndex}-${pageIndex}`} contentEditable={true} data-template-fragment data-block-index={fragment.blockIndex} data-fragment-start={fragment.start} data-fragment-end={fragment.end} onKeyDown={handleEditableFragmentKeyDown} className={fragmentClass}>
                  <p data-template-editable-block="true" style={{ margin: 0, minHeight: "1.625em" }}></p>
                </div>;
              }
              return <div key={`fragment-${fragment.blockIndex}-${pageIndex}`} contentEditable={true} data-template-fragment data-block-index={fragment.blockIndex} data-fragment-start={fragment.start} data-fragment-end={fragment.end} onKeyDown={handleEditableFragmentKeyDown} className={fragmentClass} dangerouslySetInnerHTML={{ __html: fragment.text }} />;
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
