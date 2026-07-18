"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";
export default function Register() {
  const r = useRouter(),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.post("/api/auth/register", Object.fromEntries(f));
      r.replace("/dashboard");
    } catch (x) {
      setError(x instanceof Error ? x.message : "فشل التسجيل");
    }
  }
  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-2xl">
        <Logo />
        <form
          onSubmit={submit}
          className="card mt-10 grid gap-5 p-8 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <h1 className="text-3xl font-black">افتح متجرك</h1>
            <p className="text-black/50">تجربة 14 يوم</p>
          </div>
          <label>
            <span className="label">اسمك</span>
            <input className="field" name="fullName" required />
          </label>
          <label>
            <span className="label">المتجر</span>
            <input className="field" name="storeName" required />
          </label>
          <label className="sm:col-span-2">
            <span className="label">البريد</span>
            <input className="field" name="email" type="email" required />
          </label>
          <label className="sm:col-span-2">
            <span className="label">كلمة السر (10+)</span>
            <input
              className="field"
              name="password"
              type="password"
              minLength={10}
              required
            />
          </label>
          {error && <p className="sm:col-span-2 text-red-700">{error}</p>}
          <button className="btn-primary sm:col-span-2">إنشاء الحساب</button>
          <Link className="sm:col-span-2 text-center text-sm" href="/login">
            عندي حساب
          </Link>
        </form>
      </div>
    </main>
  );
}
