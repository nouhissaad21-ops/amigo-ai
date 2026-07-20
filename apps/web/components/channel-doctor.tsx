"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Loader2,
  Stethoscope,
  Wrench,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  Channel,
  ChannelDiagnosticCheck,
  ChannelDiagnostics,
} from "@/lib/types";

const checkStyle: Record<
  ChannelDiagnosticCheck["state"],
  { icon: typeof CheckCircle2; className: string }
> = {
  PASS: { icon: CheckCircle2, className: "bg-mint-50 text-mint-700" },
  WARN: { icon: AlertTriangle, className: "bg-amber-50 text-amber-700" },
  FAIL: { icon: XCircle, className: "bg-red-50 text-red-700" },
  INFO: { icon: CircleHelp, className: "bg-blue-50 text-blue-700" },
};

const overallStyle: Record<
  ChannelDiagnostics["overall"],
  { label: string; className: string }
> = {
  READY: { label: "جاهزة", className: "bg-mint-50 text-mint-700" },
  DEGRADED: { label: "تحتاج متابعة", className: "bg-amber-50 text-amber-700" },
  BLOCKED: { label: "متوقفة", className: "bg-red-50 text-red-700" },
};

function formatDate(value: string | null) {
  if (!value) return "لا يوجد";
  try {
    return new Intl.DateTimeFormat("ar-DZ", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ChannelDoctor({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ChannelDiagnostics>();
  const [repairs, setRepairs] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function run(repair: boolean) {
    setLoading(true);
    setError("");
    try {
      if (repair) {
        const result = await api.post<{
          repairs: string[];
          diagnostics: ChannelDiagnostics;
        }>(`/api/channel-diagnostics/${channel.id}/repair`);
        setRepairs(result.repairs);
        setDiagnostics(result.diagnostics);
      } else {
        const result = await api.get<{ diagnostics: ChannelDiagnostics }>(
          `/api/channel-diagnostics/${channel.id}`,
        );
        setDiagnostics(result.diagnostics);
      }
      setOpen(true);
    } catch (reason) {
      setError((reason as Error).message);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  const overall = diagnostics ? overallStyle[diagnostics.overall] : undefined;

  return (
    <div className="mt-2 rounded-2xl border border-slate-100 bg-white/90">
      <div className="flex items-center gap-2 p-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-right text-[11px] font-black text-slate-600 transition hover:bg-slate-50"
          disabled={loading}
          onClick={() => void run(false)}
          type="button"
        >
          {loading ? (
            <Loader2 className="shrink-0 animate-spin" size={15} />
          ) : (
            <Stethoscope className="shrink-0" size={15} />
          )}
          <span className="truncate">تشخيص القناة</span>
          {overall && (
            <span className={`badge mr-auto ${overall.className}`}>
              {overall.label}
            </span>
          )}
        </button>
        <button
          aria-label={open ? "إخفاء التشخيص" : "عرض التشخيص"}
          className="grid size-8 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-50"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 p-3">
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-[11px] font-bold leading-5 text-red-700">
              {error}
            </div>
          )}

          {diagnostics && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="block text-[9px] font-bold text-slate-400">
                    آخر رسالة داخلة
                  </span>
                  <b className="mt-1 block text-[10px] text-slate-700">
                    {formatDate(diagnostics.activity.lastInboundAt)}
                  </b>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="block text-[9px] font-bold text-slate-400">
                    آخر رد خارج
                  </span>
                  <b className="mt-1 block text-[10px] text-slate-700">
                    {formatDate(diagnostics.activity.lastOutboundAt)}
                  </b>
                </div>
              </div>

              <div className="space-y-2">
                {diagnostics.checks.map((check) => {
                  const style = checkStyle[check.state];
                  const Icon = style.icon;
                  return (
                    <div
                      className="rounded-xl border border-slate-100 p-3"
                      key={check.key}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-lg ${style.className}`}
                        >
                          <Icon size={14} />
                        </span>
                        <div className="min-w-0">
                          <b className="block text-[11px] text-slate-800">
                            {check.label}
                          </b>
                          <p className="mt-1 text-[10px] leading-5 text-slate-500">
                            {check.summary}
                          </p>
                          {check.detail && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[9px] font-bold text-slate-400">
                                التفاصيل التقنية
                              </summary>
                              <p className="mt-1 break-words rounded-lg bg-slate-50 p-2 text-left font-mono text-[9px] leading-4 text-slate-500" dir="ltr">
                                {check.detail}
                              </p>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {diagnostics.recommendations.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <b className="flex items-center gap-2 text-[11px] text-amber-900">
                    <Activity size={14} /> المطلوب الآن
                  </b>
                  <div className="mt-2 space-y-1 text-[10px] leading-5 text-amber-800">
                    {diagnostics.recommendations.map((item) => (
                      <p key={item}>• {item}</p>
                    ))}
                  </div>
                </div>
              )}

              {repairs.length > 0 && (
                <div className="rounded-xl bg-blue-50 p-3 text-[10px] leading-5 text-blue-800">
                  {repairs.map((item) => (
                    <p key={item}>• {item}</p>
                  ))}
                </div>
              )}

              <button
                className="btn-secondary w-full text-xs"
                disabled={loading}
                onClick={() => void run(true)}
                type="button"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : (
                  <Wrench size={15} />
                )}
                فحص وإصلاح تلقائي
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
