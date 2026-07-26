"use client";

/**
 * app/page.tsx
 * Entry point: redirects to /dashboard if logged in, otherwise /login.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Loading from "@/components/Common/Loading";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isAuthenticated() ? "/dashboard" : "/login");
  }, [router]);

  return <Loading fullScreen />;
}