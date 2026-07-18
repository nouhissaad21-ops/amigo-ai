"use client";
import { useCallback, useEffect, useState } from "react";
import { Archive, Boxes, Pencil, Plus, Trash2, X } from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
import type { Product, Variant } from "@/lib/types";
type Draft = Omit<Product, "id" | "basePrice" | "promoPrice"> & {
  id?: string;
  basePrice: number;
  promoPrice: number | null;
};
const empty: Draft = {
  sku: "",
  name: "",
  description: "",
  basePrice: 0,
  promoPrice: null,
  status: "ACTIVE",
  trackInventory: true,
  stockQuantity: 0,
  images: [],
  variants: [],
};
function Form({
  initial,
  close,
  saved,
}: {
  initial: Draft;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [d, setD] = useState(initial),
    [error, setError] = useState("");
  const pv = (n: number, p: Partial<Variant>) =>
    setD((v) => ({
      ...v,
      variants: v.variants.map((x, i) => (i === n ? { ...x, ...p } : x)),
    }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      d.id
        ? await api.put(`/api/dashboard/products/${d.id}`, d)
        : await api.post("/api/dashboard/products", d);
      await saved();
      close();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-ink/40 p-4">
      <form className="card mx-auto max-w-3xl p-7" onSubmit={submit}>
        <div className="flex justify-between">
          <h2 className="text-2xl font-black">
            {d.id ? "تعديل المنتج" : "منتج جديد"}
          </h2>
          <button type="button" onClick={close}>
            <X />
          </button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">الاسم</span>
            <input
              className="field"
              value={d.name}
              onChange={(e) => setD({ ...d, name: e.target.value })}
              required
            />
          </label>
          <label>
            <span className="label">SKU</span>
            <input
              className="field"
              value={d.sku}
              onChange={(e) => setD({ ...d, sku: e.target.value })}
              required
            />
          </label>
          <label className="sm:col-span-2">
            <span className="label">الوصف</span>
            <textarea
              className="field"
              value={d.description}
              onChange={(e) => setD({ ...d, description: e.target.value })}
            />
          </label>
          <label>
            <span className="label">السعر</span>
            <input
              className="field"
              type="number"
              min="0"
              value={d.basePrice}
              onChange={(e) => setD({ ...d, basePrice: +e.target.value })}
            />
          </label>
          <label>
            <span className="label">سعر العرض</span>
            <input
              className="field"
              type="number"
              min="0"
              value={d.promoPrice ?? ""}
              onChange={(e) =>
                setD({
                  ...d,
                  promoPrice: e.target.value === "" ? null : +e.target.value,
                })
              }
            />
          </label>
          <label>
            <span className="label">المخزون</span>
            <input
              className="field"
              type="number"
              min="0"
              value={d.stockQuantity}
              onChange={(e) => setD({ ...d, stockQuantity: +e.target.value })}
            />
          </label>
          <label>
            <span className="label">الحالة</span>
            <select
              className="field"
              value={d.status}
              onChange={(e) =>
                setD({ ...d, status: e.target.value as Draft["status"] })
              }
            >
              <option value="ACTIVE">نشط</option>
              <option value="DRAFT">مسودة</option>
            </select>
          </label>
        </div>
        <div className="mt-6 flex justify-between">
          <b>المقاسات والألوان</b>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setD({
                ...d,
                variants: [
                  ...d.variants,
                  {
                    sku: `${d.sku}-`,
                    size: null,
                    color: null,
                    priceDelta: 0,
                    stockQuantity: 0,
                    isAvailable: true,
                  },
                ],
              })
            }
          >
            <Plus />
            خيار
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {d.variants.map((v, n) => (
            <div
              className="grid gap-2 rounded-2xl bg-black/[.03] p-3 sm:grid-cols-6"
              key={v.id ?? n}
            >
              <input
                className="field"
                placeholder="SKU"
                value={v.sku}
                onChange={(e) => pv(n, { sku: e.target.value })}
              />
              <input
                className="field"
                placeholder="مقاس"
                value={v.size ?? ""}
                onChange={(e) => pv(n, { size: e.target.value || null })}
              />
              <input
                className="field"
                placeholder="لون"
                value={v.color ?? ""}
                onChange={(e) => pv(n, { color: e.target.value || null })}
              />
              <input
                className="field"
                type="number"
                placeholder="فرق السعر"
                value={v.priceDelta}
                onChange={(e) => pv(n, { priceDelta: +e.target.value })}
              />
              <input
                className="field"
                type="number"
                placeholder="مخزون"
                value={v.stockQuantity}
                onChange={(e) => pv(n, { stockQuantity: +e.target.value })}
              />
              <button
                type="button"
                className="btn-danger"
                onClick={() =>
                  setD({ ...d, variants: d.variants.filter((_, i) => i !== n) })
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
        {error && <p className="mt-4 text-red-700">{error}</p>}
        <button className="btn-primary mt-6">حفظ</button>
      </form>
    </div>
  );
}
export default function Catalog() {
  const [p, setP] = useState<Product[]>([]),
    [edit, setEdit] = useState<Draft | null>(null);
  const load = useCallback(
    async () =>
      setP(
        (await api.get<{ products: Product[] }>("/api/dashboard/products"))
          .products,
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const draft = (x: Product): Draft => ({
    ...x,
    basePrice: +x.basePrice,
    promoPrice: x.promoPrice ? +x.promoPrice : null,
    variants: x.variants.map((v) => ({ ...v, priceDelta: +v.priceDelta })),
  });
  return (
    <>
      <Header
        title="كتالوج المنتجات"
        description="المصدر الوحيد للأسعار والمخزون."
        actions={
          <button className="btn-primary" onClick={() => setEdit({ ...empty })}>
            <Plus />
            إضافة منتج
          </button>
        }
      />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[750px] text-right text-sm">
          <thead className="bg-black/[.03]">
            <tr>
              <th className="p-4">المنتج</th>
              <th>SKU</th>
              <th>السعر</th>
              <th>المخزون</th>
              <th>الخيارات</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.map((x) => (
              <tr className="border-t" key={x.id}>
                <td className="p-4 font-black">{x.name}</td>
                <td>{x.sku}</td>
                <td>
                  {Number(x.promoPrice ?? x.basePrice).toLocaleString()} دج
                </td>
                <td>
                  {x.variants.length
                    ? x.variants.reduce((s, v) => s + v.stockQuantity, 0)
                    : x.stockQuantity}
                </td>
                <td>{x.variants.length}</td>
                <td className="flex gap-2 p-3">
                  <button
                    className="btn-secondary"
                    onClick={() => setEdit(draft(x))}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="btn-danger"
                    onClick={async () => {
                      if (confirm("أرشفة المنتج؟")) {
                        await api.delete(`/api/dashboard/products/${x.id}`);
                        await load();
                      }
                    }}
                  >
                    <Archive />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!p.length && (
          <div className="p-20 text-center">
            <Boxes className="mx-auto" />
            <p>أضف أول منتج</p>
          </div>
        )}
      </div>
      {edit && <Form initial={edit} close={() => setEdit(null)} saved={load} />}
    </>
  );
}
