export function Header({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-black sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-black/50">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-11 place-items-center rounded-2xl bg-mint-600 text-xl text-white">
        A
      </span>
      <div>
        <b className="text-xl">
          AmiGo <i className="not-italic text-mint-600">AI</i>
        </b>
        <p className="text-[11px] text-black/40">مساعد مبيعاتك الذكي</p>
      </div>
    </div>
  );
}
