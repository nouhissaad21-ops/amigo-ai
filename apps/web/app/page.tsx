import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  Check,
  Facebook,
  Instagram,
  MessageCircleMore,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  WandSparkles,
} from "lucide-react";
import { Logo } from "@/components/ui";

const benefits = [
  {
    icon: MessageCircleMore,
    title: "يرد بالدارجة الجزائرية",
    text: "محادثات طبيعية، دافئة ومقنعة بلا ردود آلية باردة.",
    tone: "bg-blue-50 text-blue-700",
  },
  {
    icon: Boxes,
    title: "ملتزم بكتالوجك",
    text: "لا يخترع منتجاً ولا سعراً، ويراعي المخزون والعروض والمتغيرات.",
    tone: "bg-violet-50 text-violet-700",
  },
  {
    icon: ShoppingBag,
    title: "يحوّل الحوار إلى طلبية",
    text: "يجمع الاسم والهاتف والولاية والبلدية ثم يحفظ الطلب فوراً.",
    tone: "bg-amber-50 text-amber-700",
  },
  {
    icon: ShieldCheck,
    title: "كل متجر معزول وآمن",
    text: "بيانات كل تاجر وقنواته وطلباته مفصولة ومحمية.",
    tone: "bg-mint-50 text-mint-700",
  },
] as const;

const steps = [
  ["01", "أنشئ متجرك", "أضف معلومات النشاط والكتالوج وأسعار التوصيل."],
  ["02", "اربط قنواتك", "Facebook وInstagram وWhatsApp من مركز واحد."],
  ["03", "خلي AmiGo يخدم", "المساعد يرد، يقترح ويحفظ الطلبيات تلقائياً."],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f8faf9]">
      <nav className="relative z-30 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-3">
          <Link className="btn-secondary !px-3 sm:!px-4" href="/login/">
            دخول
          </Link>
          <Link className="btn-primary !px-3 sm:!px-4" href="/register/">
            ابدأ مجاناً
          </Link>
        </div>
      </nav>

      <section className="landing-hero relative">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1fr_.95fr] lg:pb-28 lg:pt-20">
          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-mint-100 bg-white/85 px-4 py-2 text-xs font-black text-mint-700 shadow-sm backdrop-blur">
              <Sparkles size={15} /> مساعد مبيعات يفهم الزبون الجزائري
            </span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.22] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              كل رسالة تقدر تولّي
              <span className="block bg-gradient-to-l from-mint-700 via-mint-500 to-cyan-500 bg-clip-text text-transparent">
                طلبية حقيقية.
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-500 sm:text-lg">
              AmiGo AI يجاوب زبائن متجرك بالدارجة، يبيع من الكتالوج الحقيقي،
              يجمع معلومات الطلبية وينظمها في لوحة واحدة.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary !px-6 !py-3.5" href="/register/">
                افتح متجرك الآن <ArrowLeft size={18} />
              </Link>
              <a className="btn-secondary !px-6 !py-3.5" href="#how-it-works">
                كيفاش يخدم؟
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-slate-500">
              {["تجربة مجانية", "بلا بطاقة بنكية", "إعداد بسيط"].map((item) => (
                <span className="flex items-center gap-1.5" key={item}>
                  <Check className="text-mint-600" size={15} /> {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative z-10 mx-auto w-full max-w-xl">
            <div className="pointer-events-none absolute -inset-8 rounded-full bg-mint-300/20 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 p-4 shadow-[0_35px_90px_rgba(15,23,42,.18)] backdrop-blur sm:p-5">
              <div className="flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-mint-500 font-black">
                    A
                  </span>
                  <div>
                    <b className="block text-xs">AmiGo Dashboard</b>
                    <span className="text-[10px] text-white/45">
                      متجرك مباشر
                    </span>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-mint-300">
                  <span className="size-2 rounded-full bg-mint-400" /> يعمل الآن
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {(
                  [
                    ["طلبات اليوم", "12", ShoppingBag],
                    ["قنوات مربوطة", "3", MessageCircleMore],
                    ["منتجات نشطة", "48", Boxes],
                  ] as const
                ).map(([label, value, Icon]) => (
                  <div
                    className="rounded-2xl bg-slate-50 p-3"
                    key={String(label)}
                  >
                    <Icon className="text-mint-600" size={17} />
                    <b className="mt-3 block text-xl text-slate-950">{value}</b>
                    <span className="text-[9px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1.15fr_.85fr]">
                <div className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between">
                    <b className="text-xs text-slate-800">آخر طلبية</b>
                    <span className="badge bg-mint-50 text-mint-700">
                      جديدة
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                      <PackageCheck size={19} />
                    </span>
                    <div>
                      <b className="block text-xs">سارة — الجزائر</b>
                      <span className="text-[10px] text-slate-400">
                        2 منتجات · الدفع عند الاستلام
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-mint-600 to-cyan-600 p-4 text-white">
                  <WandSparkles size={19} />
                  <b className="mt-3 block text-sm">المساعد حاضر</b>
                  <span className="mt-1 block text-[10px] leading-5 text-white/65">
                    يرد على القنوات المربوطة تلقائياً
                  </span>
                </div>
              </div>
              <p className="mt-3 text-center text-[9px] font-bold text-slate-300">
                معاينة توضيحية للوحة التحكم
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-100 bg-white/75">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-5 py-7 sm:px-8 lg:flex-row">
          <p className="text-center text-sm font-black text-slate-500 lg:text-right">
            قناة واحدة أو كامل قنواتك — نفس المساعد ونفس الكتالوج
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              [Facebook, "Facebook", "text-[#1877f2]"],
              [Instagram, "Instagram", "text-pink-600"],
              [MessageCircleMore, "WhatsApp", "text-[#25d366]"],
            ].map(([Icon, label, color]) => (
              <span
                className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm"
                key={String(label)}
              >
                <Icon className={String(color)} size={17} /> {String(label)}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-black uppercase tracking-[.2em] text-mint-600">
            مبني للتجارة الجزائرية
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
            مش مجرد بوت يجاوب.
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-500 sm:text-base">
            AmiGo يعرف منتجاتك وقوانينك وأسعار التوصيل، ويخدم كأنه عضو في فريق
            المبيعات.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map(({ icon: Icon, title, text, tone }) => (
            <article className="card metric-card p-6" key={title}>
              <span
                className={`grid size-12 place-items-center rounded-2xl ${tone}`}
              >
                <Icon size={22} />
              </span>
              <h3 className="mt-5 font-black text-slate-950">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-500">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="bg-slate-950 py-20 text-white lg:py-28"
        id="how-it-works"
      >
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
          <div>
            <span className="text-xs font-black uppercase tracking-[.2em] text-mint-300">
              من الصفر إلى أول طلبية
            </span>
            <h2 className="mt-4 text-3xl font-black leading-tight sm:text-5xl">
              إعداد واضح، وبعدها الخدمة تمشي وحدها.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-8 text-white/50">
              الإعداد التقني الثقيل يتم مرة واحدة من طرف المنصة. التاجر يفتح
              حسابه، يربط قناته بالموافقة الرسمية ويبدأ مباشرة.
            </p>
          </div>
          <div className="space-y-3">
            {steps.map(([number, title, text]) => (
              <article
                className="flex items-start gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6"
                key={number}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-500 text-sm font-black">
                  {number}
                </span>
                <div>
                  <h3 className="font-black">{title}</h3>
                  <p className="mt-2 text-sm leading-7 text-white/45">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="overflow-hidden rounded-[2rem] bg-gradient-to-l from-mint-700 to-cyan-700 p-7 text-white shadow-2xl shadow-mint-900/20 sm:p-12 lg:flex lg:items-center lg:justify-between">
          <div>
            <span className="flex items-center gap-2 text-xs font-black text-white/70">
              <Store size={17} /> جاهز تطور خدمة الزبائن؟
            </span>
            <h2 className="mt-4 text-3xl font-black sm:text-5xl">
              افتح متجرك وخلي AmiGo يبدأ الخدمة.
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/65">
              جرّب المنصة، أضف كتالوجك واربط أول قناة.
            </p>
          </div>
          <Link
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-black text-slate-950 shadow-lg transition hover:-translate-y-0.5 lg:mt-0"
            href="/register/"
          >
            ابدأ الآن <ArrowLeft size={18} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 sm:px-8 md:flex-row">
          <Logo />
          <p className="text-center text-xs text-slate-400">
            © 2026 AmiGo AI — منصة أتمتة المبيعات للمتاجر الجزائرية.
          </p>
        </div>
      </footer>
    </main>
  );
}
