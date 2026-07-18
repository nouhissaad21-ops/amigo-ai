"use client";

import { useState } from "react";
import Link from "next/link";
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
        result.user.platformRole === "SUPER_ADMIN"
          ? "/admin/"
          : "/dashboard/",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل الدخول");
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Logo />
          <h1 className="mt-12 text-4xl font-black">مرحبا بيك 👋</h1>
          <p className="mt-3 text-black/50">
            ادخل وشوف واش قنصلك AmiGo اليوم.
          </p>
          <form className="mt-8 space-y-5" method="post" onSubmit={submit}>
            <label>
              <span className="label">البريد</span>
              <input
                className="field"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span className="label">كلمة السر</span>
              <input
                className="field"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p className="rounded-2xl bg-red-50 p-3 text-red-700" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
            >
              {loading ? "جاري الدخول..." : "دخول"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm">
            ما عندكش حساب؟{" "}
            <Link className="font-bold text-mint-700" href="/register/">
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
