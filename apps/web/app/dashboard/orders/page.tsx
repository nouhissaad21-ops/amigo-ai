"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Send, Sheet, Truck } from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
import type { Order } from "@/lib/types";

const statuses = [
  "ALL",
  "CAPTURED",
  "CONFIRMED",
  "PACKING",
  "SHIPPED",
  "DELIVERED",
  "CANCELED",
  "RETURNED",
] as const;
type Status = (typeof statuses)[number];

const labels: Record<Status, string> = {
  ALL: "الكل",
  CAPTURED: "جديدة",
  CONFIRMED: "مؤكدة",
  PACKING: "قيد التحضير",
  SHIPPED: "مشحونة",
  DELIVERED: "مسلّمة",
  CANCELED: "ملغاة",
  RETURNED: "مرتجعة",
};

const transitions: Record<Order["status"], Order["status"][]> = {
  CAPTURED: ["CONFIRMED", "CANCELED"],
  CONFIRMED: ["PACKING", "SHIPPED", "CANCELED"],
  PACKING: ["SHIPPED", "CANCELED"],
  SHIPPED: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELED: [],
  RETURNED: [],
};

function badge(status: Order["status"]) {
  const colors: Record<Order["status"], string> = {
    CAPTURED: "bg-blue-100 text-blue-800",
    CONFIRMED: "bg-emerald-100 text-emerald-800",
    PACKING: "bg-amber-100 text-amber-800",
    SHIPPED: "bg-violet-100 text-violet-800",
    DELIVERED: "bg-green-100 text-green-800",
    CANCELED: "bg-red-100 text-red-800",
    RETURNED: "bg-slate-200 text-slate-800",
  };
  return `rounded-full px-3 py-1 text-xs font-black ${colors[status]}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<Status>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const result = await api.get<{ orders: Order[] }>(
          `/api/dashboard/orders?status=${status}`,
        );
        setOrders(result.orders);
        setNotice((current) =>
          current.startsWith("تعذر تحميل الطلبيات") ? "" : current,
        );
      } catch (error) {
        setNotice(`تعذر تحميل الطلبيات: ${(error as Error).message}`);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 10_000);
    const refreshOnFocus = () => void load(true);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [load]);

  const total = useMemo(
    () => orders.reduce((sum, order) => sum + Number(order.totalAmount), 0),
    [orders],
  );

  async function changeStatus(order: Order, next: Order["status"]) {
    setBusy(order.id);
    setNotice("");
    try {
      await api.patch(`/api/dashboard/orders/${order.id}/status`, {
        status: next,
      });
      await load();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function dispatch(order: Order, provider: "YALIDINE" | "ZR_EXPRESS") {
    setBusy(order.id);
    setNotice("");
    try {
      await api.post(`/api/dashboard/orders/${order.id}/dispatch`, {
        provider,
      });
      setNotice(`تم إرسال الطلب ${order.orderNumber} إلى شركة الشحن.`);
      await load();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function syncSheets() {
    setBusy("sheets");
    setNotice("");
    try {
      const result = await api.post<{ synced: number }>(
        "/api/dashboard/orders/sync/google-sheets",
        {},
      );
      setNotice(`تمت مزامنة ${result.synced} طلبية مع Google Sheets.`);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header
        title="إدارة الطلبيات"
        description={`${orders.length} طلبية — ${total.toLocaleString("ar-DZ")} دج`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              تحديث
            </button>
            <a
              className="btn-secondary"
              href="/backend/api/dashboard/orders/export.csv"
            >
              <Download />
              CSV
            </a>
            <button
              className="btn-primary"
              disabled={busy === "sheets"}
              onClick={() => void syncSheets()}
            >
              <Sheet />
              Google Sheets
            </button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {statuses.map((item) => (
          <button
            key={item}
            className={item === status ? "btn-primary" : "btn-secondary"}
            onClick={() => setStatus(item)}
          >
            {labels[item]}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-4 rounded-2xl border border-brand/20 bg-brand/5 p-4 text-sm font-bold">
          {notice}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1100px] text-right text-sm">
          <thead className="bg-black/[.03]">
            <tr>
              <th className="p-4">الطلبية</th>
              <th>الزبون</th>
              <th>الموقع</th>
              <th>المنتجات</th>
              <th>الإجمالي</th>
              <th>الحالة</th>
              <th>الشحن</th>
              <th className="p-4">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const canDispatch =
                order.status === "CONFIRMED" || order.status === "PACKING";
              return (
                <tr key={order.id} className="border-t align-top">
                  <td className="p-4">
                    <b>{order.orderNumber}</b>
                    <br />
                    <span className="text-xs text-black/50">
                      {new Date(order.createdAt).toLocaleString("ar-DZ")}
                    </span>
                  </td>
                  <td>
                    <b>{order.fullName}</b>
                    <br />
                    <a
                      className="text-brand"
                      dir="ltr"
                      href={`tel:${order.phone}`}
                    >
                      {order.phone}
                    </a>
                  </td>
                  <td>
                    {order.wilayaCode} - {order.wilayaName}
                    <br />
                    <span className="text-black/60">{order.municipality}</span>
                  </td>
                  <td>
                    {order.items.map((item) => (
                      <div key={item.id}>
                        {item.productNameSnapshot} × {item.quantity}
                        {item.variantSnapshot
                          ? ` (${item.variantSnapshot})`
                          : ""}
                      </div>
                    ))}
                  </td>
                  <td className="font-black">
                    {Number(order.totalAmount).toLocaleString("ar-DZ")} دج
                  </td>
                  <td>
                    <span className={badge(order.status)}>
                      {labels[order.status]}
                    </span>
                  </td>
                  <td>
                    {order.dispatches.length ? (
                      order.dispatches.map((item) => (
                        <div key={`${item.provider}-${item.trackingNumber}`}>
                          <b>{item.provider}</b>
                          <br />
                          <span dir="ltr">
                            {item.trackingNumber ?? item.status}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-black/40">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex max-w-[290px] flex-wrap gap-2">
                      {transitions[order.status].map((next) => (
                        <button
                          key={next}
                          disabled={busy === order.id}
                          className={
                            next === "CANCELED" || next === "RETURNED"
                              ? "btn-danger"
                              : "btn-secondary"
                          }
                          onClick={() => void changeStatus(order, next)}
                        >
                          <Send />
                          {labels[next]}
                        </button>
                      ))}
                      {canDispatch && (
                        <>
                          <button
                            disabled={busy === order.id}
                            className="btn-secondary"
                            onClick={() => void dispatch(order, "YALIDINE")}
                          >
                            <Truck />
                            Yalidine
                          </button>
                          <button
                            disabled={busy === order.id}
                            className="btn-secondary"
                            onClick={() => void dispatch(order, "ZR_EXPRESS")}
                          >
                            <Truck />
                            ZR Express
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!orders.length && (
          <div className="p-20 text-center text-black/50">
            {loading ? "جاري تحميل الطلبيات..." : "لا توجد طلبيات في هذا التصنيف."}
          </div>
        )}
      </div>
    </>
  );
}
