"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  MessageCircleMore,
  PackageCheck,
  Settings2,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";

type Stats = {
  products: number;
  channels: number;
  openOrders: number;
  todayOrders: number;
  revenue: string;
};

const quickActions = [
  {
    href: "/dashboard/channels/",
    title: "اربط قناة جديدة",
    description: "Facebook، Instagram أو WhatsApp",
    icon: MessageCircleMore,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    href: "/dashboard/catalog/",
    title: "أضف منتجاً",
    description: "الأسعار، المخزون والمتغيرات",
    icon: Boxes,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    href: "/dashboard/settings/",
    title: "اضبط المساعد",
    description: "القواعد، العروض وأسعار التوصيل",
    icon: Settings2,
    tone: "bg-amber-50 text-amber-700",
  },
] as const;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Stats>("/api/dashboard/stats")
      .then(setStats)
      .catch((reason) => {
        if (reason.status === 401) window.location.assign("/login/");
        else setError((reason as Error).message);
      });
  }, []);

  const readiness = useMemo(() => {
    if (!stats) return 0;
    return Math.round(
      (((stats.products > 0 ? 1 : 0) +
        (stats.channels > 0 ? 1 : 0) +
        (stats.openOrders > 0 || stats.todayOrders > 0 ? 1 : 0)) /
        3) *
        100,
    );
  }, [stats]);

  const cards = [
    {
      key: "todayOrders" as const,
      label: "طلبيات اليوم",
      hint: "طلبات قنصها المساعد",
      icon: ShoppingBag,
      iconClass: "bg-mint-50 text-mint-700",
    },
    {
      key: "openOrders" as const,
      label: "تحتاج متابعة",
      hint: "طلبات مازالت مفتوحة",
      icon: TrendingUp,
      iconClass: "bg-amber-50 text-amber-700",
    },
    {
      key: "products" as const,
      label: "المنتجات النشطة",
      hint: "جاهزة للبيع والاقتراح",
      icon: Boxes,
      iconClass: "bg-violet-50 text-violet-700",
    },
    {
      key: "channels" as const,
      label: "القنوات المربوطة",
      hint: "حسابات تستقبل الرسائل",
      icon: MessageCircleMore,
      iconClass: "bg-blue-50 text-blue-700",
    },
  ];

  return (
    <>
      <Header
        eyebrow="مركز القيادة"
        title="صباح الخير، متجرك بين يديك"
        description="راقب المبيعات، جهّز قنواتك وخلي AmiGo يتكفل بالمحادثات."
        actions={
          <Link className="btn-primary" href="/dashboard/orders/">
            <ShoppingBag size={18} /> عرض الطلبيات
          </Link>
        }
      />

      {error && (
        <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <section className="dashboard-hero mb-5 overflow-hidden rounded-[2rem] p-6 text-white sm:p-8">
        <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_320px] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/80">
              <Sparkles size={15} /> مساعد مبيعات يعمل بالدارجة
            </span>
            <h2 className="mt-5 max-w-2xl text-3xl font-black leading-tight sm:text-4xl">
              كل رسالة فرصة بيع، وكل طلبية محفوظة ومنظمة.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/65">
              كمّل إعداد متجرك مرة واحدة، ومن بعدها AmiGo يجاوب، يقترح من
              الكتالوج ويجمع معلومات الطلبية تلقائياً.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/55">جاهزية المتجر</p>
                <p className="mt-1 text-3xl font-black">
                  {stats ? `${readiness}%` : "—"}
                </p>
              </div>
              <CheckCircle2 className="text-mint-100" size={34} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-l from-mint-500 to-cyan-300 transition-all duration-700"
                style={{ width: `${readiness}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-6 text-white/55">
              أضف منتجاً، اربط قناة واستقبل أول طلبية حتى تكتمل الجاهزية.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ key, label, hint, icon: Icon, iconClass }) => (
          <article className="card metric-card p-5" key={key}>
            <div className="flex items-start justify-between gap-3">
              <span
                className={`grid size-11 place-items-center rounded-2xl ${iconClass}`}
              >
                <Icon size={21} />
              </span>
              <span className="badge bg-slate-50 text-slate-500">مباشر</span>
            </div>
            <p className="mt-5 text-sm font-bold text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
              {stats?.[key] ?? "—"}
            </p>
            <p className="mt-2 text-xs text-slate-400">{hint}</p>
          </article>
        ))}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <article className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-black text-slate-950">إجراءات سريعة</h2>
              <p className="mt-1 text-xs text-slate-400">
                أهم ما تحتاجه لتشغيل المتجر
              </p>
            </div>
            <Sparkles className="text-mint-600" size={20} />
          </div>
          <div className="divide-y divide-slate-100 px-3 py-2">
            {quickActions.map(
              ({ href, title, description, icon: Icon, tone }) => (
                <Link
                  className="group flex items-center gap-4 rounded-2xl px-3 py-4 transition hover:bg-slate-50"
                  href={href}
                  key={href}
                >
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone}`}
                  >
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm text-slate-900">{title}</b>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {description}
                    </span>
                  </span>
                  <ArrowLeft
                    className="text-slate-300 transition group-hover:-translate-x-1 group-hover:text-mint-600"
                    size={18}
                  />
                </Link>
              ),
            )}
          </div>
        </article>

        <article className="card flex flex-col p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-950">قيمة الطلبيات</h2>
              <p className="mt-1 text-xs text-slate-400">
                باستثناء الملغاة والمرتجعة
              </p>
            </div>
            <span className="grid size-11 place-items-center rounded-2xl bg-mint-50 text-mint-700">
              <CircleDollarSign size={22} />
            </span>
          </div>
          <p className="mt-8 text-4xl font-black tracking-tight text-slate-950">
            {stats ? Number(stats.revenue).toLocaleString("fr-DZ") : "—"}
            <span className="mr-2 text-base text-slate-400">دج</span>
          </p>
          <div className="mt-auto flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-xs text-slate-500">
            <PackageCheck className="shrink-0 text-mint-600" size={20} />
            يتم تحديث الرقم تلقائياً مع كل طلبية جديدة.
          </div>
        </article>
      </section>
    </>
  );
}
