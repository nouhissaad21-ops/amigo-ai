"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";

type AuthResponse = {
  user: {
    platformRole: "USER" | "SUPER_ADMIN";
  };
};

export default function Login() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.post<AuthResponse>("/api/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      window.location.assign(
        result.user.platformRole === "SUPER_ADMIN" ? "/admin/" : "/dashboard/",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل الدخول");
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell min-h-screen lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link aria-label="الصفحة الرئيسية" href="/">
            <Logo />
          </Link>

          <div className="mt-12">
            <span className="inline-flex items-center gap-2 rounded-full bg-mint-50 px-3 py-1.5 text-xs font-black text-mint-700">
              <LockKeyhole size={14} /> دخول آمن
            </span>
            <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950">
              مرحبا بعودتك 👋
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              ادخل للوحة متجرك وتابع القنوات والطلبيات من مكان واحد.
            </p>
          </div>

          <form className="mt-8 space-y-5" method="post" onSubmit={submit}>
            <label>
              <span className="label">البريد الإلكتروني</span>
              <input
                autoComplete="email"
                autoFocus
                className="field !py-3.5"
                dir="ltr"
                name="email"
                placeholder="name@example.com"
                required
                type="email"
              />
            </label>
            <label>
              <span className="label">كلمة السر</span>
              <span className="relative block">
                <input
                  autoComplete="current-password"
                  className="field !py-3.5 !pl-12"
                  dir="ltr"
                  name="password"
                  placeholder="••••••••••"
                  required
                  type={showPassword ? "text" : "password"}
                />
                <button
                  aria-label={
                    showPassword ? "إخفاء كلمة السر" : "إظهار كلمة السر"
                  }
                  className="absolute left-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setShowPassword((value) => !value)}
                  type="button"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {error && (
              <p
                className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700"
                role="alert"
              >
                {error}
              </p>
            )}

            <button
              className="btn-primary w-full !py-3.5"
              disabled={loading}
              type="submit"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> جاري الدخول…
                </>
              ) : (
                <>
                  دخول إلى حسابي <ArrowLeft size={18} />
                </>
              )}
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-slate-500">
            ما عندكش حساب؟{" "}
            <Link
              className="font-black text-mint-700 hover:underline"
              href="/register/"
            >
              افتح متجرك مجاناً
            </Link>
          </p>
          <p className="mt-8 flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck size={14} /> اتصال مشفر وبيانات كل متجر معزولة
          </p>
        </div>
      </section>

      <aside className="auth-aside relative hidden min-h-screen overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10 flex justify-end">
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/55">
            AmiGo AI for Commerce
          </span>
        </div>
        <div className="relative z-10 max-w-xl">
          <span className="grid size-14 place-items-center rounded-2xl bg-mint-500 shadow-xl shadow-mint-950/20">
            <MessageCircleMore size={26} />
          </span>
          <h2 className="mt-7 text-5xl font-black leading-[1.25]">
            متجرك يواصل البيع، حتى كي تكون راقد.
          </h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              "ردود بالدارجة",
              "طلبات منظمة",
              "كتالوج مضبوط",
              "قنوات موحدة",
            ].map((item) => (
              <span
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold text-white/70"
                key={item}
              >
                <CheckCircle2 className="text-mint-300" size={16} /> {item}
              </span>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
