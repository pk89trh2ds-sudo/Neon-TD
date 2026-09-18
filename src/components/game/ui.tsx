import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "quiet" | "danger";

export function Btn({
  variant = "ghost",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium tracking-wide transition-transform duration-150 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "active:enabled:scale-[0.98]",
        variant === "primary" && "bg-cyan text-cyan-fg hover:brightness-110",
        variant === "ghost" && "border border-line bg-panel text-fg hover:border-line-strong",
        variant === "quiet" && "bg-panel-2 text-muted hover:text-fg",
        variant === "danger" && "border border-signal/40 text-signal hover:bg-signal/10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel p-4", className)}>{children}</div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-16 text-center">
      <div className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className="font-display text-xl font-semibold tabular text-ice">{value}</div>
    </div>
  );
}

export function Bar({ value, max }: { value: number; max: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
      <div className="h-full rounded-full bg-cyan" style={{ width: `${pct}%` }} />
    </div>
  );
}
