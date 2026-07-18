"use client";
import { useCallback, useEffect, useState } from "react";
import { Facebook, MessageCircle, QrCode, Unplug } from "lucide-react";
import { Header } from "@/components/ui";
import { api } from "@/lib/api";
import type { Channel } from "@/lib/types";
const baileysEnabled = process.env.NEXT_PUBLIC_ENABLE_BAILEYS === "true";
export default function Channels() {
  const [c, setC] = useState<Channel[]>([]),
    [cloud, setCloud] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .get<{ channels: Channel[] }>("/api/dashboard/channels")
        .then((x) => setC(x.channels)),
    [],
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);
  async function meta() {
    try {
      const { url } = await api.get<{ url: string }>(
        "/api/integrations/meta/start",
      );
      location.href = url;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api.post(
        "/api/dashboard/channels/whatsapp/cloud",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setCloud(false);
      await load();
    } catch (x) {
      setError((x as Error).message);
    }
  }
  async function qr() {
    await api.post("/api/dashboard/channels/whatsapp/baileys", {
      name: "WhatsApp QR",
    });
    await load();
  }
  return (
    <>
      <Header
        title="قنوات التواصل"
        description="Facebook، Instagram وWhatsApp لكل متجر."
        actions={
          <>
            <button className="btn-primary" onClick={meta}>
              <Facebook /> Meta OAuth
            </button>
            <button className="btn-secondary" onClick={() => setCloud(!cloud)}>
              <MessageCircle /> Cloud API
            </button>
            {baileysEnabled && (
              <button className="btn-secondary" onClick={qr}>
                <QrCode /> QR
              </button>
            )}
          </>
        }
      />
      {error && <p className="mb-4 bg-red-50 p-4 text-red-700">{error}</p>}
      {cloud && (
        <form
          className="card mb-5 grid gap-4 p-6 sm:grid-cols-2"
          onSubmit={save}
        >
          {[
            ["name", "اسم القناة"],
            ["phoneNumberId", "Phone Number ID"],
            ["wabaId", "WABA ID"],
            ["accessToken", "Permanent Token"],
          ].map(([n, l]) => (
            <label key={n}>
              <span className="label">{l}</span>
              <input
                className="field"
                name={n}
                type={n === "accessToken" ? "password" : "text"}
                required
              />
            </label>
          ))}
          <button className="btn-primary">ربط</button>
        </form>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {c.map((x) => (
          <article className="card p-6" key={x.id}>
            <div className="flex justify-between">
              <div>
                <b>{x.name}</b>
                <p className="text-xs text-black/40">{x.type}</p>
              </div>
              <span
                className={`badge ${x.status === "CONNECTED" ? "bg-mint-50 text-mint-700" : "bg-amber-50"}`}
              >
                {x.status}
              </span>
            </div>
            {x.whatsappSession?.qrCodeDataUrl && (
              <img
                className="mx-auto mt-5 size-64"
                src={x.whatsappSession.qrCodeDataUrl}
                alt="QR"
              />
            )}
            {x.lastError && <p className="mt-3 text-red-600">{x.lastError}</p>}
            <button
              className="btn-danger mt-4"
              onClick={async () => {
                await api.post(`/api/dashboard/channels/${x.id}/disconnect`);
                await load();
              }}
            >
              <Unplug />
              فصل
            </button>
          </article>
        ))}
      </div>
      <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm">
        <b>Cloud API هو الموصى به.</b>{" "}
        {baileysEnabled
          ? "QR غير رسمي وقد يتأثر بسياسة WhatsApp."
          : "ربط QR يحتاج خادماً دائماً، لذلك هو معطّل في الاستضافة المجانية."}
      </p>
    </>
  );
}
