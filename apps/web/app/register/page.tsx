"use client";

import { useState } from "react";
import Link from "next/link";
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
        result.user.platformRole === "SUPER_ADMIN"
          ? "/admin/"
          : "/dashboard/",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل التسجيل");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-2xl">
        <Logo />
        <form
          method="post"
          onSubmit={submit}
          className="card mt-10 grid gap-5 p-8 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <h1 className="text-3xl font-black">افتح متجرك</h1>
            <p className="text-black/50">تجربة 14 يوم</p>
          </div>
          <label>
            <span className="label">اسمك</span>
            <input
              className="field"
              name="fullName"
              autoComplete="name"
              required
            />
          </label>
          <label>
            <span className="label">المتجر</span>
            <input className="field" name="storeName" required />
          </label>
          <label className="sm:col-span-2">
            <span className="label">البريد</span>
            <input
              className="field"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label className="sm:col-span-2">
            <span className="label">كلمة السر (10+)</span>
            <input
              className="field"
              name="password"
              type="password"
              minLength={10}
              autoComplete="new-password"
              required
            />
          </label>
          {error && (
            <p
              className="sm:col-span-2 rounded-2xl bg-red-50 p-3 text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary sm:col-span-2"
            disabled={loading}
          >
            {loading ? "جاري إنشاء الحساب..." : "إنشاء الحساب"}
          </button>
          <Link
            className="sm:col-span-2 text-center text-sm"
            href="/login/"
          >
            عندي حساب
          </Link>
        </form>
      </div>
    </main>
  );
}
