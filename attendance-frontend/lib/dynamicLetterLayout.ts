import type { CSSProperties } from "react";
import type { DynamicTemplatePage } from "@/components/Documents/PaginatedTemplateEditor";

// A4 page content is 1008px after the 56px top and bottom padding.
// Reserve the rendered header/title/footer before paginating the body.
export const FIRST_PAGE_BODY_HEIGHT_PX = 845;
export const OTHER_PAGE_BODY_HEIGHT_PX = 971;
export const A4_CONTENT_WIDTH_PX = 682;
export const PAGE_LAYOUT_OVERFLOW_TOLERANCE_PX = 8;
export const FRAGMENT_GAP_PX = 12;

/** In-viewport but invisible — reliable layout on iOS Safari (unlike far off-screen). */
export const HIDDEN_PDF_PREVIEW_CONTAINER_STYLE: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "794px",
  visibility: "hidden",
  pointerEvents: "none",
  opacity: 0,
  zIndex: -1,
  overflow: "hidden",
};

const isTableHtml = (html: string) => /^<table\b/i.test(html.trim());

const fragmentNeedsSpacing = (
  fragments: DynamicTemplatePage["fragments"],
  fragmentIndex: number,
) => {
  const fragment = fragments[fragmentIndex];
  const isTable = isTableHtml(fragment.text);
  const previousFragment = fragments[fragmentIndex - 1]?.text.trim() ?? "";
  const nextFragment = fragments[fragmentIndex + 1]?.text.trim() ?? "";
  const hasFollowingContent = fragments.slice(fragmentIndex + 1).some(next => next.text.trim().length > 0);
  return hasFollowingContent;
};

export const fragmentGapPx = (
  fragments: DynamicTemplatePage["fragments"],
  fragmentIndex: number,
) => fragmentNeedsSpacing(fragments, fragmentIndex) ? FRAGMENT_GAP_PX : 0;

export const normalizeDynamicTemplateHtml = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  const visit = (node: Node) => {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) {
        child.remove();
        return;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (/^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE)$/.test(element.nodeName)) {
          element.style.setProperty("margin", "0");
        }
        visit(element);
      }
    });
  };
  visit(container);
  return container.innerHTML;
};

const measureRoot = () => {
  const measure = document.createElement("div");
  measure.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    `width:${A4_CONTENT_WIDTH_PX}px`,
    // globals.css applies max-width:100% to *, which otherwise constrains
    // this fixed-A4 probe to an Android phone viewport.
    "max-width:none",
    "border:0",
    "padding:0",
    "margin:0",
    "font:14px/1.625 Georgia,\"Times New Roman\",Times,serif",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "word-break:break-word",
  ].join(";");
  document.body.appendChild(measure);
  return measure;
};

/** Mirror preview fragment spacing and typography for height estimates. */
export const measureFragmentColumnHeight = (fragments: DynamicTemplatePage["fragments"]) => {
  if (!fragments.length) return 0;
  const measure = measureRoot();
  fragments.forEach((fragment, fragmentIndex) => {
    const wrapper = document.createElement("div");
    wrapper.style.margin = "0";
    wrapper.style.marginBottom = `${fragmentGapPx(fragments, fragmentIndex)}px`;
    wrapper.innerHTML = fragment.text || "";
    measure.appendChild(wrapper);
  });
  const height = measure.scrollHeight;
  measure.remove();
  return height;
};

export const pageBodyHeightPx = (pageIndex: number) =>
  pageIndex === 0 ? FIRST_PAGE_BODY_HEIGHT_PX : OTHER_PAGE_BODY_HEIGHT_PX;

export const fragmentsFitPageBody = (fragments: DynamicTemplatePage["fragments"], pageIndex: number) =>
  measureFragmentColumnHeight(fragments) <= pageBodyHeightPx(pageIndex) + PAGE_LAYOUT_OVERFLOW_TOLERANCE_PX;

/**
 * Drop trailing pages that the pagination estimate created but whose resolved
 * fragments still fit on the previous page body at A4 width.
 */
export const mergeSpuriousTrailingPages = (pages: DynamicTemplatePage[]) => {
  const merged = pages.map(page => ({ ...page, fragments: [...page.fragments] }));
  while (merged.length > 1) {
    const lastIndex = merged.length - 1;
    const lastPage = merged[lastIndex];
    if (lastPage.manualBreakBefore !== undefined) break;
    const previousIndex = lastIndex - 1;
    const combinedFragments = [...merged[previousIndex].fragments, ...lastPage.fragments];
    if (!fragmentsFitPageBody(combinedFragments, previousIndex)) break;
    merged[previousIndex] = { ...merged[previousIndex], fragments: combinedFragments };
    merged.pop();
  }
  return merged;
};

export const measurePageBodyOverflow = (body: HTMLDivElement, pageIndex: number) => {
  const limit = pageBodyHeightPx(pageIndex);
  if (body.scrollHeight > limit + PAGE_LAYOUT_OVERFLOW_TOLERANCE_PX) {
    return { pageIndex };
  }
  return null;
};

export const waitForElementImages = (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  const pending = images.filter(image => !image.complete);
  if (!pending.length) return Promise.resolve();
  return Promise.all(pending.map(image => new Promise<void>(resolve => {
    const finish = () => {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      resolve();
    };
    image.addEventListener("load", finish);
    image.addEventListener("error", finish);
  })));
};

export const nextAnimationFrames = (count = 2) =>
  new Promise<void>(resolve => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
