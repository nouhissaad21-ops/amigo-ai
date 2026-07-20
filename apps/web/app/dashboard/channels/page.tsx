"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Facebook,
  Instagram,
  Loader2,
  MessageCircle,
  Plus,
  QrCode,
  ShieldCheck,
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
  CONNECTED: "مربوط",
  PENDING: "قيد الربط",
  DISCONNECTED: "غير مربوط",
  ERROR: "يحتاج تدخّل",
};

type MetaCapabilities = {
  configured: boolean;
  instagramEnabled: boolean;
};

type ProviderCard = {
  key: "facebook" | "instagram" | "whatsapp";
  title: string;
  description: string;
  icon: typeof Facebook;
  iconClass: string;
  tint: string;
  accounts: Channel[];
  action: () => void | Promise<void>;
  actionLabel: string;
  disabled: boolean;
  note: string;
};

const metaErrorMessage: Record<string, string> = {
  META_NOT_CONFIGURED:
    "إعداد Meta غير مكتمل عند مالك المنصة. يلزم App ID وApp Secret مرة واحدة فقط.",
  META_OAUTH_DENIED: "تم إلغاء ربط Facebook قبل منح الصلاحيات.",
  META_CODE_EXCHANGE_FAILED:
    "Meta رفضت إكمال جلسة الربط. أعد المحاولة من حساب يدير الصفحة.",
  META_LONG_TOKEN_FAILED: "تعذر إنشاء رمز وصول طويل المدة.",
  META_API_ERROR: "Meta لم تسمح بقراءة الصفحات لهذا الحساب.",
  META_NO_PAGES:
    "لم نجد صفحة Facebook يديرها هذا الحساب. تأكد أنك مسؤول في الصفحة ثم أعد المحاولة.",
  META_SUBSCRIBE_ERROR:
    "تم العثور على الصفحة لكن Meta رفضت تفعيل استقبال الرسائل. راجع صلاحية pages_messaging وWebhook في تطبيق Meta.",
  INSTAGRAM_NOT_CONFIGURED: "إعداد Instagram غير مكتمل في تطبيق Meta.",
  INSTAGRAM_OAUTH_DENIED: "تم إلغاء ربط Instagram قبل منح الصلاحيات.",
  INSTAGRAM_CODE_EXCHANGE_FAILED: "Instagram رفضت إكمال جلسة الربط.",
  INSTAGRAM_LONG_TOKEN_FAILED: "تعذر إنشاء رمز Instagram طويل المدة.",
  INSTAGRAM_API_ERROR: "Instagram رفضت قراءة بيانات الحساب.",
  INSTAGRAM_ACCOUNT_NOT_FOUND: "لم نجد حساب Instagram احترافياً لهذا المستخدم.",
  INSTAGRAM_SUBSCRIBE_ERROR:
    "تم العثور على Instagram لكن تعذر تفعيل استقبال الرسائل.",
  INSTAGRAM_PAGE_SUBSCRIBE_ERROR:
    "تعذر تفعيل استقبال Instagram عبر صفحة Facebook المرتبطة.",
  OAUTH_REPLAYED: "انتهت صلاحية رابط الربط. اضغط ربط من جديد.",
  MISSING_OAUTH_STATE: "انتهت أو تعطلت جلسة الربط. ابدأ الربط من جديد.",
  UNKNOWN: "حدث خطأ غير متوقع أثناء الربط.",
};

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [cloudForm, setCloudForm] = useState(false);
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
      setNotice(`تم ربط Facebook بنجاح: ${facebook} صفحة.`);
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("meta") === "error") {
      const reason = params.get("reason") ?? "UNKNOWN";
      setError(metaErrorMessage[reason] ?? "حدث خطأ غير متوقع أثناء ربط Meta.");
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("instagram") === "connected") {
      setNotice(
        "تم ربط Instagram. شغّل تشخيص القناة للتأكد من استقبال الرسائل قبل فتحها للزبائن.",
      );
      window.history.replaceState({}, "", "/dashboard/channels/");
    } else if (params.get("instagram") === "error") {
      const reason = params.get("reason") ?? "UNKNOWN";
      setError(
        metaErrorMessage[reason] ?? "حدث خطأ غير متوقع أثناء ربط Instagram.",
      );
      window.history.replaceState({}, "", "/dashboard/channels/");
    }
  }, [load]);

  useEffect(() => {
    const shouldRefresh = channels.some(
      (channel) =>
        (channel.type === "WHATSAPP_BAILEYS" && channel.status === "PENDING") ||
        (channel.type === "INSTAGRAM" && Boolean(channel.lastError)),
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

  const providers: ProviderCard[] = [
    {
      key: "facebook",
      title: "Facebook Messenger",
      description: "استقبل رسائل الصفحة ورد على الزبائن تلقائياً.",
      icon: Facebook,
      iconClass: "bg-[#1877f2] text-white",
      tint: "from-blue-50 to-white",
      accounts: grouped.facebook,
      action: connectMeta,
      actionLabel:
        metaCapabilities?.configured === false
          ? "إعداد Meta غير مكتمل"
          : "ربط Facebook",
      disabled: metaCapabilities?.configured === false,
      note: "التاجر يوافق مرة واحدة من نافذة Meta الرسمية.",
    },
    {
      key: "instagram",
      title: "Instagram Business",
      description:
        "استقبل رسائل الحساب الاحترافي، افحص الصلاحيات، ورد عبر Webhook أو مزامنة الصندوق الاحتياطية.",
      icon: Instagram,
      iconClass:
        "bg-gradient-to-br from-violet-600 via-pink-500 to-amber-400 text-white",
      tint: "from-pink-50 to-white",
      accounts: grouped.instagram,
      action: connectInstagram,
      actionLabel: metaCapabilities?.instagramEnabled
        ? "ربط Instagram"
        : "بانتظار تفعيل Instagram",
      disabled: !metaCapabilities?.instagramEnabled,
      note: metaCapabilities?.instagramEnabled
        ? "للحسابات خارج فريق التطبيق يلزم App Live وAdvanced Access لصلاحية الرسائل."
        : "مالك المنصة يفعّل Instagram API مرة واحدة؛ بعدها التاجر يربطه بضغطة.",
    },
    {
      key: "whatsapp",
      title: "WhatsApp Business",
      description: "الربط الرسمي والآمن عبر WhatsApp Cloud API.",
      icon: MessageCircle,
      iconClass: "bg-[#25d366] text-white",
      tint: "from-emerald-50 to-white",
      accounts: grouped.whatsapp,
      action: () => setCloudForm(true),
      actionLabel: "ربط WhatsApp",
      disabled: false,
      note: "Cloud API الرسمي مناسب للاستضافة ويعمل دون إبقاء هاتف مفتوح.",
    },
  ];

  return (
    <>
      <Header
        eyebrow="مركز القنوات"
        title="اربط منصاتك وراقب جاهزيتها"
        description="الربط وحده لا يكفي: AmiGo يفحص Webhook والتوكن والرسائل والإرسال قبل استقبال الزبائن."
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

      <section className="card mb-5 overflow-hidden p-1">
        <div className="grid gap-1 rounded-[1.4rem] bg-slate-50 p-3 sm:grid-cols-3">
          {[
            ["1", "اربط القناة", "تسجيل رسمي وآمن لدى المنصة"],
            ["2", "افحص الجاهزية", "توكن، Webhook، صندوق الرسائل والإرسال"],
            ["3", "ابدأ الأتمتة", "راقب الرسائل والطلبات من AmiGo"],
          ].map(([number, title, description]) => (
            <div
              className="flex items-center gap-3 rounded-2xl bg-white p-4"
              key={number}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">
                {number}
              </span>
              <div>
                <b className="block text-sm text-slate-900">{title}</b>
                <span className="mt-1 block text-[11px] text-slate-400">
                  {description}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        {providers.map((provider) => {
          const connected = provider.accounts.filter(
            (channel) => channel.status === "CONNECTED",
          ).length;
          const Icon = provider.icon;
          const providerLoading =
            (provider.key === "facebook" && connecting === "meta") ||
            (provider.key === "instagram" && connecting === "instagram");
          return (
            <article
              className={`card relative overflow-hidden bg-gradient-to-b ${provider.tint} p-6`}
              key={provider.key}
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  className={`grid size-12 place-items-center rounded-2xl shadow-sm ${provider.iconClass}`}
                >
                  <Icon size={25} />
                </span>
                <span
                  className={`badge gap-1.5 ${connected ? "bg-mint-50 text-mint-700" : "bg-slate-100 text-slate-500"}`}
                >
                  <span
                    className={`size-2 rounded-full ${connected ? "bg-mint-500" : "bg-slate-300"}`}
                  />
                  {connected ? `${connected} مربوط` : "غير مربوط"}
                </span>
              </div>
              <h2 className="mt-6 text-lg font-black text-slate-950">
                {provider.title}
              </h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">
                {provider.description}
              </p>
              <p className="mt-3 min-h-10 rounded-2xl bg-white/70 px-3 py-2 text-[10px] font-bold leading-5 text-slate-500">
                {provider.note}
              </p>

              <div className="mt-5 space-y-3">
                {provider.accounts.slice(0, 4).map((channel) => (
                  <div key={channel.id}>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/85 p-3">
                      <span
                        className={`grid size-8 place-items-center rounded-xl ${channel.status === "CONNECTED" ? "bg-mint-50 text-mint-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        {channel.status === "CONNECTED" ? (
                          <Wifi size={15} />
                        ) : (
                          <CircleAlert size={15} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-xs text-slate-800">
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
                    {(channel.type === "INSTAGRAM" ||
                      channel.type === "FACEBOOK") && (
                      <ChannelDoctor channel={channel} />
                    )}
                  </div>
                ))}
              </div>

              <button
                className={
                  connected
                    ? "btn-secondary mt-5 w-full"
                    : "btn-primary mt-5 w-full"
                }
                disabled={
                  provider.disabled ||
                  connecting === "meta" ||
                  connecting === "instagram"
                }
                onClick={() => void provider.action()}
                type="button"
              >
                {providerLoading ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {connected ? "إضافة حساب آخر" : provider.actionLabel}
              </button>
            </article>
          );
        })}
      </section>

      {cloudForm && (
        <section className="card mt-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-black text-slate-950">
                ربط WhatsApp Cloud API
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                أدخل البيانات من لوحة Meta for Developers
              </p>
            </div>
            <button
              aria-label="إغلاق"
              className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500"
              onClick={() => setCloudForm(false)}
              type="button"
            >
              <X size={18} />
            </button>
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
                <input
                  autoComplete="off"
                  className="field"
                  name={name}
                  placeholder={placeholder}
                  required
                  type={name === "accessToken" ? "password" : "text"}
                />
              </label>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className="btn-primary" disabled={connecting === "cloud"}>
                {connecting === "cloud" ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
                حفظ وربط القناة
              </button>
              {baileysEnabled && (
                <button
                  className="btn-secondary"
                  disabled={connecting === "qr"}
                  onClick={() => void connectQr()}
                  type="button"
                >
                  <QrCode size={18} /> الربط عبر QR
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={18} /> جاري تحميل القنوات…
        </div>
      )}

      <aside className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} />
        <p>
          <b>جاهزية الإنتاج تُقاس بالرسائل، وليس بظهور كلمة مربوط.</b> شغّل
          «تشخيص القناة» بعد كل ربط. حسابات Instagram خارج فريق تطبيق Meta تحتاج
          الموافقة على صلاحية الرسائل قبل أن تصل رسائل الزبائن العاديين.
        </p>
      </aside>
    </>
  );
}
