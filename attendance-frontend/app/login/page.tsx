"use client";

/**
 * app/login/page.tsx
 * Login form. Sends device fingerprint info so the backend can enforce
 * "employees can only log in from a registered device".
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Lock, Phone, Eye, EyeOff } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { saveSession, isAuthenticated } from "@/lib/auth";
import { getDeviceInfo } from "@/lib/device";

interface LoginFormValues {
  mobile: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>();

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/dashboard");
    }
  }, [router]);

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      const device = getDeviceInfo();
      const { data } = await api.post("/auth/login", {
        mobile: values.mobile,
        password: values.password,
        ...device,
      });

      saveSession({
        token: data.access_token,
        userId: data.user_id,
        name: data.name,
        role: data.role,
      });

      toast.success(`Welcome back, ${data.name}`);
      router.push("/dashboard");
    } catch (error) {
        const message = getErrorMessage(error);
        toast.error(message);
      
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="w-340px max-w-full rounded-xl bg-white p-6 shadow-card">
        <div className="mb-5 text-center">
          <img
            src="/logo.jpg"
            alt="Company Logo"
            className="mx-auto mb-2.5 h-12 w-12 rounded-xl object-cover shadow-card"
          />
          <h1 className="text-lg font-semibold text-ink-900">Sign in</h1>
          <p className="mt-0.5 text-xs text-ink-500">Attendance System</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">Mobile</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="tel"
                autoComplete="tel"
                placeholder="9876543210"
                {...register("mobile", { required: "Mobile number is required" })}
                className="w-full rounded-lg border border-ink-200 py-1.5 pl-8 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>
            {errors.mobile && <p className="mt-0.5 text-xs text-red-600">{errors.mobile.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register("password", { required: "Password is required" })}
                className="w-full rounded-lg border border-ink-200 py-1.5 pl-8 pr-8 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {errors.password && <p className="mt-0.5 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <div className="flex justify-end">
            <a href="/forgot-password" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Forgot password?
            </a>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-3 text-center text-[10px] text-ink-400 leading-relaxed">
          Employees can only sign in from their registered device. New devices require admin approval.
        </p>
      </div>
    </div>
  );
}