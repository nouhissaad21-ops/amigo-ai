"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Crown,
  LayoutDashboard,
  LogOut,
  MessageCircleMore,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { Logo } from "./ui";

type NavItem = readonly [string, string, LucideIcon];
type Me = { user: { platformRole: "USER" | "SUPER_ADMIN" } };

const merchantLinks: NavItem[] = [
  ["/dashboard/", "نظرة عامة", LayoutDashboard],
  ["/dashboard/channels/", "القنوات", MessageCircleMore],
  ["/dashboard/catalog/", "الكتالوج", Boxes],
  ["/dashboard/orders/", "الطلبيات", ShoppingBag],
  ["/dashboard/settings/", "القواعد والتوصيل", Settings2],
];

function isActive(pathname: string, href: string) {
  const normalized = href.replace(/\/$/, "");
  return (
    pathname === normalized ||
    pathname === href ||
    (normalized !== "/dashboard" && pathname.startsWith(normalized + "/"))
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    api
      .get<Me>("/api/auth/me")
      .then((result) =>
        setIsPlatformAdmin(result.user.platformRole === "SUPER_ADMIN"),
      )
      .catch(() => undefined);
  }, []);

  const links: NavItem[] = isPlatformAdmin
    ? [...merchantLinks, ["/admin/", "إدارة المنصة", ShieldCheck]]
    : merchantLinks;

  async function logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    window.location.assign("/login/");
  }

  return (
    <>
      <aside className="sidebar-surface fixed inset-y-0 right-0 z-40 hidden w-72 flex-col overflow-hidden p-6 text-white lg:flex">
        <div className="pointer-events-none absolute -left-20 top-12 size-56 rounded-full bg-mint-500/10 blur-3xl" />
        <div className="relative z-10">
          <Logo inverse />
          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 p-3">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950">
              <Crown size={18} />
            </span>
            <div>
              <b className="block text-xs">خطة الانطلاق</b>
              <span className="text-[10px] text-white/40">
                كل أدوات متجرك في مكان واحد
              </span>
            </div>
          </div>
        </div>

        <nav className="relative z-10 mt-7 space-y-1.5">
          <p className="mb-3 px-3 text-[10px] font-black uppercase tracking-[.2em] text-white/30">
            لوحة التحكم
          </p>
          {links.map(([href, label, Icon]) => {
            const active = isActive(pathname, href);
            return (
              <Link
                className={
                  "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition " +
                  (active
                    ? "bg-gradient-to-l from-mint-600 to-cyan-600 text-white shadow-lg shadow-mint-950/20"
                    : "text-white/55 hover:bg-white/5 hover:text-white")
                }
                href={href}
                key={href}
              >
                <Icon
                  className={
                    active
                      ? "text-white"
                      : "text-white/40 group-hover:text-mint-300"
                  }
                  size={19}
                />
                {label}
                {active && (
                  <span className="mr-auto size-1.5 rounded-full bg-white" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="relative z-10 mt-auto">
          <div className="mb-3 rounded-2xl border border-mint-300/10 bg-mint-500/10 p-4">
            <Sparkles className="text-mint-300" size={18} />
            <b className="mt-3 block text-xs">AmiGo حاضر للخدمة</b>
            <p className="mt-1 text-[10px] leading-5 text-white/40">
              راقب القنوات والطلبيات من هذه اللوحة.
            </p>
          </div>
          <button
            className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-red-300 transition hover:bg-red-500/10"
            onClick={logout}
          >
            <LogOut size={18} /> خروج
          </button>
        </div>
      </aside>

      <nav className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-around overflow-x-auto rounded-[1.4rem] border border-white/70 bg-white/95 p-2 shadow-2xl shadow-slate-900/15 backdrop-blur-xl lg:hidden">
        {links.slice(0, 5).map(([href, label, Icon]) => {
          const active = isActive(pathname, href);
          return (
            <Link
              className={
                "flex min-w-14 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[9px] font-black transition " +
                (active ? "bg-mint-50 text-mint-700" : "text-slate-400")
              }
              href={href}
              key={href}
            >
              <Icon size={19} />
              {label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
