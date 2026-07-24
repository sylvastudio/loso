"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------- Button ----------

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-amber text-amber-ink font-semibold hover:bg-amber-deep active:translate-y-px shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]",
  ghost: "text-ink-dim hover:text-ink hover:bg-raised",
  outline: "border border-line-strong text-ink hover:border-amber/60 hover:text-amber",
  danger: "text-danger hover:bg-danger/10",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap cursor-pointer",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        buttonStyles[variant],
        className
      )}
      {...props}
    />
  );
});

// ---------- Inputs ----------

const fieldBase =
  "w-full rounded-lg border border-line bg-inset px-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-amber/70 focus:ring-2 focus:ring-amber/15";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...props} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(fieldBase, "py-2.5 leading-relaxed resize-none", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cx(fieldBase, "h-10 appearance-none pr-8 cursor-pointer", className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239b9ba8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 10px center",
        }}
        {...props}
      />
    );
  }
);

// ---------- Field ----------

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-dim">
          {label}
        </span>
        {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// ---------- Switch ----------

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 cursor-pointer group"
    >
      <span
        className={cx(
          "relative h-5 w-9 rounded-full transition-colors duration-200",
          checked ? "bg-amber" : "bg-line-strong group-hover:bg-ink-faint"
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </span>
      {label && <span className="text-sm text-ink-dim group-hover:text-ink">{label}</span>}
    </button>
  );
}

// ---------- Section card ----------

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-ink-dim">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------- Status chip ----------

export function StatusChip({ ok, labels }: { ok: boolean; labels: [string, string] }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        ok ? "border-ok/30 bg-ok/10 text-ok" : "border-line-strong text-ink-faint"
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", ok ? "bg-ok" : "bg-ink-faint")} />
      {ok ? labels[0] : labels[1]}
    </span>
  );
}
