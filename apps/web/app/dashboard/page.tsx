"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MessageCircleMore,
  PackageCheck,
  Radio,
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
  analytics: {
    daily: Array<{ date: string; orders: number; revenue: string }>;
    orderStatuses: Array<{
      status: OrderStatus;
      count: number;
    }>;
    channels: Array<{
      id: string;
      name: string;
      type: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP_CLOUD" | "WHATSAPP_BAILEYS";
      status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
      messages: number;
      orders: number;
      revenue: string;
      conversionRate: number;
    }>;
    recentOrders: Array<{
      id: string;
      orderNumber: string;
      fullName: string;
      wilayaName: string;
      totalAmount: string;
      status: OrderStatus;
      createdAt: string;
      channel: { name: string; type: string };
      items: Array<{ productNameSnapshot: string; quantity: number }>;
    }>;
  };
};

type OrderStatus =
  | "CAPTURED"
  | "CONFIRMED"
  | "PACKING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";

const orderStatusMeta: Record<
  OrderStatus,
  { label: string; color: string; dot: string }
> = {
  CAPTURED: { label: "جديدة", color: "bg-blue-500", dot: "bg-blue-500" },
  CONFIRMED: { label: "مؤكدة", color: "bg-cyan-500", dot: "bg-cyan-500" },
  PACKING: { label: "قيد التحضير", color: "bg-amber-500", dot: "bg-amber-500" },
  SHIPPED: { label: "مشحونة", color: "bg-violet-500", dot: "bg-violet-500" },
  DELIVERED: { label: "مسلّمة", color: "bg-mint-500", dot: "bg-mint-500" },
  CANCELED: { label: "ملغاة", color: "bg-red-400", dot: "bg-red-400" },
  RETURNED: { label: "مرتجعة", color: "bg-slate-400", dot: "bg-slate-400" },
};

const channelMeta = {
  FACEBOOK: { label: "Messenger", color: "bg-blue-50 text-blue-700" },
  INSTAGRAM: { label: "Instagram", color: "bg-pink-50 text-pink-700" },
  WHATSAPP_CLOUD: {
    label: "WhatsApp",
    color: "bg-emerald-50 text-emerald-700",
  },
  WHATSAPP_BAILEYS: {
    label: "WhatsApp QR",
    color: "bg-emerald-50 text-emerald-700",
  },
} as const;

const formatMoney = (value: string | number) =>
  Number(value).toLocaleString("fr-DZ", { maximumFractionDigits: 0 });

const weekday = (date: string) =>
  new Intl.DateTimeFormat("ar-DZ", {
    weekday: "short",
    timeZone: "Africa/Algiers",
  }).format(new Date(`${date}T12:00:00+01:00`));

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

  const analytics = stats?.analytics;
  const maxDailyOrders = useMemo(
    () => Math.max(1, ...(analytics?.daily.map((day) => day.orders) ?? [1])),
    [analytics],
  );
  const statusTotal = useMemo(
    () =>
      analytics?.orderStatuses.reduce((total, item) => total + item.count, 0) ??
      0,
    [analytics],
  );

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

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <article className="card overflow-hidden p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] text-mint-600">
                الأداء اليومي
              </p>
              <h2 className="mt-2 text-lg font-black text-slate-950">
                نشاط آخر 7 أيام
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                الطلبيات والقيمة المحققة كل يوم
              </p>
            </div>
            <span className="grid size-11 place-items-center rounded-2xl bg-mint-50 text-mint-700">
              <BarChart3 size={22} />
            </span>
          </div>

          <div className="mt-8 flex h-52 items-end gap-2 sm:gap-4" dir="ltr">
            {(analytics?.daily ?? Array.from({ length: 7 })).map(
              (day, index) => {
                const orders = day?.orders ?? 0;
                const height = Math.max(5, (orders / maxDailyOrders) * 100);
                return (
                  <div
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                    key={day?.date ?? index}
                  >
                    <div className="mb-2 text-center text-[10px] font-black text-slate-500">
                      {orders || "—"}
                    </div>
                    <div className="relative flex h-36 items-end overflow-hidden rounded-xl bg-slate-50">
                      <div
                        className="w-full rounded-xl bg-gradient-to-t from-mint-600 to-cyan-400 transition-all duration-700"
                        style={{
                          height: `${height}%`,
                          opacity: orders ? 1 : 0.18,
                        }}
                        title={
                          day ? `${formatMoney(day.revenue)} دج` : undefined
                        }
                      />
                    </div>
                    <div
                      className="mt-2 truncate text-center text-[10px] font-bold text-slate-400"
                      dir="rtl"
                    >
                      {day ? weekday(day.date) : "—"}
                    </div>
                  </div>
                );
              },
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4">
            <div>
              <p className="text-[11px] font-bold text-slate-400">
                طلبيات الأسبوع
              </p>
              <p className="mt-1 text-xl font-black text-slate-900">
                {analytics?.daily.reduce((sum, day) => sum + day.orders, 0) ??
                  "—"}
              </p>
            </div>
            <div className="border-r border-slate-200 pr-4">
              <p className="text-[11px] font-bold text-slate-400">
                قيمة الأسبوع
              </p>
              <p className="mt-1 text-xl font-black text-slate-900">
                {analytics
                  ? formatMoney(
                      analytics.daily.reduce(
                        (sum, day) => sum + Number(day.revenue),
                        0,
                      ),
                    )
                  : "—"}
                <span className="mr-1 text-xs text-slate-400">دج</span>
              </p>
            </div>
          </div>
        </article>

        <article className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] text-mint-600">
                دورة الطلب
              </p>
              <h2 className="mt-2 text-lg font-black text-slate-950">
                حالات الطلبيات
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                توزيع كل الطلبات المسجلة
              </p>
            </div>
            <span className="grid size-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
              <PackageCheck size={22} />
            </span>
          </div>

          <div className="mt-7 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {statusTotal > 0 ? (
              analytics?.orderStatuses.map((item) => (
                <div
                  className={orderStatusMeta[item.status].color}
                  key={item.status}
                  style={{ width: `${(item.count / statusTotal) * 100}%` }}
                />
              ))
            ) : (
              <div className="w-full bg-slate-100" />
            )}
          </div>

          <div className="mt-5 space-y-3">
            {(analytics?.orderStatuses ?? []).length ? (
              analytics!.orderStatuses.map((item) => (
                <div className="flex items-center gap-3" key={item.status}>
                  <span
                    className={`size-2.5 rounded-full ${orderStatusMeta[item.status].dot}`}
                  />
                  <span className="flex-1 text-xs font-bold text-slate-600">
                    {orderStatusMeta[item.status].label}
                  </span>
                  <b className="text-sm text-slate-900">{item.count}</b>
                  <span className="w-10 text-left text-[10px] font-bold text-slate-400">
                    {statusTotal
                      ? Math.round((item.count / statusTotal) * 100)
                      : 0}
                    %
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                تظهر الحالات هنا بعد أول طلبية.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <article className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] text-mint-600">
                آخر 30 يوم
              </p>
              <h2 className="mt-2 text-lg font-black text-slate-950">
                الأداء حسب القناة
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                الرسائل، الطلبيات ونسبة التحويل
              </p>
            </div>
            <Radio className="text-mint-600" size={22} />
          </div>

          <div className="mt-6 space-y-3">
            {(analytics?.channels ?? []).length ? (
              analytics!.channels.map((channel) => {
                const meta = channelMeta[channel.type];
                return (
                  <div
                    className="rounded-2xl border border-slate-100 p-4"
                    key={channel.id}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid size-10 place-items-center rounded-xl text-xs font-black ${meta.color}`}
                      >
                        {meta.label.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-sm text-slate-900">
                          {channel.name}
                        </b>
                        <span className="text-[11px] text-slate-400">
                          {meta.label}
                        </span>
                      </div>
                      <span
                        className={`badge ${channel.status === "CONNECTED" ? "bg-mint-50 text-mint-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {channel.status === "CONNECTED" ? "مربوطة" : "متوقفة"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <b className="block text-sm text-slate-900">
                          {channel.messages}
                        </b>
                        <span className="text-[10px] text-slate-400">
                          رسالة
                        </span>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <b className="block text-sm text-slate-900">
                          {channel.orders}
                        </b>
                        <span className="text-[10px] text-slate-400">
                          طلبية
                        </span>
                      </div>
                      <div className="rounded-xl bg-mint-50 p-2.5">
                        <b className="block text-sm text-mint-700">
                          {channel.conversionRate}%
                        </b>
                        <span className="text-[10px] text-mint-600">تحويل</span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <Link
                className="mt-2 flex flex-col items-center rounded-2xl border border-dashed border-slate-200 p-7 text-center transition hover:border-mint-300 hover:bg-mint-50/40"
                href="/dashboard/channels/"
              >
                <MessageCircleMore className="text-mint-600" size={28} />
                <b className="mt-3 text-sm text-slate-800">اربط أول قناة</b>
                <span className="mt-1 text-xs text-slate-400">
                  باش تبدأ تستقبل الرسائل والطلبات
                </span>
              </Link>
            )}
          </div>
        </article>

        <article className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-black text-slate-950">أحدث الطلبيات</h2>
              <p className="mt-1 text-xs text-slate-400">
                آخر ما قنصه المساعد من المحادثات
              </p>
            </div>
            <Link
              className="btn-secondary px-3 py-2 text-xs"
              href="/dashboard/orders/"
            >
              عرض الكل <ArrowLeft size={15} />
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {(analytics?.recentOrders ?? []).length ? (
              analytics!.recentOrders.map((order) => (
                <Link
                  className="group flex flex-col gap-3 px-6 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center"
                  href="/dashboard/orders/"
                  key={order.id}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600">
                    <ShoppingBag size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <b className="truncate text-sm text-slate-900">
                        {order.fullName}
                      </b>
                      <span
                        className={`badge ${orderStatusMeta[order.status].color} bg-opacity-10 text-slate-700`}
                      >
                        {orderStatusMeta[order.status].label}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {order.orderNumber} · {order.wilayaName} ·{" "}
                      {order.items
                        .map(
                          (item) =>
                            `${item.productNameSnapshot} ×${item.quantity}`,
                        )
                        .join("، ")}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-4 sm:block sm:text-left">
                    <b className="block text-sm text-slate-900">
                      {formatMoney(order.totalAmount)} دج
                    </b>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 sm:justify-end">
                      <Clock3 size={12} />
                      {new Intl.DateTimeFormat("ar-DZ", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Africa/Algiers",
                      }).format(new Date(order.createdAt))}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
                <span className="grid size-14 place-items-center rounded-3xl bg-slate-100 text-slate-400">
                  <ShoppingBag size={24} />
                </span>
                <b className="mt-4 text-sm text-slate-700">ما كاش طلبيات بعد</b>
                <span className="mt-1 max-w-xs text-xs leading-6 text-slate-400">
                  بعد ربط القناة وإضافة المنتجات، أي طلبية يجمعها AmiGo تظهر هنا
                  مباشرة.
                </span>
              </div>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
