"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------- Button (pill) ----------

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-lime text-black font-semibold hover:bg-lime-deep active:translate-y-px",
  ghost: "text-ink-dim hover:text-ink",
  outline: "border border-line-strong text-ink hover:border-lime hover:text-lime",
  danger: "text-danger/80 hover:text-danger",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full whitespace-nowrap transition-all duration-150 disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "h-8 px-4 text-[13px]" : "h-10 px-5 text-sm",
        buttonStyles[variant],
        className
      )}
      {...props}
    />
  );
});

// ---------- Inputs ----------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cx("uline", className)} {...props} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        "w-full resize-none rounded-lg border border-line bg-panel/60 px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong",
        className
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cx("uline cursor-pointer appearance-none pr-6", className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%238f8f97' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 2px center",
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
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 flex items-baseline justify-between">
        <span className="micro">{label}</span>
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
      className="group inline-flex cursor-pointer items-center gap-2.5"
    >
      <span
        className={cx(
          "relative h-[18px] w-[34px] rounded-full border transition-colors duration-200",
          checked ? "border-lime bg-lime" : "border-line-strong bg-transparent group-hover:border-ink-faint"
        )}
      >
        <span
          className={cx(
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all duration-200",
            checked ? "left-[17px] bg-black" : "left-[3px] bg-ink-faint group-hover:bg-ink-dim"
          )}
        />
      </span>
      {label && (
        <span className={cx("text-[13.5px]", checked ? "text-ink" : "text-ink-dim")}>{label}</span>
      )}
    </button>
  );
}

// ---------- Editorial section (numbered, hairline) ----------

export function Section({
  n,
  title,
  description,
  children,
  actions,
}: {
  n?: string;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-t border-line py-8 first:border-t-0">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
        <div>
          <div className="flex items-baseline gap-2.5">
            {n && <span className="micro text-lime">{n}</span>}
            <h3 className="font-serif text-[19px] font-medium tracking-tight">{title}</h3>
          </div>
          {description && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{description}</p>
          )}
          {actions && <div className="mt-3">{actions}</div>}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

// ---------- Status word ----------

export function StatusWord({ ok, labels }: { ok: boolean; labels: [string, string] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cx("led", ok && "on")} />
      <span className={cx("micro", ok ? "text-lime" : "")}>{ok ? labels[0] : labels[1]}</span>
    </span>
  );
}
