"use client";

/**
 * components/Common/Pagination.tsx
 * Wraps react-paginate with app styling. Used below tables across
 * Users, Attendance, Leave, Corrections, Reports, and Activity Logs.
 */

import ReactPaginate from "react-paginate";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  pageCount: number;
  currentPage: number; // 0-indexed, matches react-paginate
  onPageChange: (selectedPage: number) => void;
}

export default function Pagination({ pageCount, currentPage, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <ReactPaginate
      forcePage={currentPage}
      pageCount={pageCount}
      onPageChange={(selected) => onPageChange(selected.selected)}
      previousLabel={<ChevronLeft size={16} />}
      nextLabel={<ChevronRight size={16} />}
      breakLabel="..."
      marginPagesDisplayed={1}
      pageRangeDisplayed={2}
      containerClassName="flex items-center gap-1 text-sm"
      pageLinkClassName="flex h-8 w-8 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100"
      activeLinkClassName="!bg-brand-500 !text-white hover:!bg-brand-500"
      previousLinkClassName="flex h-8 w-8 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100"
      nextLinkClassName="flex h-8 w-8 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100"
      breakLinkClassName="flex h-8 w-8 items-center justify-center text-ink-400"
      disabledLinkClassName="opacity-40 pointer-events-none"
    />
  );
}