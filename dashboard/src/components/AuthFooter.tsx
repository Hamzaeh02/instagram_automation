import { BRAND_PLATFORMS } from "./BrandLogos"

export function AuthFooter() {
  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <div className="mb-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
        One place to publish everywhere
      </div>
      <div className="grid grid-cols-3 gap-2">
        {BRAND_PLATFORMS.map((p) => (
          <div
            key={p.key}
            className="flex flex-col items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-2 py-2.5 transition hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-sm"
          >
            <span className="flex h-6 items-center">
              <p.logo className={p.key === "youtube" ? "h-5 w-7" : "h-6 w-6"} />
            </span>
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">{p.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--color-text-faint)]">
        Reelmind uses YouTube API Services.
        <br />
        <a href="/terms" className="font-medium text-[var(--color-text-muted)] underline-offset-2 hover:underline">
          Terms of Service
        </a>
        {" · "}
        <a href="/privacy" className="font-medium text-[var(--color-text-muted)] underline-offset-2 hover:underline">
          Privacy Policy
        </a>
      </p>
    </div>
  )
}
