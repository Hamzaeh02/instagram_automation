import {
  AlertCircle,
  Briefcase,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  FileStack,
  Globe,
  Heart,
  MessageCircle,
  Music2,
  RefreshCw,
  Repeat2,
  Send,
  TrendingUp,
  Users,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import { Link } from "react-router-dom"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { api } from "../api/client"
import { Button, FadeIn, PageHeader, Spinner } from "../components/ui"
import { XLogo } from "../components/XLogo"
import { BRAND_PLATFORMS } from "../components/BrandLogos"
import { YouTubeLogo } from "../components/YouTubeLogo"
import { STATUS_LABEL, type PostStatus } from "../lib/types"

interface Totals {
  views: number
  likes: number
  comments: number
  shares: number
}

interface PostStats {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
}

interface PlatformPost {
  post_id: number
  title: string
  published_at: string | null
  permalink: string
  stats: PostStats | null
}

interface AccountStats {
  followers_label: string
  followers: number | null
  metrics: { label: string; value: number }[]
}

type PlatformSummary =
  | { available: true; totals: Totals; posts: PlatformPost[] }
  | { available: false; reason: string; posts?: PlatformPost[] }

interface AnalyticsSummary {
  platforms: Record<string, PlatformSummary>
  totals: Totals
  connected: Record<string, boolean>
  accounts: Record<string, AccountStats>
  content: {
    total_posts: number
    upcoming: number
    status_counts: Partial<Record<PostStatus, number>>
    per_platform: Record<string, { posted: number; failed: number; queued: number }>
    timeline: { week_start: string; scheduled: number; published: number }[]
  }
}

const PLATFORMS: { key: string; label: string; icon: ComponentType<{ className?: string }>; color: string }[] = [
  { key: "instagram", label: "Instagram", icon: Camera, color: "#c13584" },
  { key: "facebook", label: "Facebook", icon: Globe, color: "#1877f2" },
  { key: "youtube", label: "YouTube", icon: YouTubeLogo, color: "#e62117" },
  { key: "tiktok", label: "TikTok", icon: Music2, color: "#111111" },
  { key: "x", label: "X", icon: XLogo, color: "#3a3a3a" },
  { key: "linkedin", label: "LinkedIn", icon: Briefcase, color: "#0a66c2" },
]

const STATUS_COLOR_HEX: Record<PostStatus, string> = {
  planned: "#948d7d",
  video_generating: "#d9a441",
  image_generating: "#d9a441",
  pending_review: "#2f7680",
  approved: "#6a8f2e",
  needs_manual_edit: "#b5701f",
  publishing: "#3f6fa0",
  posted: "#2f8a54",
  failed: "#c1432c",
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return String(n)
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color?: string; payload?: { color?: string } }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold text-[var(--color-text)]">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.color }} />
          {p.name}: <span className="font-semibold text-[var(--color-text)]">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  from,
  to,
  delay,
}: {
  label: string
  value: number
  hint: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  from: string
  to: string
  delay: number
}) {
  return (
    <FadeIn delay={delay}>
      <div className="glass-card relative h-full overflow-hidden p-5">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-[0.14]"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        />
        <div className="flex items-start justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg shadow-sm"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            <Icon className="h-4 w-4 text-white" strokeWidth={2.25} />
          </div>
        </div>
        <div className="mt-2 font-[var(--font-display)] text-4xl font-bold tracking-tight">{fmt(value)}</div>
        <div className="mt-1 text-xs text-[var(--color-text-faint)]">{hint}</div>
      </div>
    </FadeIn>
  )
}

function SectionTitle({ icon: Icon, children, aside }: { icon?: ComponentType<{ className?: string }>; children: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 font-[var(--font-display)] font-bold">
        {Icon && <Icon className="h-4 w-4 text-[var(--color-primary)]" />}
        {children}
      </h3>
      {aside}
    </div>
  )
}

export function Analytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (force = false) => {
    setRefreshing(true)
    try {
      setSummary(await api.get<AnalyticsSummary>(`/analytics/summary${force ? "?refresh=true" : ""}`))
      setError(false)
    } catch {
      setError(true)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const derived = useMemo(() => {
    if (!summary) return null
    const { content } = summary
    const sc = content.status_counts
    const published = sc.posted ?? 0
    const needsAttention = (sc.pending_review ?? 0) + (sc.needs_manual_edit ?? 0) + (sc.failed ?? 0)

    const timeline = content.timeline.map((w) => ({
      name: new Date(w.week_start + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      Scheduled: w.scheduled,
      Published: w.published,
    }))

    const statusData = (Object.keys(sc) as PostStatus[])
      .filter((s) => (sc[s] ?? 0) > 0)
      .map((s) => ({ name: STATUS_LABEL[s], value: sc[s] ?? 0, color: STATUS_COLOR_HEX[s] }))

    const platformBars = PLATFORMS.map((p) => {
      const c = content.per_platform[p.key] ?? { posted: 0, failed: 0, queued: 0 }
      return { name: p.label, Published: c.posted, Queued: c.queued, Failed: c.failed }
    })

    const topPosts = Object.entries(summary.platforms)
      .flatMap(([key, data]) =>
        data.available ? data.posts.map((post) => ({ ...post, platform: key })) : [],
      )
      .map((p) => ({
        ...p,
        score: (p.stats?.views ?? 0) + (p.stats?.likes ?? 0) * 5 + (p.stats?.comments ?? 0) * 10,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    const totalAudience = Object.values(summary.accounts).reduce((sum, a) => sum + (a.followers ?? 0), 0)

    // Engagement rate the way the platforms' own dashboards define it:
    // average interactions per post as a share of the audience.
    const engagementRate: Record<string, number | null> = {}
    for (const p of PLATFORMS) {
      const data = summary.platforms[p.key]
      const followers = summary.accounts[p.key]?.followers
      if (!data || !data.available || !followers) {
        engagementRate[p.key] = null
        continue
      }
      const withStats = data.posts.filter((post) => post.stats)
      if (withStats.length === 0) {
        engagementRate[p.key] = null
        continue
      }
      const interactions = withStats.reduce(
        (sum, post) => sum + (post.stats!.likes ?? 0) + (post.stats!.comments ?? 0) + (post.stats!.shares ?? 0),
        0,
      )
      engagementRate[p.key] = (interactions / withStats.length / followers) * 100
    }

    // One row per post, combining every platform it went out on.
    const rowsById = new Map<
      number,
      { post_id: number; title: string; published_at: string | null; platforms: string[]; views: number; likes: number; comments: number; shares: number; hasStats: boolean }
    >()
    for (const [key, data] of Object.entries(summary.platforms)) {
      for (const post of data.posts ?? []) {
        const row = rowsById.get(post.post_id) ?? {
          post_id: post.post_id,
          title: post.title,
          published_at: post.published_at,
          platforms: [],
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          hasStats: false,
        }
        row.platforms.push(key)
        if (post.published_at && (!row.published_at || post.published_at > row.published_at)) row.published_at = post.published_at
        if (post.stats) {
          row.hasStats = true
          row.views += post.stats.views ?? 0
          row.likes += post.stats.likes ?? 0
          row.comments += post.stats.comments ?? 0
          row.shares += post.stats.shares ?? 0
        }
        rowsById.set(post.post_id, row)
      }
    }
    const postRows = [...rowsById.values()].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))

    return { published, needsAttention, timeline, statusData, platformBars, topPosts, totalAudience, engagementRate, postRows }
  }, [summary])

  const connectedCount = summary ? Object.values(summary.connected).filter(Boolean).length : 0

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title="Performance overview"
        description="Your content pipeline and engagement across every platform, in one place."
        actions={
          <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="h-4 w-4" /> Couldn't load the dashboard right now. Try refreshing.
        </div>
      )}

      {!summary && !error && (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
        </div>
      )}

      {summary && derived && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard label="Total content" value={summary.content.total_posts} hint="Everything in this workspace" icon={FileStack} from="#6a8f2e" to="#2f8a54" delay={0} />
            <KpiCard label="Published" value={derived.published} hint="Live on at least one platform" icon={Send} from="#2f7680" to="#3f6fa0" delay={0.04} />
            <KpiCard label="Upcoming" value={summary.content.upcoming} hint="Scheduled for the future" icon={Clock} from="#b5701f" to="#d9a441" delay={0.08} />
            <KpiCard label="Needs attention" value={derived.needsAttention} hint="Review, edits, or failures" icon={AlertCircle} from="#c1432c" to="#b5701f" delay={0.12} />
          </div>

          {/* Engagement strip */}
          <FadeIn delay={0.14}>
            <div className="glass-card grid grid-cols-2 divide-[var(--color-border)] p-0 sm:grid-cols-5 sm:divide-x-2">
              {[
                { label: "Audience", icon: Users, value: derived.totalAudience, color: "#2f7680", caption: "Followers across platforms" },
                { label: "Views", icon: Eye, value: summary.totals.views, color: "#6a8f2e" },
                { label: "Likes", icon: Heart, value: summary.totals.likes, color: "#c1432c" },
                { label: "Comments", icon: MessageCircle, value: summary.totals.comments, color: "#3f6fa0" },
                { label: "Shares", icon: Repeat2, value: summary.totals.shares, color: "#8a4f9e" },
              ].map((e) => (
                <div key={e.label} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: e.color + "1f" }}>
                    <e.icon className="h-4 w-4" style={{ color: e.color } as React.CSSProperties} />
                  </div>
                  <div>
                    <div className="font-[var(--font-display)] text-xl font-bold leading-none">{fmt(e.value)}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {"caption" in e ? e.caption : `Total ${e.label.toLowerCase()}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>

          {/* Activity timeline + status donut */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <FadeIn delay={0.18} className="lg:col-span-3">
              <div className="glass-card h-full p-5">
                <SectionTitle icon={TrendingUp} aside={<span className="text-xs text-[var(--color-text-faint)]">Last 8 weeks + next 4</span>}>
                  Publishing activity
                </SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={derived.timeline} margin={{ left: -20, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="g-scheduled" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#b5701f" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#b5701f" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g-published" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2f8a54" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#2f8a54" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,26,20,0.08)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#948d7d" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#948d7d" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="Scheduled" stroke="#b5701f" strokeWidth={2.5} fill="url(#g-scheduled)" />
                    <Area type="monotone" dataKey="Published" stroke="#2f8a54" strokeWidth={2.5} fill="url(#g-published)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </FadeIn>

            <FadeIn delay={0.22} className="lg:col-span-2">
              <div className="glass-card flex h-full flex-col p-5">
                <SectionTitle>Content status</SectionTitle>
                {derived.statusData.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
                    No content yet.
                  </div>
                ) : (
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={derived.statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={2} stroke="none">
                          {derived.statusData.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-x-0 top-[72px] text-center">
                      <div className="font-[var(--font-display)] text-2xl font-bold">{summary.content.total_posts}</div>
                      <div className="text-[11px] text-[var(--color-text-faint)]">posts</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {derived.statusData.map((d) => (
                        <div key={d.name} className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                            <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                            {d.name}
                          </span>
                          <span className="font-semibold">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </FadeIn>
          </div>

          {/* Platforms */}
          <FadeIn delay={0.26}>
            <SectionTitle aside={<span className="text-xs text-[var(--color-text-faint)]">{connectedCount} of {PLATFORMS.length} connected</span>}>
              Platforms
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PLATFORMS.map((p) => {
                const isConnected = summary.connected[p.key]
                const counts = summary.content.per_platform[p.key] ?? { posted: 0, failed: 0, queued: 0 }
                const data = summary.platforms[p.key]
                return (
                  <div key={p.key} className="glass-card relative overflow-hidden p-5">
                    <div className="absolute inset-x-0 top-0 h-1" style={{ background: isConnected ? p.color : "rgba(28,26,20,0.08)" }} />
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-lg"
                          style={{ background: isConnected ? p.color : "rgba(28,26,20,0.06)" }}
                        >
                          <p.icon className={"h-4 w-4 " + (isConnected ? "text-white" : "text-[var(--color-text-faint)]")} />
                        </div>
                        <div className="font-semibold">{p.label}</div>
                      </div>
                      {isConnected ? (
                        <span className="flex items-center gap-1 rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]">
                          <CheckCircle2 className="h-3 w-3" /> Connected
                        </span>
                      ) : (
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-faint)]">
                          Not connected
                        </span>
                      )}
                    </div>

                    {isConnected && summary.accounts[p.key] && (
                      <div className="mb-4">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <div className="font-[var(--font-display)] text-3xl font-bold leading-none tracking-tight">
                              {fmt(summary.accounts[p.key].followers)}
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-text-muted)]">{summary.accounts[p.key].followers_label}</div>
                          </div>
                          {derived.engagementRate[p.key] !== null && (
                            <div className="text-right">
                              <div className="font-[var(--font-display)] text-lg font-bold leading-none" style={{ color: p.color }}>
                                {derived.engagementRate[p.key]!.toFixed(2)}%
                              </div>
                              <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Engagement rate</div>
                            </div>
                          )}
                        </div>
                        {summary.accounts[p.key].metrics.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {summary.accounts[p.key].metrics.map((m) => (
                              <span key={m.label} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                                {m.label} <span className="font-semibold text-[var(--color-text)]">{fmt(m.value)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: "Published", value: counts.posted },
                        { label: "Queued", value: counts.queued },
                        { label: "Failed", value: counts.failed },
                      ].map((s) => (
                        <div key={s.label} className="rounded-md bg-black/[0.03] py-2">
                          <div className="font-[var(--font-display)] text-lg font-bold leading-none">{s.value}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs">
                      {!isConnected ? (
                        <Link to="/settings" className="font-semibold text-[var(--color-primary)] hover:underline">
                          Connect {p.label} →
                        </Link>
                      ) : data && data.available ? (
                        <div className="flex items-center gap-4 text-[var(--color-text-muted)]">
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {fmt(data.totals.views)}</span>
                          <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {fmt(data.totals.likes)}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {fmt(data.totals.comments)}</span>
                        </div>
                      ) : (
                        <span className="text-[var(--color-text-faint)]">
                          {data && !data.available ? "Engagement stats need platform approval" : "Engagement appears after first post"}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </FadeIn>

          {/* Distribution + top posts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <FadeIn delay={0.3} className="lg:col-span-3">
              <div className="glass-card h-full p-5">
                <SectionTitle>Posts by platform</SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={derived.platformBars} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,26,20,0.08)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b6558" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#948d7d" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(28,26,20,0.04)" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Published" stackId="a" fill="#2f8a54" />
                    <Bar dataKey="Queued" stackId="a" fill="#d9c9a3" />
                    <Bar dataKey="Failed" stackId="a" fill="#c1432c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </FadeIn>

            <FadeIn delay={0.34} className="lg:col-span-2">
              <div className="glass-card flex h-full flex-col p-5">
                <SectionTitle>Top performing posts</SectionTitle>
                {derived.topPosts.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                    <TrendingUp className="h-8 w-8 text-[var(--color-text-faint)]" />
                    <p className="max-w-[240px] text-sm text-[var(--color-text-muted)]">
                      Your best posts will rank here once published posts start getting engagement.
                    </p>
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {derived.topPosts.map((post, i) => {
                      const meta = PLATFORMS.find((p) => p.key === post.platform)!
                      return (
                        <li key={`${post.platform}-${post.post_id}`}>
                          <Link
                            to={`/posts/${post.post_id}?tab=Insights`}
                            className="flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-black/[0.03]"
                          >
                            <span className="w-4 font-[var(--font-display)] text-sm font-bold text-[var(--color-text-faint)]">{i + 1}</span>
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: meta.color }}>
                              <meta.icon className="h-3.5 w-3.5 text-white" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{post.title || "Untitled"}</span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
                              <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmt(post.stats?.likes ?? 0)}</span>
                              <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmt(post.stats?.comments ?? 0)}</span>
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            </FadeIn>
          </div>

          {/* Per-post performance */}
          <FadeIn delay={0.38}>
            <div className="glass-card overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">
                <SectionTitle>Post performance</SectionTitle>
                <Link to="/insights" className="-mt-4 text-xs font-bold text-[var(--color-primary)] hover:underline">
                  See all posts from your accounts →
                </Link>
              </div>
              {derived.postRows.length === 0 ? (
                <p className="px-5 pb-6 text-sm text-[var(--color-text-muted)]">
                  Published posts appear here with their views, likes and comments on every platform.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-y border-[var(--color-border)] bg-black/[0.02] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
                        <th className="px-5 py-2.5">Post</th>
                        <th className="px-3 py-2.5">Platforms</th>
                        <th className="px-3 py-2.5 text-right">Views</th>
                        <th className="px-3 py-2.5 text-right">Likes</th>
                        <th className="px-3 py-2.5 text-right">Comments</th>
                        <th className="px-3 py-2.5 text-right">Shares</th>
                        <th className="px-5 py-2.5 text-right">Engagement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {derived.postRows.map((row) => {
                        const interactions = row.likes + row.comments + row.shares
                        return (
                          <tr key={row.post_id} className="group border-b border-[var(--color-border)] last:border-b-0">
                            <td className="max-w-[280px] px-5 py-3">
                              <Link to={`/posts/${row.post_id}?tab=Insights`} className="block">
                                <div className="truncate font-semibold group-hover:text-[var(--color-primary)]">{row.title || "Untitled"}</div>
                                <div className="text-xs text-[var(--color-text-faint)]">
                                  {row.published_at ? new Date(row.published_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}
                                </div>
                              </Link>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex -space-x-1">
                                {row.platforms.map((k) => {
                                  const b = BRAND_PLATFORMS.find((x) => x.key === k)
                                  return b ? (
                                    <span key={k} title={b.label} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-white shadow-sm">
                                      <b.logo className={k === "youtube" ? "h-3 w-4" : "h-4 w-4"} />
                                    </span>
                                  ) : null
                                })}
                              </div>
                            </td>
                            {[row.views, row.likes, row.comments, row.shares].map((v, i) => (
                              <td key={i} className="px-3 py-3 text-right font-semibold tabular-nums">
                                {row.hasStats ? fmt(v) : <span className="text-[var(--color-text-faint)]">—</span>}
                              </td>
                            ))}
                            <td className="px-5 py-3 text-right">
                              {row.hasStats && row.views ? (
                                <span className="rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-xs font-bold text-[var(--color-success)]">
                                  {((interactions / row.views) * 100).toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-[var(--color-text-faint)]">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </FadeIn>
        </div>
      )}
    </div>
  )
}
