import { AnimatePresence, motion } from "framer-motion"
import { ArrowDownRight, ArrowUpRight, Check, Eye, GitCompare, Heart, Info, MessageCircle, Plus, RefreshCw, Search, Sparkles, Trash2, TrendingUp, Users, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { api, ApiError } from "../api/client"
import { FacebookBrand, InstagramBrand, XBrand, YouTubeBrand } from "../components/BrandLogos"
import { Button, PageHeader, Spinner } from "../components/ui"

type Platform = "instagram" | "youtube" | "facebook" | "x"

interface Post {
  id: string
  caption: string
  thumbnail: string
  permalink: string
  published_at: string | null
  type: string
  likes: number | null
  comments: number | null
  views: number | null
  engagement: number | null
}

interface Profile {
  platform: Platform
  handle: string
  external_id: string
  name: string
  avatar: string
  bio: string
  url: string
  followers: number
  following: number | null
  posts_count: number | null
  total_views?: number
  sample_size: number
  avg_likes: number | null
  avg_comments: number | null
  avg_views: number | null
  engagement_rate: number | null
  posts_per_week: number | null
  last_post_at: string | null
  content_mix?: { type: string; count: number }[]
  best_days?: { day: string; posts: number; avg_engagement: number }[]
  top_hashtags?: { tag: string; count: number }[]
  top_posts?: Post[]
  recent_posts?: Post[]
  reason?: string
}

interface Growth {
  since: string
  days: number
  followers_change: number
  followers_change_pct: number | null
}

interface Row {
  id: number
  platform: Platform
  handle: string
  name: string
  avatar: string
  profile: Profile | null
  error: string | null
  growth: Growth | null
}

interface ListResponse {
  sources: Record<Platform, { ready: boolean; reason: string | null }>
  you: Partial<Record<Platform, Profile>>
  competitors: Row[]
}

const PLATFORM_META: Record<Platform, { label: string; logo: typeof InstagramBrand; follower: string; color: string }> = {
  instagram: { label: "Instagram", logo: InstagramBrand, follower: "Followers", color: "#c13584" },
  youtube: { label: "YouTube", logo: YouTubeBrand, follower: "Subscribers", color: "#e62117" },
  facebook: { label: "Facebook", logo: FacebookBrand, follower: "Followers", color: "#1877f2" },
  x: { label: "X", logo: XBrand, follower: "Followers", color: "#111111" },
}

const ALL_PLATFORMS: Platform[] = ["instagram", "facebook", "youtube", "x"]
const trackKey = (p: { platform: Platform; handle: string; external_id: string }) =>
  p.platform === "youtube" || p.platform === "facebook" ? p.external_id : p.handle

function compact(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—"
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(digits).replace(/\.0$/, "") + "B"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(digits).replace(/\.0$/, "") + "M"
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(digits).replace(/\.0$/, "") + "K"
  return Math.round(n).toLocaleString()
}

function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) return <img src={src} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name[0] ?? "?").toUpperCase()}
    </span>
  )
}

function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[8vh] backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className={"w-full rounded-2xl bg-white shadow-2xl " + (wide ? "max-w-3xl" : "max-w-md")}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="font-[var(--font-display)] text-lg font-bold">{title}</h3>
              <button onClick={onClose} className="rounded-full p-1.5 hover:bg-black/5" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Delta({ value, base, suffix = "" }: { value: number | null; base: number | null | undefined; suffix?: string }) {
  if (value === null || base === null || base === undefined || base === 0) return null
  const diff = ((value - base) / Math.abs(base)) * 100
  if (!isFinite(diff) || Math.abs(diff) < 0.5) return <span className="text-[10px] font-semibold text-[var(--color-text-faint)]">same as you{suffix}</span>
  const up = diff > 0
  return (
    <span className={"inline-flex items-center text-[10px] font-bold " + (up ? "text-[var(--color-danger)]" : "text-[var(--color-success)]")}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(diff) >= 1000 ? `${Math.round(diff / 100)}×` : `${Math.abs(diff).toFixed(0)}%`} vs you
    </span>
  )
}

/* ---------------- Detail drawer ---------------- */

function DetailDrawer({
  target,
  you,
  onClose,
  onTrack,
}: {
  target: { platform: Platform; handle: string; isYou?: boolean } | null
  you?: Profile
  onClose: () => void
  onTrack: (platform: Platform, handle: string) => Promise<void>
}) {
  const [data, setData] = useState<{ profile: Profile; tracked_id: number | null; history: { day: string; followers: number }[]; growth: Growth | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState(false)

  useEffect(() => {
    if (!target) return
    setData(null)
    setError(null)
    api
      .get<typeof data>(`/competitors/profile?platform=${target.platform}&handle=${encodeURIComponent(target.isYou ? "me" : target.handle)}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this account"))
  }, [target])

  useEffect(() => {
    if (!target) return
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [target, onClose])

  const p = data?.profile
  const meta = target ? PLATFORM_META[target.platform] : null
  const compareTo = target?.isYou ? undefined : you

  const kpis = p
    ? [
        { label: meta!.follower, value: p.followers, base: compareTo?.followers, icon: Users },
        { label: "Posts per week", value: p.posts_per_week, base: compareTo?.posts_per_week, icon: TrendingUp, raw: true },
        ...(p.platform === "youtube" ? [{ label: "Avg. views", value: p.avg_views, base: compareTo?.avg_views, icon: Eye }] : []),
        { label: "Avg. likes", value: p.avg_likes, base: compareTo?.avg_likes, icon: Heart },
        { label: "Avg. comments", value: p.avg_comments, base: compareTo?.avg_comments, icon: MessageCircle },
        { label: "Engagement rate", value: p.engagement_rate, base: compareTo?.engagement_rate, icon: Sparkles, pct: true },
      ]
    : []

  return createPortal(
    <AnimatePresence>
      {target && (
        <>
          <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-[2px]" />
          <motion.aside
            key="d"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="fixed inset-y-0 right-0 z-[56] w-full max-w-[760px] overflow-y-auto bg-[var(--color-bg)] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-white/90 px-6 py-3 backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-bold">
                {meta && <meta.logo className={target.platform === "youtube" ? "h-4 w-6" : "h-5 w-5"} />} {target.isYou ? "Your account" : "Competitor profile"}
              </div>
              <button onClick={onClose} className="rounded-full p-2 hover:bg-black/5" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {!data && !error && (
              <div className="flex justify-center py-24">
                <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
              </div>
            )}
            {error && <p className="px-6 py-16 text-center text-sm text-[var(--color-danger)]">{error}</p>}

            {p && (
              <div className="space-y-6 px-6 py-6">
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar src={p.avatar} name={p.name} size={72} />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-[var(--font-display)] text-2xl font-bold leading-tight">{p.name}</h2>
                    <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary)] hover:underline">
                      {p.handle.startsWith("@") || p.platform === "youtube" ? p.handle : `@${p.handle}`} <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                    {p.bio && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-[var(--color-text-muted)]">{p.bio}</p>}
                  </div>
                  {!target.isYou &&
                    (data.tracked_id ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-xs font-bold text-[var(--color-success)]">
                        <Check className="h-3.5 w-3.5" /> Tracking
                      </span>
                    ) : (
                      <Button
                        disabled={tracking}
                        onClick={async () => {
                          setTracking(true)
                          try {
                            await onTrack(p.platform, trackKey(p))
                            setData((d) => (d ? { ...d, tracked_id: -1 } : d))
                          } finally {
                            setTracking(false)
                          }
                        }}
                      >
                        {tracking ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Track
                      </Button>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {kpis.map((k) => (
                    <div key={k.label} className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                        <k.icon className="h-3.5 w-3.5" /> {k.label}
                      </div>
                      <div className="mt-1.5 font-[var(--font-display)] text-2xl font-bold leading-none">
                        {k.value === null || k.value === undefined ? "—" : k.pct ? `${k.value}%` : k.raw ? k.value : compact(k.value)}
                      </div>
                      <div className="mt-1 h-4">{compareTo && <Delta value={k.value ?? null} base={k.base} />}</div>
                    </div>
                  ))}
                </div>
                <p className="-mt-3 text-[11px] text-[var(--color-text-faint)]">
                  Averages from their latest {p.sample_size} {p.platform === "youtube" ? "videos" : "posts"}.{" "}
                  {p.platform === "youtube" ? "Engagement = (likes + comments) ÷ views." : "Engagement = (likes + comments) ÷ followers."}
                </p>

                {data.history.length > 1 ? (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                    <div className="mb-2 flex items-center justify-between text-sm font-bold">
                      {meta!.follower} over time
                      {data.growth && (
                        <span className={"text-xs " + (data.growth.followers_change >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")}>
                          {data.growth.followers_change >= 0 ? "+" : ""}
                          {compact(data.growth.followers_change)} in {data.growth.days} days
                        </span>
                      )}
                    </div>
                    <ResponsiveContainer width="100%" height={140}>
                      <LineChart data={data.history}>
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#948d7d" }} axisLine={false} tickLine={false} />
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        <Tooltip formatter={(v) => Number(v).toLocaleString()} />
                        <Line type="monotone" dataKey="followers" stroke={meta!.color} strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  !target.isYou && (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      <TrendingUp className="h-4 w-4 shrink-0" /> Growth tracking builds up daily from the day you track an account - check back to see their follower trend.
                    </div>
                  )
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {p.best_days && p.best_days.length > 0 && (
                    <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                      <div className="mb-2 text-sm font-bold">Best days to post</div>
                      <ResponsiveContainer width="100%" height={150}>
                        <BarChart data={p.best_days}>
                          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6b6558" }} axisLine={false} tickLine={false} />
                          <YAxis hide />
                          <Tooltip formatter={(v) => `${v}% avg engagement`} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                          <Bar dataKey="avg_engagement" radius={[5, 5, 0, 0]}>
                            {p.best_days.map((d) => {
                              const top = Math.max(...p.best_days!.map((x) => x.avg_engagement))
                              return <Cell key={d.day} fill={d.avg_engagement === top ? meta!.color : "rgba(28,26,20,0.15)"} />
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {p.content_mix && p.content_mix.length > 0 && (
                    <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                      <div className="mb-2 text-sm font-bold">Content mix</div>
                      <div className="flex items-center gap-4">
                        <ResponsiveContainer width={130} height={130}>
                          <PieChart>
                            <Pie data={p.content_mix} dataKey="count" nameKey="type" innerRadius={38} outerRadius={60} stroke="none">
                              {p.content_mix.map((c, i) => (
                                <Cell key={c.type} fill={["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e"][i % 4]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-1.5">
                          {p.content_mix.map((c, i) => (
                            <div key={c.type} className="flex items-center gap-2 text-xs">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e"][i % 4] }} />
                              <span className="font-semibold">{c.type}</span>
                              <span className="text-[var(--color-text-faint)]">{Math.round((c.count / p.sample_size) * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {p.top_hashtags && p.top_hashtags.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-bold">Hashtags they use most</div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.top_hashtags.map((t) => (
                        <span key={t.tag} className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-semibold">
                          #{t.tag} <span className="text-[var(--color-text-faint)]">{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {p.top_posts && p.top_posts.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-bold">Top performing {p.platform === "youtube" ? "videos" : "posts"}</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {p.top_posts.map((post) => (
                        <a key={post.id} href={post.permalink} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-white transition hover:-translate-y-0.5 hover:shadow-md">
                          <div className={"relative bg-black/5 " + (p.platform === "youtube" ? "aspect-video" : "aspect-square")}>
                            {post.thumbnail && <img src={post.thumbnail} loading="lazy" className="h-full w-full object-cover" />}
                            <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">{post.type}</span>
                          </div>
                          <div className="space-y-1 p-2.5">
                            <p className="line-clamp-2 text-xs font-medium">{post.caption.split("\n")[0] || "No caption"}</p>
                            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--color-text-muted)]">
                              {post.views !== null && <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{compact(post.views)}</span>}
                              <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{compact(post.likes)}</span>
                              <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{compact(post.comments)}</span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ---------------- Side-by-side compare ---------------- */

function CompareDrawer({
  you,
  platform,
  initial,
  onClose,
}: {
  you?: Profile
  platform: Platform
  initial: Row | null
  onClose: () => void
}) {
  const [hideTies, setHideTies] = useState(false)

  useEffect(() => {
    if (initial) setHideTies(false)
  }, [initial])

  useEffect(() => {
    if (!initial) return
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [initial, onClose])

  const open = !!initial
  const right = initial
  const rp = right?.profile
  const meta = PLATFORM_META[platform]

  const groups: { title: string; rows: { label: string; key: keyof Profile; pct?: boolean; raw?: boolean }[] }[] = [
    {
      title: "Reach",
      rows: [
        { label: meta.follower, key: "followers" },
        { label: "Posts / week", key: "posts_per_week", raw: true },
      ],
    },
    {
      title: "Engagement",
      rows: [
        ...(platform === "youtube" ? [{ label: "Avg. views", key: "avg_views" as const }] : []),
        { label: "Avg. likes", key: "avg_likes" },
        { label: "Avg. comments", key: "avg_comments" },
        { label: "Engagement rate", key: "engagement_rate", pct: true },
      ],
    },
  ]

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-[2px]" />
          <motion.aside
            key="d"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="fixed inset-y-0 right-0 z-[56] w-full max-w-[720px] overflow-y-auto bg-[var(--color-bg)] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-white/90 px-6 py-3 backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-bold">
                <GitCompare className="h-4 w-4" /> Compare side by side
              </div>
              <button onClick={onClose} className="rounded-full p-2 hover:bg-black/5" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Two profile columns, PakWheels-style: full-width rows split down the middle, each row divided by a hairline */}
            <div className="bg-white">
              <div className="grid grid-cols-2 px-4 py-7">
                <div className="flex justify-center">
                  <Avatar src={you?.avatar} name={you?.name ?? "You"} size={104} />
                </div>
                <div className="flex justify-center">
                  <Avatar src={rp?.avatar || right?.avatar} name={right?.name ?? "?"} size={104} />
                </div>
              </div>

              <div className="grid grid-cols-2 border-t border-[var(--color-border)] px-4 py-3 text-center">
                <a
                  href={you?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-[var(--font-display)] text-base font-bold text-[var(--color-primary)] hover:underline"
                >
                  {you?.name ?? "You"}
                </a>
                <a
                  href={rp?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-[var(--font-display)] text-base font-bold text-[var(--color-primary)] hover:underline"
                >
                  {right?.name ?? "Pick a competitor"}
                </a>
              </div>

              <div className="grid grid-cols-2 items-center border-t border-[var(--color-border)] px-4 py-3 text-center">
                <span className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--color-text-faint)]">
                  <span className="truncate">{you?.handle}</span>
                  <span className="rounded bg-[var(--color-primary)] px-1.5 py-px text-[10px] text-white">YOU</span>
                </span>
                <span className="truncate text-xs font-semibold text-[var(--color-text-faint)]">{rp?.handle ?? right?.handle}</span>
              </div>

              <div className="grid grid-cols-2 border-t border-[var(--color-border)] px-4 py-4 text-center">
                <div>
                  <div className="font-[var(--font-display)] text-3xl font-bold leading-none text-[var(--color-success)]">{compact(you?.followers ?? null)}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{meta.follower}</div>
                </div>
                <div>
                  <div className="font-[var(--font-display)] text-3xl font-bold leading-none text-[var(--color-success)]">{compact(rp?.followers ?? null)}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{meta.follower}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 border-t border-[var(--color-border)] px-4 py-3 text-center text-xs font-semibold text-[var(--color-text-muted)]">
                <span className="inline-flex items-center justify-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-warning)]" /> {you?.engagement_rate ?? "—"}% engagement
                </span>
                <span className="inline-flex items-center justify-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-warning)]" /> {rp?.engagement_rate ?? "—"}% engagement
                </span>
              </div>

              <div className="grid grid-cols-2 border-t border-[var(--color-border)] px-4 py-3 text-center text-sm font-semibold">
                <a href={you?.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 text-[var(--color-primary)] hover:underline">
                  View your profile <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
                {rp ? (
                  <a href={rp.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 text-[var(--color-primary)] hover:underline">
                    View their profile <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-[var(--color-text-faint)]">—</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t-8 border-[var(--color-bg)] bg-white px-6 py-4">
              <h3 className="font-[var(--font-display)] text-lg font-bold">Compare metrics</h3>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
                <input type="checkbox" checked={hideTies} onChange={(e) => setHideTies(e.target.checked)} /> Hide ties
              </label>
            </div>

            {!rp && <p className="bg-white px-6 py-10 text-center text-sm text-[var(--color-text-faint)]">This competitor doesn't have enough data to compare yet.</p>}

            {rp &&
              groups.map((g) => (
                <div key={g.title} className="bg-white">
                  <div className="bg-black/[0.04] px-6 py-2.5 text-sm font-bold">{g.title}</div>
                  {g.rows.map((row, i) => {
                    const a = you ? (you[row.key] as number | null) : null
                    const b = rp[row.key] as number | null
                    const tie = a != null && b != null && a === b
                    if (hideTies && tie) return null
                    const aWin = a != null && b != null && a > b
                    const bWin = a != null && b != null && b > a
                    const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : row.pct ? `${v}%` : row.raw ? v : compact(v))
                    return (
                      <div
                        key={row.label}
                        className={"grid grid-cols-[1fr_1fr_1fr] items-center border-b border-[var(--color-border)] px-6 py-3 text-sm " + (i % 2 ? "bg-black/[0.015]" : "")}
                      >
                        <div className="text-[var(--color-text-faint)]">{row.label}</div>
                        <div className={"text-center tabular-nums " + (aWin ? "font-bold text-[var(--color-success)]" : "text-[var(--color-text-muted)]")}>{fmt(a)}</div>
                        <div className={"text-center tabular-nums " + (bWin ? "font-bold text-[var(--color-success)]" : "text-[var(--color-text-muted)]")}>{fmt(b)}</div>
                      </div>
                    )
                  })}
                </div>
              ))}

            {rp && (
              <div className="bg-white px-6 py-3 text-[11px] text-[var(--color-text-faint)]">
                Averages from each account's latest 25 {platform === "youtube" ? "videos" : "posts"}.
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ---------------- Page ---------------- */

export function Competitors() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [platform, setPlatform] = useState<Platform>("youtube")
  const [detail, setDetail] = useState<{ platform: Platform; handle: string; isYou?: boolean } | null>(null)
  const [compare, setCompare] = useState<Row | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    setRefreshing(true)
    try {
      const res = await api.get<ListResponse>(`/competitors${force ? "?refresh=true" : ""}`)
      setData(res)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load competitors")
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (data && !data.sources[platform]?.ready) {
      const firstReady = ALL_PLATFORMS.find((p) => data.sources[p]?.ready)
      if (firstReady) setPlatform(firstReady)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const flash = (t: string) => {
    setToast(t)
    setTimeout(() => setToast(null), 3000)
  }

  const track = useCallback(
    async (p: Platform, handle: string) => {
      try {
        const res = await api.post<{ name: string }>("/competitors", { platform: p, handle })
        flash(`Now tracking ${res.name}`)
        await load()
      } catch (err) {
        flash(err instanceof ApiError ? err.message : "Couldn't add this account")
        throw err
      }
    },
    [load],
  )

  async function remove(row: Row) {
    await api.delete(`/competitors/${row.id}`)
    setData((d) => (d ? { ...d, competitors: d.competitors.filter((c) => c.id !== row.id) } : d))
    flash(`Stopped tracking ${row.name}`)
  }

  const you = data?.you[platform]
  const rows = useMemo(() => (data?.competitors ?? []).filter((c) => c.platform === platform), [data, platform])
  const source = data?.sources[platform]
  const meta = PLATFORM_META[platform]

  const columns: { key: keyof Profile; label: string; pct?: boolean; raw?: boolean; youtubeOnly?: boolean }[] = [
    { key: "followers", label: meta.follower },
    { key: "posts_per_week", label: "Posts / week", raw: true },
    { key: "avg_views", label: "Avg. views", youtubeOnly: true },
    { key: "avg_likes", label: "Avg. likes" },
    { key: "avg_comments", label: "Avg. comments" },
    { key: "engagement_rate", label: "Engagement", pct: true },
  ]
  const visibleCols = columns.filter((c) => !c.youtubeOnly || platform === "youtube")
  const best: Partial<Record<keyof Profile, number>> = {}
  for (const c of visibleCols) {
    const vals = [you, ...rows.map((r) => r.profile)].map((p) => (p ? (p[c.key] as number | null) : null)).filter((v): v is number => v !== null && v !== undefined)
    if (vals.length > 1) best[c.key] = Math.max(...vals)
  }

  const cell = (p: Profile | null | undefined, c: (typeof columns)[number]) => {
    const v = p ? (p[c.key] as number | null) : null
    if (v === null || v === undefined) return <span className="text-[var(--color-text-faint)]">—</span>
    const isBest = best[c.key] === v
    return (
      <span className={isBest ? "font-bold text-[var(--color-success)]" : ""}>
        {c.pct ? `${v}%` : c.raw ? v : compact(v)}
      </span>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Competitors"
        description="See how accounts in your niche perform - followers, posting rhythm, engagement and what's working for them - side by side with you."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} /> Refresh
            </Button>
            <Button variant="outline" onClick={() => setShowAdd(true)} disabled={!source?.ready}>
              <Plus className="h-4 w-4" /> Add by handle
            </Button>
            {(platform === "youtube" || platform === "instagram") && (
              <Button onClick={() => setShowFind(true)} disabled={!source?.ready}>
                <Sparkles className="h-4 w-4" /> Find by niche
              </Button>
            )}
          </div>
        }
      />

      <UniversalSearch
        onOpen={(p, handle) => setDetail({ platform: p, handle })}
        onTrack={track}
        tracked={new Set((data?.competitors ?? []).map((c) => `${c.platform}:${c.handle}`))}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {ALL_PLATFORMS.map((p) => {
          const m = PLATFORM_META[p]
          const count = data?.competitors.filter((c) => c.platform === p).length ?? 0
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={
                "inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition " +
                (platform === p ? "border-[var(--color-primary)] bg-white shadow-sm" : "border-transparent bg-black/[0.03] text-[var(--color-text-muted)] hover:bg-black/[0.05]")
              }
            >
              <m.logo className={p === "youtube" ? "h-4 w-6" : "h-5 w-5"} /> {m.label}
              <span className="rounded-full bg-black/[0.06] px-2 text-xs">{count}</span>
              {data && !data.sources[p]?.ready && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" title="Needs setup" />}
            </button>
          )
        })}
      </div>

      {!data && !error && (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
        </div>
      )}
      {error && <p className="py-10 text-center text-sm text-[var(--color-danger)]">{error}</p>}

      {data && source && !source.ready && (
        <div className="glass-card flex items-start gap-3 p-5">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" />
          <div className="text-sm">
            <p className="font-bold">{meta.label} competitor research isn't set up yet</p>
            <p className="mt-1 text-[var(--color-text-muted)]">{source.reason}</p>
          </div>
        </div>
      )}

      {data && source?.ready && (
        <div className="glass-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-black/[0.02] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
                  <th className="px-5 py-3">Account</th>
                  {visibleCols.map((c) => (
                    <th key={String(c.key)} className="px-3 py-3 text-right">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right">Growth</th>
                  <th className="w-20 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {you && (
                  <tr onClick={() => setDetail({ platform, handle: "me", isYou: true })} className="cursor-pointer border-b border-[var(--color-border)] bg-[var(--color-primary)]/[0.06] hover:bg-[var(--color-primary)]/10">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={you.avatar} name={you.name} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-bold">
                            {you.name} <span className="rounded bg-[var(--color-primary)] px-1.5 py-px text-[10px] text-white">YOU</span>
                          </div>
                          <div className="truncate text-xs text-[var(--color-text-faint)]">{you.handle}</div>
                        </div>
                      </div>
                    </td>
                    {visibleCols.map((c) => (
                      <td key={String(c.key)} className="px-3 py-3 text-right tabular-nums">
                        {cell(you, c)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right text-[var(--color-text-faint)]">—</td>
                    <td />
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => r.profile && setCompare(r)} className="group cursor-pointer border-b border-[var(--color-border)] last:border-b-0 hover:bg-black/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={r.profile?.avatar || r.avatar} name={r.name} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{r.name}</div>
                          <div className="truncate text-xs text-[var(--color-text-faint)]">{r.error ?? r.profile?.handle ?? r.handle}</div>
                        </div>
                      </div>
                    </td>
                    {visibleCols.map((c) => (
                      <td key={String(c.key)} className="px-3 py-3 text-right tabular-nums">
                        {cell(r.profile, c)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right text-xs font-semibold">
                      {r.growth ? (
                        <span className={r.growth.followers_change >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                          {r.growth.followers_change >= 0 ? "+" : ""}
                          {r.growth.followers_change_pct ?? 0}% <span className="font-normal text-[var(--color-text-faint)]">/ {r.growth.days}d</span>
                        </span>
                      ) : (
                        <span className="font-normal text-[var(--color-text-faint)]">tracking</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDetail({ platform, handle: r.handle })
                          }}
                          disabled={!r.profile}
                          className="rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] disabled:opacity-40"
                          aria-label="View full profile"
                          title="View full profile"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            remove(r)
                          }}
                          className="rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                          aria-label="Stop tracking"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10">
                <Users className="h-6 w-6 text-[var(--color-primary)]" />
              </div>
              <p className="font-semibold">No {meta.label} competitors yet</p>
              <p className="max-w-sm text-sm text-[var(--color-text-muted)]">Find accounts in your niche, or add one you already know, to compare them with you here.</p>
              <div className="flex gap-2">
                {(platform === "youtube" || platform === "instagram") && (
                  <Button onClick={() => setShowFind(true)}>
                    <Sparkles className="h-4 w-4" /> Find by niche
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowAdd(true)}>
                  <Plus className="h-4 w-4" /> Add by handle
                </Button>
              </div>
            </div>
          )}
          <div className="border-t border-[var(--color-border)] bg-black/[0.015] px-5 py-2.5 text-[11px] text-[var(--color-text-faint)]">
            Green = best in each column. Averages from each account's latest 25 {platform === "youtube" ? "videos" : "posts"}. Click a row to compare it side by side with you, or the{" "}
            <Eye className="inline h-3 w-3" /> icon for their full profile.
          </div>
        </div>
      )}

      <AddModal open={showAdd} platform={platform} onClose={() => setShowAdd(false)} onAdd={track} />
      <FindModal open={showFind} platform={platform} onClose={() => setShowFind(false)} onTrack={track} onView={(h) => setDetail({ platform, handle: h })} tracked={new Set(rows.map((r) => r.handle))} />
      <DetailDrawer target={detail} you={you} onClose={() => setDetail(null)} onTrack={track} />
      <CompareDrawer you={you} platform={platform} initial={compare} onClose={() => setCompare(null)} />

      {createPortal(
        <AnimatePresence>
          {toast && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl bg-[#211f1a] px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
              {toast}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

function AddModal({ open, platform, onClose, onAdd }: { open: boolean; platform: Platform; onClose: () => void; onAdd: (p: Platform, h: string) => Promise<void> }) {
  const [handle, setHandle] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setHandle("")
      setErr(null)
    }
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title={`Add a ${PLATFORM_META[platform].label} competitor`}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!handle.trim()) return
          setBusy(true)
          setErr(null)
          try {
            await onAdd(platform, handle.trim())
            onClose()
          } catch (er) {
            setErr(er instanceof ApiError ? er.message : "Couldn't add this account")
          } finally {
            setBusy(false)
          }
        }}
      >
        <input
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={
            platform === "youtube" ? "@channelhandle or youtube.com/@channel link" : platform === "facebook" ? "Page username or facebook.com/page link" : "@username"
          }
          className="w-full rounded-xl border border-[var(--color-border-strong)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        {platform === "instagram" && <p className="text-xs text-[var(--color-text-muted)]">Must be a public Business or Creator account - personal accounts can't be looked up.</p>}
        {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy || !handle.trim()}>
          {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {busy ? "Looking up…" : "Add competitor"}
        </Button>
      </form>
    </Modal>
  )
}

function FindModal({
  open,
  platform,
  onClose,
  onTrack,
  onView,
  tracked,
}: {
  open: boolean
  platform: Platform
  onClose: () => void
  onTrack: (p: Platform, h: string) => Promise<void>
  onView: (handle: string) => void
  tracked: Set<string>
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Profile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setResults(null)
    setErr(null)
    setAdded(new Set())
    api.get<{ niche: string }>("/competitors/niche").then((r) => setQuery((q) => q || r.niche)).catch(() => {})
  }, [open])

  async function find() {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.post<{ suggestions: Profile[] }>("/competitors/suggest", { platform, query: query.trim() || null })
      setResults(res.suggestions)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Search failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Find ${PLATFORM_META[platform].label} competitors`} wide>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          find()
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe your niche, e.g. Pakistani street food vlogs"
            className="w-full rounded-xl border border-[var(--color-border-strong)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-primary)]"
          />
        </div>
        <Button type="submit" disabled={busy || !query.trim()}>
          {busy ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} {busy ? "Searching…" : "Find"}
        </Button>
      </form>
      <p className="mt-2 text-xs text-[var(--color-text-faint)]">
        {platform === "youtube"
          ? "Searches YouTube for the most relevant channels in your niche."
          : "AI suggests likely competitors, then each one is checked on Instagram - only real public accounts are shown."}
      </p>

      {err && <p className="mt-4 text-sm text-[var(--color-danger)]">{err}</p>}
      {busy && !results && (
        <div className="flex justify-center py-12">
          <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
        </div>
      )}
      {results && results.length === 0 && <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">No accounts found - try describing your niche differently.</p>}
      {results && results.length > 0 && (
        <div className="mt-4 grid max-h-[55vh] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
          {results.map((r) => {
            const key = trackKey({ ...r, platform })
            const isTracked = tracked.has(key) || added.has(key)
            return (
              <div key={key} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3">
                <Avatar src={r.avatar} name={r.name} size={44} />
                <button onClick={() => onView(key)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-bold hover:text-[var(--color-primary)]">{r.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {compact(r.followers)} {PLATFORM_META[platform].follower.toLowerCase()}
                    {r.posts_count ? ` · ${compact(r.posts_count)} ${platform === "youtube" ? "videos" : "posts"}` : ""}
                  </div>
                  {r.reason && <div className="truncate text-[11px] text-[var(--color-text-faint)]">{r.reason}</div>}
                </button>
                {isTracked ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-success)]">
                    <Check className="h-3.5 w-3.5" /> Tracking
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        await onTrack(platform, key)
                        setAdded((s) => new Set(s).add(key))
                      } catch {
                        /* toast shown by onTrack */
                      }
                    }}
                    className="rounded-lg bg-[#211f1a] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-primary)]"
                  >
                    Track
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().replace(/^@/, "")
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-[var(--color-primary)]/15 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function UniversalSearch({
  onOpen,
  onTrack,
  tracked,
}: {
  onOpen: (platform: Platform, handle: string) => void
  onTrack: (platform: Platform, handle: string) => Promise<void>
  tracked: Set<string>
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Profile[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const boxRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const cache = useRef(new Map<string, { results: Profile[]; notes: Record<string, string> }>())

  const search = useCallback(async (query: string, live: boolean) => {
    const key = `${live ? "live" : "full"}:${query.toLowerCase()}`
    const mine = ++seq.current
    const hit = cache.current.get(key)
    if (hit) {
      setResults(hit.results)
      setNotes(hit.notes)
      setBusy(false)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await api.get<{ results: Profile[]; notes: Record<string, string> }>(
        `/competitors/lookup?q=${encodeURIComponent(query)}${live ? "&live=true" : ""}`,
      )
      cache.current.set(key, res)
      if (mine !== seq.current) return // a newer keystroke already took over
      setResults(res.results)
      setNotes(res.notes)
      setActive(res.results.length ? 0 : -1)
    } catch (e) {
      if (mine === seq.current) setErr(e instanceof ApiError ? e.message : "Search failed")
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  // As-you-type: wait for a short pause and 3+ characters - every YouTube
  // name search spends 100 quota units, so not every keystroke is sent.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 3) {
      seq.current++
      setResults([])
      setBusy(false)
      return
    }
    setBusy(true)
    const t = setTimeout(() => search(query, true), 420)
    return () => clearTimeout(t)
  }, [q, search])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const choose = (r: Profile) => {
    setOpen(false)
    onOpen(r.platform, trackKey(r))
  }

  const noteEntries = Object.entries(notes)
  const showPanel = open && q.trim().length >= 3

  return (
    <div ref={boxRef} className="relative z-30 mb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (active >= 0 && results[active]) choose(results[active])
          else if (q.trim().length >= 2) {
            setOpen(true)
            search(q.trim(), false)
          }
        }}
        className={"glass-card flex items-center gap-3 p-2 pl-4 transition " + (showPanel ? "rounded-b-none border-b-transparent shadow-lg" : "")}
      >
        {busy ? <Spinner className="h-5 w-5 shrink-0 text-[var(--color-primary)]" /> : <Search className="h-5 w-5 shrink-0 text-[var(--color-text-faint)]" />}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(results.length - 1, a + 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          placeholder="Search any page or profile - start typing a name or @username"
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-[var(--color-text-faint)]"
          autoComplete="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="rounded-full p-1 text-[var(--color-text-faint)] hover:bg-black/5" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="hidden items-center gap-1.5 sm:flex">
          {ALL_PLATFORMS.map((p) => {
            const L = PLATFORM_META[p].logo
            return <L key={p} className={p === "youtube" ? "h-3.5 w-5" : "h-4 w-4"} />
          })}
        </div>
      </form>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full overflow-hidden rounded-b-2xl border border-t-0 border-[var(--color-border-strong)] bg-white shadow-2xl"
          >
            {err ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-danger)]">{err}</p>
            ) : busy && results.length === 0 ? (
              <div className="space-y-1 p-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2">
                    <span className="h-10 w-10 animate-pulse rounded-full bg-black/[0.07]" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-3 w-1/3 animate-pulse rounded bg-black/[0.07]" />
                      <span className="block h-2.5 w-1/2 animate-pulse rounded bg-black/[0.05]" />
                    </span>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                No matches yet - keep typing, or use the exact @username for Instagram, Facebook and X.
              </p>
            ) : (
              <div className={"max-h-[420px] overflow-y-auto py-1 transition-opacity " + (busy ? "opacity-60" : "")}>
                {results.map((r, i) => {
                  const m = PLATFORM_META[r.platform]
                  const key = trackKey(r)
                  const isTracked = tracked.has(`${r.platform}:${key}`) || added.has(`${r.platform}:${key}`)
                  const handle = r.platform === "youtube" || String(r.handle).startsWith("@") ? String(r.handle) : `@${r.handle}`
                  return (
                    <div
                      key={`${r.platform}:${key}`}
                      onMouseEnter={() => setActive(i)}
                      className={"flex items-center gap-3 px-3 py-2 " + (i === active ? "bg-[var(--color-primary)]/[0.07]" : "")}
                    >
                      <button onClick={() => choose(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="relative">
                          <Avatar src={r.avatar} name={r.name} size={40} />
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-white">
                            <m.logo className={r.platform === "youtube" ? "h-2 w-3" : "h-2.5 w-2.5"} />
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">
                            <Highlight text={r.name} query={q} />
                          </span>
                          <span className="block truncate text-xs text-[var(--color-text-muted)]">
                            <Highlight text={handle} query={q} /> · {compact(r.followers)} {m.follower.toLowerCase()}
                            {r.posts_count ? ` · ${compact(r.posts_count)} ${r.platform === "youtube" ? "videos" : "posts"}` : ""}
                          </span>
                        </span>
                      </button>
                      <span className={"hidden text-[11px] font-semibold text-[var(--color-text-faint)] sm:block " + (i === active ? "" : "invisible")}>Enter to compare</span>
                      {isTracked ? (
                        <span className="flex w-20 items-center justify-center gap-1 text-xs font-bold text-[var(--color-success)]">
                          <Check className="h-3.5 w-3.5" /> Tracking
                        </span>
                      ) : (
                        <button
                          onClick={async () => {
                            try {
                              await onTrack(r.platform, key)
                              setAdded((s) => new Set(s).add(`${r.platform}:${key}`))
                            } catch {
                              /* toast shown by onTrack */
                            }
                          }}
                          className="w-20 rounded-lg bg-[#211f1a] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-primary)]"
                        >
                          Track
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {noteEntries.length > 0 && !err && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] bg-black/[0.02] px-4 py-2 text-[11px] text-[var(--color-text-faint)]">
                <Info className="h-3 w-3" />
                {noteEntries.map(([k, v]) => (
                  <span key={k} title={v} className="cursor-help underline decoration-dotted">
                    {k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)} not searched
                  </span>
                ))}
                <span className="ml-auto">Press Enter to search all platforms</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
