export function Header({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-mint-600">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-11 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-mint-500 to-cyan-400 text-xl font-black text-white shadow-lg shadow-mint-600/20">
        A
        <span className="absolute -bottom-2 -left-2 size-6 rounded-full bg-white/20" />
      </span>
      <div>
        <b
          className={`text-xl tracking-tight ${inverse ? "text-white" : "text-slate-950"}`}
        >
          AmiGo <i className="not-italic text-mint-500">AI</i>
        </b>
        <p
          className={`text-[11px] ${inverse ? "text-white/45" : "text-slate-400"}`}
        >
          مساعد مبيعاتك الذكي
        </p>
      </div>
    </div>
  );
}
