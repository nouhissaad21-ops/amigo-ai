"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  MessageCircleMore,
  Settings2,
  ShoppingBag,
} from "lucide-react";
import { api } from "@/lib/api";
import { Logo } from "./ui";
const links = [
  ["/dashboard", "نظرة عامة", LayoutDashboard],
  ["/dashboard/channels", "القنوات", MessageCircleMore],
  ["/dashboard/catalog", "الكتالوج", Boxes],
  ["/dashboard/orders", "الطلبيات", ShoppingBag],
  ["/dashboard/settings", "القواعد والتوصيل", Settings2],
] as const;
export function Sidebar() {
  const p = usePathname(),
    r = useRouter();
  return (
    <>
      <aside className="fixed inset-y-0 right-0 hidden w-72 flex-col border-l border-black/5 bg-white p-6 lg:flex">
        <Logo />
        <nav className="mt-10 space-y-2">
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${p === href || (href !== "/dashboard" && p.startsWith(href)) ? "bg-mint-50 text-mint-700" : "text-black/55"}`}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <button
          className="mt-auto flex gap-3 p-4 text-red-600"
          onClick={async () => {
            await api.post("/api/auth/logout");
            r.replace("/login");
          }}
        >
          <LogOut />
          خروج
        </button>
      </aside>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-3xl bg-white p-2 shadow-card lg:hidden">
        {links.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center text-[10px] font-bold text-black/50"
          >
            <Icon size={19} />
            {label.split(" ")[0]}
          </Link>
        ))}
      </nav>
    </>
  );
}
