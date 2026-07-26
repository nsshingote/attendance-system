"use client";

/**
 * components/Common/Loading.tsx
 * Reusable loading indicator. Use `fullScreen` for page-level loads,
 * or the default inline size for cards/tables/buttons.
 */

import { ThreeDots } from "react-loader-spinner";

interface LoadingProps {
  fullScreen?: boolean;
  label?: string;
  size?: number;
}

export default function Loading({ fullScreen = false, label, size = 40 }: LoadingProps) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      <ThreeDots
        visible
        height={size}
        width={size}
        color="#4F46E5"
        ariaLabel="loading"
      />
      {label && <p className="text-sm text-ink-500">{label}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        {content}
      </div>
    );
  }

  return <div className="flex w-full items-center justify-center py-8">{content}</div>;
}