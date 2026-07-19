"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";

type AuthResponse = {
  user: {
    id: string;
    email: string;
    fullName: string;
    platformRole: "USER" | "SUPER_ADMIN";
  };
};

export default function Register() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const strength = useMemo(
    () => Math.min(100, password.length * 10),
    [password],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);

    try {
      const result = await api.post<AuthResponse>("/api/auth/register", {
        fullName: form.get("fullName"),
        storeName: form.get("storeName"),
        email: form.get("email"),
        password: form.get("password"),
      });
      window.location.assign(
        result.user.platformRole === "SUPER_ADMIN" ? "/admin/" : "/dashboard/",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل التسجيل");
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell min-h-screen lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-xl">
          <Link aria-label="الصفحة الرئيسية" href="/">
            <Logo />
          </Link>

          <div className="mt-10">
            <span className="inline-flex items-center gap-2 rounded-full bg-mint-50 px-3 py-1.5 text-xs font-black text-mint-700">
              <Sparkles size={14} /> تجربة مجانية
            </span>
            <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950">
              افتح متجرك في دقائق.
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              أنشئ حسابك، أضف الكتالوج واربط أول قناة من لوحة واحدة.
            </p>
          </div>

          <form
            className="mt-8 grid gap-5 sm:grid-cols-2"
            method="post"
            onSubmit={submit}
          >
            <label>
              <span className="label">اسمك الكامل</span>
              <input
                autoComplete="name"
                autoFocus
                className="field !py-3.5"
                name="fullName"
                placeholder="مثال: محمد أمين"
                required
              />
            </label>
            <label>
              <span className="label">اسم المتجر</span>
              <input
                className="field !py-3.5"
                name="storeName"
                placeholder="مثال: متجر الأناقة"
                required
              />
            </label>
            <label className="sm:col-span-2">
              <span className="label">البريد الإلكتروني</span>
              <input
                autoComplete="email"
                className="field !py-3.5"
                dir="ltr"
                name="email"
                placeholder="name@example.com"
                required
                type="email"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="label">كلمة السر</span>
              <span className="relative block">
                <input
                  autoComplete="new-password"
                  className="field !py-3.5 !pl-12"
                  dir="ltr"
                  minLength={10}
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="10 أحرف على الأقل"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
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
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span
                  className={`block h-full rounded-full transition-all ${strength >= 100 ? "bg-mint-500" : "bg-amber-400"}`}
                  style={{ width: `${strength}%` }}
                />
              </span>
              <span className="mt-1 block text-[10px] text-slate-400">
                استعمل 10 أحرف أو أكثر لحماية حسابك.
              </span>
            </label>

            {error && (
              <p
                className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700 sm:col-span-2"
                role="alert"
              >
                {error}
              </p>
            )}

            <button
              className="btn-primary w-full !py-3.5 sm:col-span-2"
              disabled={loading}
              type="submit"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> جاري إنشاء
                  الحساب…
                </>
              ) : (
                <>
                  إنشاء حسابي <ArrowLeft size={18} />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            عندك حساب؟{" "}
            <Link
              className="font-black text-mint-700 hover:underline"
              href="/login/"
            >
              ادخل من هنا
            </Link>
          </p>
          <p className="mt-7 flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck size={14} /> بإنشاء الحساب أنت توافق على الاستخدام
            العادل للمنصة
          </p>
        </div>
      </section>

      <aside className="auth-aside relative hidden min-h-screen overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10 flex justify-end">
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/55">
            انطلق بخطوات واضحة
          </span>
        </div>
        <div className="relative z-10 max-w-xl">
          <span className="grid size-14 place-items-center rounded-2xl bg-mint-500 shadow-xl shadow-mint-950/20">
            <Store size={26} />
          </span>
          <h2 className="mt-7 text-5xl font-black leading-[1.25]">
            كل أدوات متجرك، منظمة في مكان واحد.
          </h2>
          <div className="mt-8 space-y-3">
            {[
              "أضف منتجاتك وأسعار التوصيل",
              "اربط Facebook وInstagram وWhatsApp",
              "استقبل الطلبيات وتابع حالتها",
            ].map((item, index) => (
              <span
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/70"
                key={item}
              >
                <span className="grid size-7 place-items-center rounded-xl bg-white/10 text-[10px] text-mint-300">
                  {index + 1}
                </span>
                {item}
                <Check className="mr-auto text-mint-300" size={16} />
              </span>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}
