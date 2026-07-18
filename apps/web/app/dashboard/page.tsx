"use client";
import { useEffect, useState } from "react";
import {
  Boxes,
  MessageCircleMore,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
type S = {
  products: number;
  channels: number;
  openOrders: number;
  todayOrders: number;
  revenue: string;
};
export default function Dashboard() {
  const [s, setS] = useState<S>();
  useEffect(() => {
    api
      .get<S>("/api/dashboard/stats")
      .then(setS)
      .catch((e) => {
        if (e.status === 401) location.href = "/login";
      });
  }, []);
  const cards = [
    ["todayOrders", "طلبيات اليوم", ShoppingBag],
    ["openOrders", "تحتاج متابعة", TrendingUp],
    ["products", "منتجات نشطة", Boxes],
    ["channels", "قنوات مربوطة", MessageCircleMore],
  ] as const;
  return (
    <>
      <Header
        title="صباح الخير، الخدمة راهي ماشية"
        description="نظرة سريعة على أداء متجرك."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([k, l, I]) => (
          <div className="card p-5" key={k}>
            <I className="text-mint-600" />
            <p className="mt-5 text-sm text-black/45">{l}</p>
            <p className="text-3xl font-black">{s?.[k] ?? "—"}</p>
          </div>
        ))}
      </div>
      <div className="card mt-5 p-8">
        <p className="text-black/45">قيمة الطلبيات النشطة</p>
        <p className="mt-2 text-4xl font-black">
          {s ? Number(s.revenue).toLocaleString("fr-DZ") : "—"} دج
        </p>
      </div>
    </>
  );
}
