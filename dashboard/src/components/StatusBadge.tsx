import clsx from "clsx"
import { STATUS_COLOR, STATUS_LABEL, type PostStatus } from "../lib/types"

const COLOR_CLASSES: Record<string, string> = {
  slate: "bg-white/8 text-slate-300 border-white/10",
  amber: "bg-amber-500/12 text-amber-300 border-amber-500/25",
  info: "bg-sky-500/12 text-sky-300 border-sky-500/25",
  success: "bg-emerald-500/12 text-emerald-300 border-emerald-500/25",
  danger: "bg-rose-500/12 text-rose-300 border-rose-500/25",
}

export function StatusBadge({ status }: { status: PostStatus }) {
  const color = STATUS_COLOR[status] ?? "slate"
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        COLOR_CLASSES[color],
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", {
        "bg-slate-400": color === "slate",
        "bg-amber-400": color === "amber",
        "bg-sky-400": color === "info",
        "bg-emerald-400": color === "success",
        "bg-rose-400": color === "danger",
      })} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}
