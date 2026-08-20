export const DYNAMIC_PAGE_BREAK = "[[dynamic:page-break]]";

export const isDynamicPageBreak = (value: string) => value.trim() === DYNAMIC_PAGE_BREAK;
