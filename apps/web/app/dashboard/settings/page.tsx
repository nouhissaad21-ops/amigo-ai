"use client";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
type Rate = {
  wilayaCode: number;
  homePrice: string | number;
  deskPrice: string | number | null;
  enabled: boolean;
};
export default function Settings() {
  const [rules, setRules] = useState({
      generalRules: "",
      exchangePolicy: "",
      specialOffers: "",
      fallbackMessage: "سمحلي، صرا مشكل تقني صغير.",
    }),
    [rates, setRates] = useState<Rate[]>([]),
    [names, setNames] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .get<any>("/api/dashboard/settings")
      .then((x) => {
        if (x.rules) setRules(x.rules);
        setNames(x.wilayas);
        const old = new Map<number, any>(
          x.deliveryRates.map((r: any) => [r.wilayaCode, r]),
        );
        setRates(
          Object.keys(x.wilayas)
            .map(Number)
            .map((code) => ({
              wilayaCode: code,
              homePrice: old.get(code)?.homePrice ?? 0,
              deskPrice: old.get(code)?.deskPrice ?? null,
              enabled: old.get(code)?.enabled ?? false,
            })),
        );
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "فشل تحميل الإعدادات",
        ),
      );
  }, []);
  const patch = (code: number, p: Partial<Rate>) =>
    setRates((x) => x.map((r) => (r.wilayaCode === code ? { ...r, ...p } : r)));
  async function save() {
    setError("");
    try {
      await api.put("/api/dashboard/settings", {
        ...rules,
        deliveryRates: rates.map((r) => ({
          ...r,
          homePrice: +r.homePrice,
          deskPrice:
            r.deskPrice == null || r.deskPrice === "" ? null : +r.deskPrice,
        })),
      });
      setNotice("تم الحفظ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "فشل حفظ الإعدادات");
    }
  }
  async function connector(e: React.FormEvent<HTMLFormElement>, type: string) {
    e.preventDefault();
    const form = e.currentTarget,
      f = Object.fromEntries(new FormData(form)),
      credentials: any = {},
      config: any = {};
    for (const [k, v] of Object.entries(f))
      k.startsWith("config.") ? (config[k.slice(7)] = v) : (credentials[k] = v);
    setError("");
    try {
      await api.put(`/api/dashboard/connectors/${type}`, {
        name: type,
        credentials,
        config,
        enabled: true,
      });
      setNotice(`تم ربط ${type}`);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "فشل حفظ الربط");
    }
  }
  return (
    <>
      <Header
        title="القواعد والتوصيل"
        description="وجّه البوت وحدد أسعار 58 ولاية."
        actions={
          <button className="btn-primary" onClick={save}>
            <Save />
            حفظ
          </button>
        }
      />
      {notice && <p className="mb-4 bg-mint-50 p-4 text-mint-700">{notice}</p>}
      {error && <p className="mb-4 bg-red-50 p-4 text-red-700">{error}</p>}
      <section className="card space-y-4 p-7">
        <label>
          <span className="label">قواعد المتجر</span>
          <textarea
            className="field min-h-40"
            value={rules.generalRules}
            onChange={(e) =>
              setRules({ ...rules, generalRules: e.target.value })
            }
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="label">سياسة التبدال</span>
            <textarea
              className="field"
              value={rules.exchangePolicy}
              onChange={(e) =>
                setRules({ ...rules, exchangePolicy: e.target.value })
              }
            />
          </label>
          <label>
            <span className="label">العروض</span>
            <textarea
              className="field"
              value={rules.specialOffers}
              onChange={(e) =>
                setRules({ ...rules, specialOffers: e.target.value })
              }
            />
          </label>
        </div>
        <label>
          <span className="label">رسالة الطوارئ</span>
          <input
            className="field"
            value={rules.fallbackMessage}
            onChange={(e) =>
              setRules({ ...rules, fallbackMessage: e.target.value })
            }
          />
        </label>
      </section>
      <section className="card mt-5 p-7">
        <h2 className="text-xl font-black">أسعار التوصيل</h2>
        <div className="mt-4 max-h-[600px] overflow-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th>تفعيل</th>
                <th>الولاية</th>
                <th>المنزل</th>
                <th>المكتب</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr className="border-t" key={r.wilayaCode}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        patch(r.wilayaCode, { enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    {r.wilayaCode}. {names[r.wilayaCode]}
                  </td>
                  <td>
                    <input
                      className="field"
                      type="number"
                      value={r.homePrice}
                      onChange={(e) =>
                        patch(r.wilayaCode, { homePrice: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="field"
                      type="number"
                      value={r.deskPrice ?? ""}
                      onChange={(e) =>
                        patch(r.wilayaCode, { deskPrice: e.target.value })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card mt-5 p-7">
        <h2 className="text-xl font-black">Google Sheets والشحن</h2>
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <form
            onSubmit={(e) => connector(e, "GOOGLE_SHEETS")}
            className="space-y-3"
          >
            <b>Google Sheets</b>
            <input
              className="field"
              name="webhookUrl"
              placeholder="Webhook URL"
              required
            />
            <input
              className="field"
              name="secret"
              type="password"
              placeholder="Shared secret"
              required
            />
            <button className="btn-secondary">حفظ</button>
          </form>
          <form
            onSubmit={(e) => connector(e, "YALIDINE")}
            className="space-y-3"
          >
            <b>Yalidine</b>
            {[
              ["apiId", "API ID"],
              ["apiToken", "API Token"],
              ["config.baseUrl", "https://api.yalidine.app/v1"],
              ["config.fromWilayaName", "ولاية الإرسال"],
              ["config.senderName", "المرسل"],
              ["config.senderPhone", "الهاتف"],
              ["config.senderAddress", "العنوان"],
            ].map(([n, p]) => (
              <input
                key={n}
                className="field"
                name={n}
                placeholder={p}
                defaultValue={n === "config.baseUrl" ? p : undefined}
                required
              />
            ))}
            <button className="btn-secondary">حفظ</button>
          </form>
          <form
            onSubmit={(e) => connector(e, "ZR_EXPRESS")}
            className="space-y-3"
          >
            <b>ZR Express</b>
            {[
              ["apiToken", "API Token"],
              ["apiId", "API ID"],
              ["config.baseUrl", "Base URL"],
              ["config.createPath", "/api/orders"],
              ["config.senderName", "المرسل"],
              ["config.senderPhone", "الهاتف"],
              ["config.senderAddress", "العنوان"],
            ].map(([n, p]) => (
              <input
                key={n}
                className="field"
                name={n}
                placeholder={p}
                defaultValue={n === "config.createPath" ? p : undefined}
                required
              />
            ))}
            <button className="btn-secondary">حفظ</button>
          </form>
        </div>
      </section>
    </>
  );
}
