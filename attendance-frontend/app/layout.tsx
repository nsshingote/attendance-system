import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster, ToastBar, toast } from "react-hot-toast";
import { X } from "lucide-react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Attendance Management System",
  description: "Employee attendance, leave, and workforce management",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning>
        {children}
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
      </body>
    </html>
  );
}