import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

export function Button({
  className,
  variant = "secondary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-primary-foreground hover:brightness-95",
    secondary: "bg-muted text-foreground hover:bg-muted/80",
    ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
    danger: "ui-danger-action hover:brightness-95",
    outline: "border border-border bg-panel hover:bg-muted"
  };

  return (
    <button
      className={cn(
        "ui-button inline-flex h-9 items-center justify-center gap-2 rounded-[var(--control-radius)] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  className,
  tone = "neutral",
  children
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  return (
    <span className={cn("ui-badge inline-flex items-center px-2 py-0.5 text-xs font-semibold", className)} data-tone={tone}>
      {children}
    </span>
  );
}

export function Modal({
  title,
  description,
  children,
  footer,
  onClose
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="max-h-[88vh] w-full max-w-xl overflow-auto rounded-lg border border-border bg-panel shadow-soft">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <button
            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            type="button"
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "min-h-10 w-full rounded-[var(--control-radius)] border border-[hsl(var(--control-border))] bg-panel px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
