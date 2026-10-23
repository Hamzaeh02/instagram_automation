import clsx from "clsx"
import { STATUS_COLOR, STATUS_LABEL, type PostStatus } from "../lib/types"

const COLOR_CLASSES: Record<string, string> = {
  slate: "bg-black/[0.04] text-slate-600 border-black/10",
  amber: "bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/35",
  info: "bg-[var(--color-info)]/12 text-[var(--color-info)] border-[var(--color-info)]/35",
  success: "bg-[var(--color-success)]/12 text-[var(--color-success)] border-[var(--color-success)]/35",
  danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)] border-[var(--color-danger)]/35",
}

export function StatusBadge({ status }: { status: PostStatus }) {
  const color = STATUS_COLOR[status] ?? "slate"
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold whitespace-nowrap",
        COLOR_CLASSES[color],
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", {
        "bg-slate-400": color === "slate",
        "bg-[var(--color-warning)]": color === "amber",
        "bg-[var(--color-info)]": color === "info",
        "bg-[var(--color-success)]": color === "success",
        "bg-[var(--color-danger)]": color === "danger",
      })} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}
