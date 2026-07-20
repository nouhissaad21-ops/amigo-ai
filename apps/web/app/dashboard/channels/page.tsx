"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Facebook,
  Instagram,
  Loader2,
  MessageCircle,
  Mic2,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Unplug,
  Wifi,
  X,
} from "lucide-react";
import { ChannelDoctor } from "@/components/channel-doctor";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
import type { Channel } from "@/lib/types";

const baileysEnabled = process.env.NEXT_PUBLIC_ENABLE_BAILEYS === "true";

const statusLabel: Record<Channel["status"], string> = {
  CONNECTED: "جاهز",
  PENDING: "قيد الربط",
  DISCONNECTED: "غير مربوط",
  ERROR: "يحتاج إصلاح",
};

type MetaCapabilities = {
  configured: boolean;
  businessLoginConfigured: boolean;
  instagramEnabled: boolean;
  directInstagramEnabled: boolean;
};

const metaErrorMessage: Record<string, string> = {
  META_NOT_CONFIGURED:
    "إعداد Meta غير مكتمل. يلزم App ID وApp Secret في إعدادات المنصة.",
  META_OAUTH_DENIED: "تم إلغاء نافذة Meta قبل منح الصلاحيات.",
  META_CODE_EXCHANGE_FAILED:
    "Meta رفضت جلسة الربط. تأكد أن حسابك يدير الصفحة ثم أعد المحاولة.",
  META_LONG_TOKEN_FAILED: "تعذر تثبيت رمز Meta طويل المدة.",
  META_API_ERROR: "Meta لم تسمح بقراءة الصفحات والحسابات لهذا المستخدم.",
  META_NO_PAGES:
    "لم نجد صفحة Facebook. اختر الصفحة وحساب Instagram المرتبط داخل نافذة Meta.",
  META_SUBSCRIBE_ERROR:
    "تم العثور على الصفحة لكن Meta رفضت تفعيل استقبال الرسائل.",
  INSTAGRAM_NOT_CONFIGURED: "الربط المباشر لـInstagram غير مفعّل بعد.",
  INSTAGRAM_OAUTH_DENIED: "تم إلغاء ربط Instagram.",
  INSTAGRAM_CODE_EXCHANGE_FAILED: "Instagram رفض جلسة الربط.",
  INSTAGRAM_LONG_TOKEN_FAILED:
    "تعذر تثبيت رمز Instagram. استعمل زر الربط السريع عبر Meta أولاً.",
  INSTAGRAM_API_ERROR: "Instagram رفض قراءة بيانات الحساب.",
  INSTAGRAM_ACCOUNT_NOT_FOUND: "لم نجد حساب Instagram احترافياً.",
  INSTAGRAM_SUBSCRIBE_ERROR: "تعذر تفعيل استقبال رسائل Instagram.",
  INSTAGRAM_PAGE_SUBSCRIBE_ERROR:
    "تعذر تفعيل Instagram عبر صفحة Facebook المرتبطة.",
  OAUTH_REPLAYED: "انتهت صلاحية رابط الربط. اضغط ربط من جديد.",
  MISSING_OAUTH_STATE: "انتهت جلسة الربط. ابدأ من جديد.",
  UNKNOWN: "حدث خطأ غير متوقع أثناء الربط.",
};

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cloudForm, setCloudForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [metaCapabilities, setMetaCapabilities] = useState<MetaCapabilities>();
  const [connecting, setConnecting] = useState<
    "meta" | "instagram" | "cloud" | "qr" | ""
  >("");

  const load = useCallback(async () => {
    try {
      const [result, capabilities] = await Promise.all([
        api.get<{ channels: Channel[] }>("/api/dashboard/channels"),
        api
          .get<MetaCapabilities>("/api/integrations/meta/status")
          .catch(() => undefined),
      ]);
      setChannels(result.channels);
      if (capabilities) setMetaCapabilities(capabilities);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta") === "connected") {
      const facebook = Number(params.get("facebook") ?? 0);
      const instagram = Number(params.get("instagram") ?? 0);
      setNotice(
        `تم الربط بنجاح: ${facebook} صفحة Facebook و${instagram} حساب Instagram.`,
      );
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("meta") === "error") {
      const reason = params.get("reason") ?? "UNKNOWN";
      setError(metaErrorMessage[reason] ?? metaErrorMessage.UNKNOWN);
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("instagram") === "connected") {
      setNotice("تم ربط Instagram مباشرة. شغّل فحص الجاهزية الآن.");
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("instagram") === "error") {
      const reason = params.get("reason") ?? "UNKNOWN";
      setError(metaErrorMessage[reason] ?? metaErrorMessage.UNKNOWN);
      window.history.replaceState({}, "", "/dashboard/channels/");
    }
  }, [load]);

  useEffect(() => {
    const shouldRefresh = channels.some(
      (channel) =>
        channel.status === "PENDING" ||
        channel.status === "ERROR" ||
        Boolean(channel.lastError),
    );
    if (!shouldRefresh) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [channels, load]);

  const grouped = useMemo(
    () => ({
      facebook: channels.filter((channel) => channel.type === "FACEBOOK"),
      instagram: channels.filter((channel) => channel.type === "INSTAGRAM"),
      whatsapp: channels.filter((channel) =>
        ["WHATSAPP_CLOUD", "WHATSAPP_BAILEYS"].includes(channel.type),
      ),
    }),
    [channels],
  );

  async function connectMeta() {
    setError("");
    setNotice("");
    setConnecting("meta");
    try {
      const { url } = await api.get<{ url: string }>(
        "/api/integrations/meta/start",
      );
      window.location.assign(url);
    } catch (reason) {
      setError((reason as Error).message);
      setConnecting("");
    }
  }

  async function connectInstagram() {
    setError("");
    setConnecting("instagram");
    try {
      const { url } = await api.get<{ url: string }>(
        "/api/integrations/instagram/start",
      );
      window.location.assign(url);
    } catch (reason) {
      setError((reason as Error).message);
      setConnecting("");
    }
  }

  async function saveCloud(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConnecting("cloud");
    try {
      await api.post(
        "/api/dashboard/channels/whatsapp/cloud",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      setCloudForm(false);
      setNotice("تم ربط WhatsApp Cloud API بنجاح.");
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setConnecting("");
    }
  }

  async function connectQr() {
    setError("");
    setConnecting("qr");
    try {
      await api.post("/api/dashboard/channels/whatsapp/baileys", {
        name: "WhatsApp QR",
      });
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setConnecting("");
    }
  }

  async function disconnect(id: string) {
    setError("");
    try {
      await api.post(`/api/dashboard/channels/${id}/disconnect`);
      setNotice("تم فصل القناة.");
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  function ChannelList({ accounts }: { accounts: Channel[] }) {
    if (!accounts.length)
      return (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-center text-xs text-slate-400">
          لا يوجد حساب مربوط بعد
        </p>
      );
    return (
      <div className="space-y-3">
        {accounts.map((channel) => (
          <div key={channel.id}>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
              <span
                className={`grid size-9 place-items-center rounded-xl ${channel.status === "CONNECTED" ? "bg-mint-50 text-mint-700" : "bg-amber-50 text-amber-700"}`}
              >
                {channel.status === "CONNECTED" ? (
                  <Wifi size={16} />
                ) : (
                  <CircleAlert size={16} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-xs text-slate-900">
                  {channel.name}
                </b>
                <span className="text-[10px] text-slate-400">
                  {statusLabel[channel.status]}
                </span>
                {channel.lastError && (
                  <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-amber-700">
                    {channel.lastError}
                  </span>
                )}
              </span>
              <button
                aria-label="فصل القناة"
                className="grid size-8 place-items-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                onClick={() => void disconnect(channel.id)}
                type="button"
              >
                <Unplug size={15} />
              </button>
            </div>
            {(channel.type === "INSTAGRAM" || channel.type === "FACEBOOK") && (
              <ChannelDoctor channel={channel} />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <Header
        eyebrow="ربط القنوات"
        title="وصّل Meta مرة واحدة وابدأ البيع"
        description="زر واحد يربط صفحة Facebook وحساب Instagram الاحترافي المرتبط بها، ثم AmiGo يفحص الاستقبال والإرسال تلقائياً."
      />

      {error && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
          <span className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 shrink-0" size={18} /> {error}
          </span>
          <button aria-label="إغلاق" onClick={() => setError("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-mint-100 bg-mint-50 p-4 text-sm font-bold text-mint-700">
          <span className="flex items-start gap-2">
            <Check className="mt-0.5 shrink-0" size={18} /> {notice}
          </span>
          <button aria-label="إغلاق" onClick={() => setNotice("")}>
            <X size={18} />
          </button>
        </div>
      )}

      <section className="relative mb-6 overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-mint-200">
              <Sparkles size={14} /> الإعداد الأسهل والأكثر استقراراً
            </span>
            <h2 className="mt-4 text-2xl font-black sm:text-3xl">
              Facebook + Instagram في موافقة واحدة
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
              سجّل بحساب يدير صفحة Facebook واختر الصفحة وحساب Instagram المرتبط.
              لا تحتاج نسخ توكنات ولا إعدادات تقنية لكل متجر.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-[11px] font-bold text-white/70">
              <span className="flex items-center gap-1.5"><Check size={14} className="text-mint-300" /> رسائل نصية</span>
              <span className="flex items-center gap-1.5"><Mic2 size={14} className="text-mint-300" /> فهم الرسائل الصوتية</span>
              <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-mint-300" /> OAuth رسمي وآمن</span>
            </div>
          </div>
          <button
            className="btn-primary min-w-56 !bg-white !text-slate-950 hover:!bg-mint-50"
            disabled={
              metaCapabilities?.configured === false || connecting === "meta"
            }
            onClick={() => void connectMeta()}
            type="button"
          >
            {connecting === "meta" ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <span className="flex items-center gap-1">
                <Facebook size={18} /> <Instagram size={18} />
              </span>
            )}
            {metaCapabilities?.configured === false
              ? "إعداد Meta غير مكتمل"
              : "ربط Meta الآن"}
          </button>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <article className="card bg-gradient-to-b from-blue-50 to-white p-6">
          <div className="flex items-center justify-between">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#1877f2] text-white"><Facebook size={24} /></span>
            <span className="badge bg-blue-50 text-blue-700">{grouped.facebook.length} حساب</span>
          </div>
          <h2 className="mt-5 font-black text-slate-950">Facebook Messenger</h2>
          <p className="mb-5 mt-2 text-xs leading-6 text-slate-500">الرسائل والردود والطلبات من صفحة المتجر.</p>
          <ChannelList accounts={grouped.facebook} />
        </article>

        <article className="card bg-gradient-to-b from-pink-50 to-white p-6">
          <div className="flex items-center justify-between">
            <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-pink-500 to-amber-400 text-white"><Instagram size={24} /></span>
            <span className="badge bg-pink-50 text-pink-700">{grouped.instagram.length} حساب</span>
          </div>
          <h2 className="mt-5 font-black text-slate-950">Instagram Business</h2>
          <p className="mb-5 mt-2 text-xs leading-6 text-slate-500">يفهم النص والصوت والدارجة ويرد من الحساب الاحترافي.</p>
          <ChannelList accounts={grouped.instagram} />
          {metaCapabilities?.directInstagramEnabled && (
            <button
              className="mt-4 w-full text-xs font-bold text-pink-700 underline decoration-pink-200 underline-offset-4"
              disabled={connecting === "instagram"}
              onClick={() => void connectInstagram()}
              type="button"
            >
              {connecting === "instagram" ? "جاري الفتح…" : "الربط المباشر كخيار احتياطي"}
            </button>
          )}
        </article>

        <article className="card bg-gradient-to-b from-emerald-50 to-white p-6">
          <div className="flex items-center justify-between">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#25d366] text-white"><MessageCircle size={24} /></span>
            <span className="badge bg-emerald-50 text-emerald-700">{grouped.whatsapp.length} حساب</span>
          </div>
          <h2 className="mt-5 font-black text-slate-950">WhatsApp Business</h2>
          <p className="mb-5 mt-2 text-xs leading-6 text-slate-500">Cloud API الرسمي للعمل المستمر على الاستضافة.</p>
          <ChannelList accounts={grouped.whatsapp} />
          <button className="btn-secondary mt-4 w-full" onClick={() => setCloudForm(true)} type="button"><Plus size={18} /> ربط WhatsApp</button>
        </article>
      </section>

      <button
        className="mx-auto mt-5 block text-xs font-bold text-slate-400 underline underline-offset-4"
        onClick={() => setShowAdvanced((value) => !value)}
        type="button"
      >
        {showAdvanced ? "إخفاء المعلومات التقنية" : "عرض حالة إعداد المنصة"}
      </button>
      {showAdvanced && (
        <aside className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 text-xs leading-6 text-slate-600">
          <b className="text-slate-900">حالة الربط:</b>{" "}
          Meta {metaCapabilities?.configured ? "جاهز" : "غير مضبوط"} · Business Login {metaCapabilities?.businessLoginConfigured ? "جاهز" : "يحتاج Config ID"} · Instagram مباشر {metaCapabilities?.directInstagramEnabled ? "جاهز" : "غير مفعّل"}.
        </aside>
      )}

      {cloudForm && (
        <section className="card mt-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-black text-slate-950">ربط WhatsApp Cloud API</h2>
              <p className="mt-1 text-xs text-slate-400">أدخل البيانات من لوحة Meta for Developers</p>
            </div>
            <button aria-label="إغلاق" className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500" onClick={() => setCloudForm(false)} type="button"><X size={18} /></button>
          </div>
          <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={saveCloud}>
            {[
              ["name", "اسم القناة", "متجر AmiGo"],
              ["phoneNumberId", "Phone Number ID", "مثال: 1023456789"],
              ["wabaId", "WhatsApp Business Account ID", "WABA ID"],
              ["accessToken", "Permanent Access Token", "لن يظهر بعد الحفظ"],
            ].map(([name, label, placeholder]) => (
              <label key={name}>
                <span className="label">{label}</span>
                <input autoComplete="off" className="field" name={name} placeholder={placeholder} required type={name === "accessToken" ? "password" : "text"} />
              </label>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className="btn-primary" disabled={connecting === "cloud"}>
                {connecting === "cloud" ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />} حفظ وربط القناة
              </button>
              {baileysEnabled && (
                <button className="btn-secondary" disabled={connecting === "qr"} onClick={() => void connectQr()} type="button"><QrCode size={18} /> الربط عبر QR</button>
              )}
            </div>
          </form>
        </section>
      )}

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="animate-spin" size={18} /> جاري تحميل القنوات…</div>
      )}

      <aside className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} />
        <p><b>للعمل مع زبائن حقيقيين، يجب أن يكون تطبيق Meta في وضع Live وتكون صلاحيات الرسائل معتمدة.</b> بعد الربط شغّل «فحص الجاهزية» لكل حساب.</p>
      </aside>
    </>
  );
}
