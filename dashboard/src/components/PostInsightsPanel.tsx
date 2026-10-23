import { AlertCircle, Clock, ExternalLink, Eye, Heart, MessageCircle, RefreshCw, Repeat2, TrendingUp } from "lucide-react"
import { useCallback, useEffect, useState, type ComponentType } from "react"
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { api, ApiError } from "../api/client"
import { BoostButton } from "./BoostButton"
import { BRAND_PLATFORMS } from "./BrandLogos"
import { Button, FadeIn, Spinner } from "./ui"

interface Metric {
  key: string
  label: string
  value: number
}

type Insights =
  | { available: true; primary: string | null; metrics: Metric[]; interactions: number; engagement_rate: number | null; note?: string }
  | { available: false; reason: string }

interface PlatformResult {
  platform: string
  status: "pending" | "publishing" | "posted" | "failed"
  permalink: string
  published_at: string | null
  error_message: string
  insights: Insights | null
}

interface PostInsightsResponse {
  platforms: PlatformResult[]
  totals: { views: number; likes: number; comments: number; shares: number; interactions: number; engagement_rate: number | null }
  fetched_at: string
}

const BRAND_COLOR: Record<string, string> = {
  instagram: "#c13584",
  facebook: "#1877f2",
  youtube: "#e62117",
  tiktok: "#111111",
  linkedin: "#0a66c2",
  x: "#111111",
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—"
  return n.toLocaleString()
}

function compact(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return String(n)
}

function TotalTile({ icon: Icon, label, value, color }: { icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: color + "1f" }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div>
        <div className="font-[var(--font-display)] text-xl font-bold leading-none">{value}</div>
        <div className="mt-1 text-xs text-[var(--color-text-muted)]">{label}</div>
      </div>
    </div>
  )
}

function PlatformCard({ result }: { result: PlatformResult }) {
  const brand = BRAND_PLATFORMS.find((p) => p.key === result.platform)
  const color = BRAND_COLOR[result.platform] ?? "#6a8f2e"
  const ins = result.insights
  const primary = ins?.available ? ins.metrics.find((m) => m.key === ins.primary) ?? ins.metrics[0] : undefined
  const rest = ins?.available ? ins.metrics.filter((m) => m !== primary) : []

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-white">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.06] bg-white shadow-sm">
            {brand && <brand.logo className={result.platform === "youtube" ? "h-4 w-6" : "h-5 w-5"} />}
          </span>
          <div>
            <div className="font-bold leading-tight">{brand?.label ?? result.platform}</div>
            <div className="text-[11px] text-[var(--color-text-faint)]">
              {result.published_at
                ? `Published ${new Date(result.published_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                : result.status === "failed"
                  ? "Publishing failed"
                  : "Not published yet"}
            </div>
          </div>
        </div>
        {result.permalink && (
          <div className="flex items-center gap-2">
            <BoostButton platform={result.platform} permalink={result.permalink} caption={brand ? `Your ${brand.label} post` : ""} size="sm" />
          <a
            href={result.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            View post <ExternalLink className="h-3 w-3" />
          </a>
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        {result.status === "failed" ? (
          <div className="flex items-start gap-2 rounded-lg bg-[var(--color-danger)]/8 px-3 py-2.5 text-xs text-[var(--color-danger)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-3">{result.error_message || "This post didn't go out on this platform."}</span>
          </div>
        ) : result.status !== "posted" ? (
          <div className="flex items-center gap-2 rounded-lg bg-black/[0.04] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
            <Clock className="h-3.5 w-3.5" /> Stats appear here once it's published.
          </div>
        ) : !ins || !ins.available ? (
          <div className="rounded-lg bg-black/[0.04] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
            {ins && !ins.available ? ins.reason : "No stats available for this platform."}
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 border-b border-[var(--color-border)] pb-4">
              <div>
                <div className="font-[var(--font-display)] text-4xl font-bold leading-none tracking-tight">{fmt(primary?.value)}</div>
                <div className="mt-1.5 text-xs font-semibold text-[var(--color-text-muted)]">{primary?.label}</div>
              </div>
              {ins.engagement_rate !== null && (
                <div className="text-right">
                  <div className="font-[var(--font-display)] text-xl font-bold leading-none" style={{ color }}>
                    {ins.engagement_rate}%
                  </div>
                  <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Engagement</div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
              {rest.map((m) => (
                <div key={m.key}>
                  <div className="text-lg font-bold leading-none">{fmt(m.value)}</div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">{m.label}</div>
                </div>
              ))}
            </div>
            {ins.note && (
              <div className="mt-4 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-3 py-2 text-[11px] text-[var(--color-warning)]">
                {ins.note}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function PostInsightsPanel({ postId }: { postId: number }) {
  const [data, setData] = useState<PostInsightsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (force = false) => {
      setRefreshing(true)
      setError(null)
      try {
        setData(await api.get<PostInsightsResponse>(`/analytics/posts/${postId}${force ? "?refresh=true" : ""}`))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't load insights")
      } finally {
        setRefreshing(false)
      }
    },
    [postId],
  )

  useEffect(() => {
    load()
  }, [load])

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />}
      </div>
    )
  }

  if (data.platforms.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center gap-2 px-6 py-14 text-center">
        <TrendingUp className="h-8 w-8 text-[var(--color-text-faint)]" />
        <p className="font-semibold">No insights yet</p>
        <p className="max-w-sm text-sm text-[var(--color-text-muted)]">
          This post hasn't been published anywhere yet. Once it goes live, its views, likes and comments on each platform show up here.
        </p>
      </div>
    )
  }

  const chartData = data.platforms
    .filter((p) => p.insights?.available)
    .map((p) => {
      const ins = p.insights as Extract<Insights, { available: true }>
      const metric = ins.metrics.find((m) => m.key === ins.primary)
      return {
        name: BRAND_PLATFORMS.find((b) => b.key === p.platform)?.label ?? p.platform,
        Main: metric?.value ?? 0,
        Interactions: ins.interactions,
        color: BRAND_COLOR[p.platform] ?? "#6a8f2e",
      }
    })

  return (
    <FadeIn className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-[var(--font-display)] text-lg font-bold">Post performance</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Across {data.platforms.length} platform{data.platforms.length === 1 ? "" : "s"} · updated{" "}
            {new Date(data.fetched_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} /> Refresh
        </Button>
      </div>

      <div className="glass-card grid grid-cols-2 divide-[var(--color-border)] p-0 sm:grid-cols-5 sm:divide-x-2">
        <TotalTile icon={Eye} label="Views" value={compact(data.totals.views)} color="#6a8f2e" />
        <TotalTile icon={Heart} label="Likes" value={compact(data.totals.likes)} color="#c1432c" />
        <TotalTile icon={MessageCircle} label="Comments" value={compact(data.totals.comments)} color="#3f6fa0" />
        <TotalTile icon={Repeat2} label="Shares" value={compact(data.totals.shares)} color="#8a4f9e" />
        <TotalTile
          icon={TrendingUp}
          label="Engagement rate"
          value={data.totals.engagement_rate !== null ? `${data.totals.engagement_rate}%` : "—"}
          color="#2f7680"
        />
      </div>

      {chartData.length > 1 && (
        <div className="glass-card p-5">
          <div className="mb-3 text-sm font-bold">Platform comparison</div>
          <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 52)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 24 }} barGap={4}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12, fill: "#6b6558" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "rgba(28,26,20,0.04)" }} formatter={(v) => Number(v).toLocaleString()} />
              <Bar dataKey="Main" name="Views / reach" radius={[0, 6, 6, 0]} barSize={14}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
              <Bar dataKey="Interactions" radius={[0, 6, 6, 0]} barSize={14}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={d.color} fillOpacity={0.35} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Solid: views / impressions / reach (each platform's main metric). Light: likes + comments + shares + saves.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.platforms.map((p) => (
          <PlatformCard key={p.platform} result={p} />
        ))}
      </div>
    </FadeIn>
  )
}
