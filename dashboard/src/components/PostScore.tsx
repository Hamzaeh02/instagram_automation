import { AlertTriangle, CheckCircle2, Gauge, XCircle } from "lucide-react"
import type { PostScore, PostScoreCheck } from "../lib/types"

export function scoreColor(score: number) {
  if (score >= 85) return "var(--color-success)"
  if (score >= 70) return "#3b82f6"
  if (score >= 50) return "#d9a441"
  return "var(--color-danger)"
}

/** Compact "89" pill for lists and headers. */
export function ScoreBadge({ score, grade }: { score: number; grade?: string }) {
  const color = scoreColor(score)
  return (
    <span
      title={grade ? `Post score: ${score}/100 (${grade})` : `Post score: ${score}/100`}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums"
      style={{ color, borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <Gauge className="h-3 w-3" /> {score}
      {grade && <span className="font-semibold">· {grade}</span>}
    </span>
  )
}

function Ring({ score }: { score: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  const color = scoreColor(score)
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0">
      <circle cx="42" cy="42" r={r} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="8" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - score / 100)}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="47" textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor">
        {score}
      </text>
    </svg>
  )
}

const ICON = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-success)]" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-[#d9a441]" />,
  fail: <XCircle className="h-4 w-4 shrink-0 text-[var(--color-danger)]" />,
}

const RANK = { fail: 0, warn: 1, pass: 2 } as const

/** One overall score plus a single list of what's good and what to fix -
 *  each check shows its worst result across the post's platforms. */
export function PostScoreCard({ score }: { score: PostScore }) {
  const worst = new Map<string, PostScoreCheck>()
  for (const p of score.platforms) {
    for (const c of p.checks) {
      const seen = worst.get(c.key)
      if (!seen || RANK[c.status] < RANK[seen.status]) worst.set(c.key, c)
    }
  }
  const checks = [...worst.values()].sort((a, b) => RANK[a.status] - RANK[b.status])
  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-4">
        <Ring score={score.overall} />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Post score</p>
          <p className="font-[var(--font-display)] text-lg font-bold" style={{ color: scoreColor(score.overall) }}>
            {score.grade}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">How well this post is optimized for posting.</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-2.5">
            {ICON[c.status]}
            <div className="min-w-0">
              <p className="text-sm text-[var(--color-text)]">{c.label}</p>
              {c.tip && c.status !== "pass" && <p className="text-xs text-[var(--color-text-muted)]">{c.tip}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
