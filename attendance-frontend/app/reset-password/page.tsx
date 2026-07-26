"use client";

/**
 * app/reset-password/page.tsx
 * Confirms a password reset using the token from the emailed link
 * (?token=...). Posts to POST /auth/reset-password.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Lock, Eye, EyeOff } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";

interface FormValues {
  new_password: string;
  confirm_password: string;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const onSubmit = async (values: FormValues) => {
    if (!token) {
      toast.error("Missing or invalid reset link");
      return;
    }

    if (values.new_password !== values.confirm_password) {
      toast.error("Passwords do not match");
      return;
    }

    setSubmitting(true);

    try {
      await api.post("/auth/reset-password", {
        token,
        new_password: values.new_password,
      });

      toast.success("Password reset successfully. Please sign in.");
      router.push("/login");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-card">
          <p className="text-sm text-ink-600">
            This reset link is invalid or missing a token. Please request a new one.
          </p>

          <Link
            href="/forgot-password"
            className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-card">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-ink-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Choose a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              New Password
            </label>

            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              />

              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                {...register("new_password", {
                  required: "Password is required",
                  minLength: {
                    value: 6,
                    message: "Minimum 6 characters",
                  },
                })}
                className="w-full rounded-lg border border-ink-200 py-2.5 pl-9 pr-9 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />

              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {errors.new_password && (
              <p className="mt-1 text-xs text-red-600">
                {errors.new_password.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              Confirm Password
            </label>

            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              {...register("confirm_password", {
                required: "Please confirm your password",
                validate: (value) =>
                  value === watch("new_password") || "Passwords do not match",
              })}
              className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />

            {errors.confirm_password && (
              <p className="mt-1 text-xs text-red-600">
                {errors.confirm_password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          Loading...
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}