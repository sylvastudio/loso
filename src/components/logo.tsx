import { cx } from "@/components/ui";

// The Onion Skin mark: three frames stacked like an animator's onion skin,
// fading toward the back, with a lime "now" dot on the front frame.
// `working` turns it into Loso's spinner: the frames step forward like a film
// gate (hold, step, hold). Reduced motion shows the still mark with a slow
// breathing dot instead (see .onion-* in globals.css).

const FRAME = { width: 28, height: 28, rx: 6, stroke: "currentColor", strokeWidth: 4.5 } as const;

export function LosoMark({
  working = false,
  size = 22,
  className,
  label,
}: {
  working?: boolean;
  size?: number;
  className?: string;
  /** Accessible name; omit when the mark sits next to the word "Loso". */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={cx("shrink-0", working && "onion-working", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {working ? (
        <>
          <rect className="onion-f" x="10" y="26" {...FRAME} />
          <rect className="onion-f onion-f2" x="10" y="26" {...FRAME} />
          <rect className="onion-f onion-f3" x="10" y="26" {...FRAME} />
        </>
      ) : (
        <>
          <rect x="26" y="10" {...FRAME} opacity={0.3} />
          <rect x="18" y="18" {...FRAME} opacity={0.6} />
          <rect x="10" y="26" {...FRAME} />
        </>
      )}
      <circle className={working ? "onion-dot" : undefined} cx="24" cy="40" r="5" fill="var(--color-lime)" />
    </svg>
  );
}

/** Mark + the serif wordmark. */
export function LosoLogo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <LosoMark size={size} />
      <span className="font-serif italic leading-none tracking-tight" style={{ fontSize: size * 1.05 }}>
        Loso
      </span>
    </span>
  );
}
