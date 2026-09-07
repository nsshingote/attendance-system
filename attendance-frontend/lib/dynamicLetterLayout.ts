import type { CSSProperties } from "react";
import type { DynamicTemplatePage } from "@/components/Documents/PaginatedTemplateEditor";

export const FIRST_PAGE_BODY_HEIGHT_PX = 780;
export const OTHER_PAGE_BODY_HEIGHT_PX = 920;
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
  const adjacentToTable = isTable || isTableHtml(previousFragment) || isTableHtml(nextFragment);
  const hasFollowingContent = fragments.slice(fragmentIndex + 1).some(next => next.text.trim().length > 0);
  return hasFollowingContent && !adjacentToTable;
};

const measureRoot = () => {
  const measure = document.createElement("div");
  measure.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    `width:${A4_CONTENT_WIDTH_PX}px`,
    "border:0",
    "padding:0",
    "margin:0",
    "font:14px/1.625 ui-serif,Georgia,Cambria,\"Times New Roman\",Times,serif",
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
    if (fragmentNeedsSpacing(fragments, fragmentIndex)) {
      wrapper.style.marginBottom = `${FRAGMENT_GAP_PX}px`;
    }
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
