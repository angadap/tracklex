import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";

export const inputCls =
  "h-12 w-full rounded-xl bg-surface-2 px-4 text-[15px] text-white placeholder:text-muted outline-none ring-1 ring-hair focus:ring-2 focus:ring-white";

export function Page({ children }) {
  return <div className="mx-auto max-w-md px-4">{children}</div>;
}

export function TopBar({ title, back, backLabel = "Back", right, sub }) {
  return (
    <div className="mx-auto max-w-md px-4 pb-3 pt-6">
      {back && (
        <Link to={back} className="-ml-1 inline-flex items-center gap-1.5 py-2 text-sm font-bold text-soft">
          <ArrowLeft size={18} aria-hidden="true" /> {backLabel}
        </Link>
      )}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {sub && <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-muted">{sub}</p>}
          <h1 className="font-display text-[46px] font-extrabold italic uppercase leading-[0.95]">{title}</h1>
        </div>
        {right}
      </div>
    </div>
  );
}

const variants = {
  primary: "bg-white text-void",
  soft: "bg-surface-2 text-white",
  ghost: "text-soft",
  danger: "bg-[#3a1620] text-[#ff8a9b]",
};

export function Btn({ variant = "primary", to, className = "", children, ...rest }) {
  const cls = `inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold disabled:opacity-40 ${variants[variant]} ${className}`;
  return to ? (
    <Link to={to} className={cls} {...rest}>
      {children}
    </Link>
  ) : (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const chipTones = {
  neutral: "bg-surface-2 text-soft",
  good: "bg-[#12301f] text-live",
  warn: "bg-[#33270f] text-[#fbbf24]",
};
export function Chip({ tone = "neutral", children }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${chipTones[tone]}`}>{children}</span>;
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-2xl bg-surface p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-hair bg-surface/60 px-5 py-6 text-center">
      <p className="font-bold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[30ch] text-sm leading-relaxed text-soft">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-[#3a1620] px-4 py-3 text-sm font-semibold text-[#ff8a9b]">
      {children}
    </p>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-full bg-surface p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-10 flex-1 rounded-full text-sm font-bold ${value === o.value ? "bg-white text-void" : "text-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-3xl font-extrabold italic uppercase">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
