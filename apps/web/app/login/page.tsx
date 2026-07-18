"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";
export default function Login() {
  const r = useRouter(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const f = new FormData(e.currentTarget);
    try {
      await api.post("/api/auth/login", {
        email: f.get("email"),
        password: f.get("password"),
      });
      r.replace("/dashboard");
    } catch (x) {
      setError(x instanceof Error ? x.message : "فشل الدخول");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Logo />
          <h1 className="mt-12 text-4xl font-black">مرحبا بيك 👋</h1>
          <p className="mt-3 text-black/50">ادخل وشوف واش قنصلك AmiGo اليوم.</p>
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label>
              <span className="label">البريد</span>
              <input className="field" name="email" type="email" required />
            </label>
            <label>
              <span className="label">كلمة السر</span>
              <input
                className="field"
                name="password"
                type="password"
                required
              />
            </label>
            {error && (
              <p className="rounded-2xl bg-red-50 p-3 text-red-700">{error}</p>
            )}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "جاري..." : "دخول"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm">
            ما عندكش حساب؟{" "}
            <Link className="font-bold text-mint-700" href="/register">
              افتح متجر
            </Link>
          </p>
        </div>
      </section>
      <section className="hidden bg-ink p-14 text-white lg:flex lg:items-end">
        <h2 className="text-5xl font-black leading-tight">
          خلي المحادثة تولّي طلبية، حتى كي تكون راقد.
        </h2>
      </section>
    </main>
  );
}
