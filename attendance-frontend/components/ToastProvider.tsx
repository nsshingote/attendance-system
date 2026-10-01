"use client";

import { ToastBar, Toaster, toast } from "react-hot-toast";
import { X } from "lucide-react";

export default function ToastProvider() {
  return (
    <Toaster>
      {(toastItem) => (
        <ToastBar toast={toastItem}>
          {({ icon, message }) => (
            <>
              {icon}
              {message}
              {toastItem.type === "error" && (
                <button
                  type="button"
                  onClick={() => toast.dismiss(toastItem.id)}
                  aria-label="Dismiss error message"
                  className="ml-2 rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <X size={16} />
                </button>
              )}
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
