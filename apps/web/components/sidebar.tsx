"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  MessageCircleMore,
  Settings2,
  ShieldCheck,
  ShoppingBag,
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
      <aside className="fixed inset-y-0 right-0 hidden w-72 flex-col border-l border-black/5 bg-white p-6 lg:flex">
        <Logo />
        <nav className="mt-10 space-y-2">
          {links.map(([href, label, Icon]) => {
            const normalized = href.replace(/\/$/, "");
            const active =
              pathname === normalized ||
              pathname === href ||
              (normalized !== "/dashboard" &&
                pathname.startsWith(normalized + "/"));
            return (
              <Link
                key={href}
                href={href}
                className={
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold " +
                  (active
                    ? "bg-mint-50 text-mint-700"
                    : "text-black/55")
                }
              >
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
        <button className="mt-auto flex gap-3 p-4 text-red-600" onClick={logout}>
          <LogOut />
          خروج
        </button>
      </aside>

      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around overflow-x-auto rounded-3xl bg-white p-2 shadow-card lg:hidden">
        {links.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            className="flex min-w-14 flex-col items-center text-[10px] font-bold text-black/50"
          >
            <Icon size={19} />
            {label.split(" ")[0]}
          </Link>
        ))}
      </nav>
    </>
  );
}
