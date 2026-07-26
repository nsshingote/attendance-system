"use client";

/**
 * app/forgot-password/page.tsx
 * Requests a password reset email. Posts to POST /auth/forgot-password.
 */

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Mail, ArrowLeft } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";

interface FormValues {
  email: string;
}

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", values);
      setSubmitted(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-card">
        <Link href="/login" className="mb-6 flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-700">
          <ArrowLeft size={15} />
          Back to login
        </Link>

        <div className="mb-6">
          <h1 className="text-lg font-semibold text-ink-900">Forgot your password?</h1>
          <p className="mt-1 text-sm text-ink-500">
            Enter your registered email and we&apos;ll send you a reset link.
          </p>
        </div>

        {submitted ? (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
            If that email is registered, a reset link has been sent. Please check your inbox.
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  type="email"
                  placeholder="you@company.com"
                  {...register("email", { required: "Email is required" })}
                  className="w-full rounded-lg border border-ink-200 py-2.5 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </div>
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}