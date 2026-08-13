"use client";

/** Orbe discret — signature légère, pas un ornement lourd. */
export function Orb({ size = 28 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className="absolute inset-0 rounded-full border border-line-strong/80"
        style={{ animation: "orb-spin 12s linear infinite" }}
      />
      <span
        className="absolute inset-[22%] rounded-full bg-accent/10"
        style={{ animation: "orb-breathe 2.8s ease-in-out infinite" }}
      />
      <span className="absolute inset-[38%] rounded-full bg-accent" />
    </span>
  );
}
