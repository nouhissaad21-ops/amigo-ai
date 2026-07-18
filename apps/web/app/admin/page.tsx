"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  LogOut,
  Power,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";
import { Header, Logo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type StoreItem = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  subscription: {
    plan: string;
    status: string;
    currentPeriodEnd: string;
  } | null;
  memberships: Array<{
    user: {
      id: string;
      fullName: string;
      email: string;
      status: string;
    };
  }>;
  _count: {
    memberships: number;
    products: number;
    channels: number;
    orders: number;
  };
};

type UserItem = {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "SUSPENDED";
  platformRole: "USER" | "SUPER_ADMIN";
  createdAt: string;
  memberships: Array<{
    role: string;
    store: { id: string; name: string; isActive: boolean };
  }>;
};

type Overview = {
  stats: {
    users: number;
    stores: number;
    activeStores: number;
    suspendedUsers: number;
    orders: number;
    revenue: string;
  };
  stores: StoreItem[];
  users: UserItem[];
};

export default function PlatformAdminPage() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setError("");
      setOverview(await api.get<Overview>("/api/admin/overview"));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        window.location.assign("/login/");
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل لوحة إدارة المنصة",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setStoreStatus(store: StoreItem) {
    setBusy("store:" + store.id);
    try {
      await api.patch("/api/admin/stores/" + store.id + "/status", {
        isActive: !store.isActive,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل تحديث المتجر");
    } finally {
      setBusy("");
    }
  }

  async function setUserStatus(user: UserItem) {
    setBusy("user:" + user.id);
    try {
      await api.patch("/api/admin/users/" + user.id + "/status", {
        status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "فشل تحديث المستخدم");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    window.location.assign("/login/");
  }

  const cards = overview
    ? [
        ["المتاجر", overview.stats.stores, Building2],
        ["المتاجر النشطة", overview.stats.activeStores, Power],
        ["المستخدمون", overview.stats.users, Users],
        ["كل الطلبيات", overview.stats.orders, ShoppingBag],
      ]
    : [];

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <div className="flex gap-2">
            <Link className="btn-secondary" href="/dashboard/">
              لوحة متجري
            </Link>
            <button className="btn-danger" onClick={logout}>
              <LogOut size={17} />
              خروج
            </button>
          </div>
        </nav>

        <Header
          title="لوحة رئيس AmiGo AI"
          description="إدارة المتاجر والمستخدمين ومتابعة المنصة كاملة."
          actions={
            <span className="badge bg-mint-100 text-mint-800">
              <ShieldCheck className="ml-1" size={16} />
              Super Admin
            </span>
          }
        />

        {error && (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-red-700" role="alert">
            {error}
          </div>
        )}

        {!overview && !error && (
          <div className="card p-8 text-center">جاري تحميل لوحة الرئيس...</div>
        )}

        {overview && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map(([label, value, Icon]) => {
                const CardIcon = Icon as typeof Building2;
                return (
                  <article className="card p-5" key={String(label)}>
                    <CardIcon className="text-mint-600" />
                    <p className="mt-4 text-sm text-black/45">{String(label)}</p>
                    <p className="text-3xl font-black">{String(value)}</p>
                  </article>
                );
              })}
            </section>

            <section className="card mt-6 overflow-hidden">
              <div className="border-b border-black/5 p-5">
                <h2 className="text-xl font-black">المتاجر</h2>
                <p className="text-sm text-black/45">
                  تفعيل وإيقاف المتاجر ومتابعة استعمالها.
                </p>
              </div>
              <div className="divide-y divide-black/5">
                {overview.stores.map((store) => (
                  <article
                    className="grid gap-4 p-5 md:grid-cols-[1.5fr_1fr_auto] md:items-center"
                    key={store.id}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black">{store.name}</h3>
                        <span
                          className={
                            "badge " +
                            (store.isActive
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-700")
                          }
                        >
                          {store.isActive ? "نشط" : "متوقف"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-black/45">
                        {store.memberships[0]?.user.fullName ?? "بدون مالك"} ·{" "}
                        {store.memberships[0]?.user.email ?? "—"}
                      </p>
                    </div>
                    <div className="text-sm text-black/55">
                      <p>
                        {store._count.products} منتج · {store._count.orders} طلبية
                      </p>
                      <p>
                        {store.subscription?.plan ?? "—"} ·{" "}
                        {store.subscription?.status ?? "—"}
                      </p>
                    </div>
                    <button
                      className={store.isActive ? "btn-danger" : "btn-primary"}
                      disabled={busy === "store:" + store.id}
                      onClick={() => void setStoreStatus(store)}
                    >
                      <Power size={16} />
                      {store.isActive ? "إيقاف" : "تفعيل"}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="card mt-6 overflow-hidden">
              <div className="border-b border-black/5 p-5">
                <h2 className="text-xl font-black">المستخدمون</h2>
                <p className="text-sm text-black/45">
                  حسابات التجار وصلاحياتهم على المنصة.
                </p>
              </div>
              <div className="divide-y divide-black/5">
                {overview.users.map((user) => (
                  <article
                    className="grid gap-4 p-5 md:grid-cols-[1.5fr_1fr_auto] md:items-center"
                    key={user.id}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black">{user.fullName}</h3>
                        {user.platformRole === "SUPER_ADMIN" && (
                          <span className="badge bg-mint-100 text-mint-800">
                            رئيس المنصة
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-black/45">{user.email}</p>
                    </div>
                    <p className="text-sm text-black/55">
                      {user.memberships.map((item) => item.store.name).join("، ") ||
                        "بدون متجر"}
                    </p>
                    <button
                      className={
                        user.status === "ACTIVE" ? "btn-danger" : "btn-primary"
                      }
                      disabled={
                        user.platformRole === "SUPER_ADMIN" ||
                        busy === "user:" + user.id
                      }
                      onClick={() => void setUserStatus(user)}
                    >
                      {user.status === "ACTIVE" ? "تعليق" : "تفعيل"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
