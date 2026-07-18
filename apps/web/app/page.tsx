import Link from "next/link";
import { Bot, MessageCircleMore, ShoppingBag, Sparkles } from "lucide-react";
import { Logo } from "@/components/ui";

const features = [
  [MessageCircleMore, "ردود بالدارجة", "أسلوب دافئ ومقنع"],
  [ShoppingBag, "قنص الطلبيات", "الاسم والهاتف والموقع"],
  [Bot, "كتالوج مضبوط", "بلا أسعار ولا منتجات مخترعة"],
  [Sparkles, "لوحة واحدة", "منتجات، قنوات وطلبات"],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f8faf9]">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex gap-3">
          <Link className="btn-secondary" href="/login">
            دخول
          </Link>
          <Link className="btn-primary" href="/register">
            افتح متجرك
          </Link>
        </div>
      </nav>
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <span className="badge bg-mint-50 px-4 py-2 text-mint-700">
            <Sparkles className="size-4" /> ذكاء اصطناعي يفهم الدارجة
          </span>
          <h1 className="mt-6 text-5xl font-black leading-tight sm:text-6xl">
            خلي رسائل الزبائن تولّي طلبيات.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-black/55">
            AmiGo AI يجاوب زبائن متجرك، يلتزم بالكتالوج والأسعار، ويجمع الطلبية
            تلقائياً من Facebook وInstagram وWhatsApp.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn-primary" href="/register">
              ابدأ مجاناً
            </Link>
            <Link className="btn-secondary" href="/login">
              عندي حساب
            </Link>
          </div>
        </div>
        <div className="card relative grid gap-4 p-6 sm:grid-cols-2">
          {features.map(([Icon, title, text]) => (
            <article className="rounded-2xl bg-white p-5 shadow-sm" key={title}>
              <Icon className="text-mint-600" />
              <h2 className="mt-5 font-black">{title}</h2>
              <p className="mt-1 text-sm text-black/45">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
