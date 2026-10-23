import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Heart,
  Info,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Repeat2,
  Search,
  TrendingUp,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { BoostButton } from "../components/BoostButton"
import { BRAND_PLATFORMS } from "../components/BrandLogos"
import { ManagePostDrawer, type ManageTarget } from "../components/ManagePostDrawer"
import { Button, PageHeader, Spinner } from "../components/ui"
import { useAuth } from "../lib/auth"
import { exportPostReport } from "../lib/exportReport"

interface Metric {
  key: string
  label: string
  value: number
}

interface ContentItem {
  platform: string
  id: string
  caption: string
  thumbnail: string
  permalink: string
  published_at: string | null
  media_type: string
  available: boolean
  pending?: boolean
  reason?: string
  primary?: string | null
  metrics?: Metric[]
  interactions?: number
  engagement_rate?: number | null
  reelmind_post_id: number | null
}

type PlatformStatus = Record<string, { ok: boolean; count: number; note?: string }>

interface ContentResponse {
  items: ContentItem[]
  platforms: PlatformStatus
  fetched_at: string
}

type SortKey = "newest" | "views" | "likes" | "comments" | "engagement"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "views", label: "Most views" },
  { key: "likes", label: "Most likes" },
  { key: "comments", label: "Most comments" },
  { key: "engagement", label: "Best engagement" },
]

const PAGE_SIZES = [10, 20, 50]
const BACKGROUND_CHUNK = 25

const keyOf = (i: ContentItem) => `${i.platform}:${i.id}`

function cols(item: ContentItem) {
  const m = Object.fromEntries((item.metrics ?? []).map((x) => [x.key, x.value]))
  const first = (...keys: string[]) => keys.map((k) => m[k]).find((v) => v !== undefined) ?? null
  return {
    views: first("views", "impressions", "reach") as number | null,
    likes: first("likes", "reactions") as number | null,
    comments: first("comments", "replies") as number | null,
    shares: first("shares", "reposts") as number | null,
  }
}

function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toLocaleString()
}

function logoFor(platform: string) {
  return BRAND_PLATFORMS.find((p) => p.key === platform)
}

function Skeleton() {
  return <span className="ml-auto block h-3.5 w-10 animate-pulse rounded bg-black/[0.08]" />
}

/** Page numbers with ellipses: 1 … 4 5 6 … 12 */
function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "…")[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push("…")
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push("…")
  pages.push(total)
  return pages
}

const MANAGEABLE = new Set(["instagram", "facebook", "youtube", "x"])

function Row({ item, open, onToggle, onManage }: { item: ContentItem; open: boolean; onToggle: () => void; onManage: () => void }) {
  const brand = logoFor(item.platform)
  const c = cols(item)
  const cell = (v: number | null, needsDetails: boolean) =>
    item.pending && needsDetails ? <Skeleton /> : item.available ? compact(v) : <span className="text-[var(--color-text-faint)]">—</span>

  return (
    <div className={"border-b border-[var(--color-border)] last:border-b-0 " + (open ? "bg-black/[0.015]" : "")}>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[56px_1fr_auto] items-center gap-4 px-4 py-3 text-left transition hover:bg-black/[0.025] md:grid-cols-[56px_minmax(0,1fr)_repeat(5,84px)_24px]"
      >
        <div className="relative h-14 w-14 shrink-0">
          {item.thumbnail ? (
            <img src={item.thumbnail} loading="lazy" className="h-14 w-14 rounded-lg bg-black/5 object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-black/[0.05] text-[10px] font-bold text-[var(--color-text-faint)]">
              {item.media_type || "POST"}
            </div>
          )}
          {brand && (
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white shadow">
              <brand.logo className={item.platform === "youtube" ? "h-2.5 w-3.5" : "h-3.5 w-3.5"} />
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{item.caption || <span className="text-[var(--color-text-faint)]">No caption</span>}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-text-faint)]">
            <span>{item.published_at ? new Date(item.published_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}</span>
            {item.media_type && <span className="rounded bg-black/[0.05] px-1.5 py-px font-semibold">{item.media_type}</span>}
            {item.reelmind_post_id && (
              <span className="rounded bg-[var(--color-primary)]/10 px-1.5 py-px font-semibold text-[var(--color-primary)]">via Reelmind</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-semibold md:hidden">
          <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />{item.pending ? "…" : compact(c.views)}</span>
          <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />{compact(c.likes)}</span>
        </div>

        <div className="hidden text-right text-sm font-semibold tabular-nums md:block">{cell(c.views, true)}</div>
        <div className="hidden text-right text-sm font-semibold tabular-nums md:block">{cell(c.likes, c.likes === null)}</div>
        <div className="hidden text-right text-sm font-semibold tabular-nums md:block">{cell(c.comments, c.comments === null)}</div>
        <div className="hidden text-right text-sm font-semibold tabular-nums md:block">{cell(c.shares, true)}</div>
        <div className="hidden text-right md:block">
          {item.pending ? (
            <Skeleton />
          ) : item.engagement_rate !== null && item.engagement_rate !== undefined ? (
            <span
              className={
                "rounded-full px-2 py-0.5 text-xs font-bold " +
                (item.engagement_rate >= 3 ? "bg-[var(--color-success)]/12 text-[var(--color-success)]" : "bg-black/[0.05] text-[var(--color-text-muted)]")
              }
            >
              {item.engagement_rate}%
            </span>
          ) : (
            <span className="text-[var(--color-text-faint)]">—</span>
          )}
        </div>
        <ChevronDown className={"hidden h-4 w-4 text-[var(--color-text-faint)] transition md:block " + (open ? "rotate-180" : "")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-5 px-4 pb-5 pt-1 md:flex-row md:items-start md:pl-[88px]">
              {item.pending ? (
                <p className="flex flex-1 items-center gap-2 text-sm text-[var(--color-text-muted)]">
                  <Spinner className="h-4 w-4" /> Loading full stats…
                </p>
              ) : item.available && item.metrics ? (
                <div className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {item.metrics.map((m) => (
                    <div key={m.key} className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5">
                      <div className="text-lg font-bold leading-none tabular-nums">{m.value.toLocaleString()}</div>
                      <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">{m.label}</div>
                    </div>
                  ))}
                  {item.engagement_rate !== null && item.engagement_rate !== undefined && (
                    <div className="rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/5 px-3 py-2.5">
                      <div className="text-lg font-bold leading-none text-[var(--color-success)]">{item.engagement_rate}%</div>
                      <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">Engagement</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="flex-1 text-sm text-[var(--color-text-muted)]">{item.reason ?? "No stats available for this post."}</p>
              )}
              <div className="flex shrink-0 flex-wrap gap-2">
                {MANAGEABLE.has(item.platform) && (
                  <button
                    onClick={onManage}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#211f1a] px-3 py-2 text-xs font-bold text-white transition hover:bg-[var(--color-primary)]"
                  >
                    <MessagesSquare className="h-3.5 w-3.5" /> Manage
                  </button>
                )}
                {item.permalink && <BoostButton platform={item.platform} permalink={item.permalink} caption={item.caption} thumbnail={item.thumbnail} />}
                {item.permalink && (
                  <a
                    href={item.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold transition hover:bg-black/5"
                  >
                    View on {brand?.label ?? "platform"} <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
                {item.reelmind_post_id && (
                  <Link
                    to={`/posts/${item.reelmind_post_id}?tab=Insights`}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-bold text-white"
                  >
                    Open in Reelmind
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ContentInsights() {
  const { currentWorkspace } = useAuth()
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [platforms, setPlatforms] = useState<PlatformStatus>({})
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [platform, setPlatform] = useState<string>("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("newest")
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [manageTarget, setManageTarget] = useState<ManageTarget | null>(null)

  // Mirrors of state for the async loaders, plus a generation counter so a
  // reload cancels any background fetching from the previous list.
  const itemsRef = useRef<ContentItem[] | null>(null)
  const inflight = useRef(new Set<string>())
  const generation = useRef(0)
  itemsRef.current = items

  const load = useCallback(async (force = false) => {
    generation.current += 1
    inflight.current.clear()
    setRefreshing(true)
    setError(null)
    try {
      const res = await api.get<ContentResponse>(`/analytics/content${force ? "?refresh=true" : ""}`)
      setItems(res.items)
      setPlatforms(res.platforms)
      setFetchedAt(res.fetched_at)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your posts")
    } finally {
      setRefreshing(false)
    }
  }, [])

  const loadDetails = useCallback(
    async (keys: string[]) => {
      const gen = generation.current
      const wanted = keys.filter((k) => !inflight.current.has(k) && itemsRef.current?.find((i) => keyOf(i) === k)?.pending)
      if (!wanted.length) return
      wanted.forEach((k) => inflight.current.add(k))
      try {
        const res = await api.post<{ items: Record<string, ContentItem>; platforms: PlatformStatus }>("/analytics/content/details", { keys: wanted })
        if (gen !== generation.current) return
        setItems((cur) => cur?.map((i) => res.items[keyOf(i)] ?? i) ?? cur)
        setPlatforms(res.platforms)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) load()
      } finally {
        wanted.forEach((k) => inflight.current.delete(k))
      }
    },
    [load],
  )

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    const list = items.filter((i) => (platform === "all" || i.platform === platform) && (!q || i.caption.toLowerCase().includes(q)))
    const val = (i: ContentItem): number => {
      if (sort === "engagement") return i.engagement_rate ?? -1
      const c = cols(i)
      return (sort === "views" ? c.views : sort === "likes" ? c.likes : c.comments) ?? -1
    }
    return sort === "newest" ? list : [...list].sort((a, b) => val(b) - val(a))
  }, [items, platform, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const visibleKeys = visible.map(keyOf).join(",")

  useEffect(() => {
    setPage(1)
  }, [platform, query, sort, pageSize])

  // The page being looked at gets its detailed stats first...
  useEffect(() => {
    if (visibleKeys) loadDetails(visibleKeys.split(","))
  }, [visibleKeys, loadDetails])

  // ...then everything else fills in quietly, so sorting by views and the
  // export have every number without the user waiting up front.
  const pendingCount = items?.filter((i) => i.pending).length ?? 0
  const loadAllPending = useCallback(async () => {
    const gen = generation.current
    while (gen === generation.current) {
      const next = (itemsRef.current ?? []).filter((i) => i.pending && !inflight.current.has(keyOf(i))).slice(0, BACKGROUND_CHUNK)
      if (!next.length) break
      await loadDetails(next.map(keyOf))
      await new Promise((r) => setTimeout(r, 0))
    }
  }, [loadDetails])

  useEffect(() => {
    if (!fetchedAt) return
    const t = setTimeout(loadAllPending, 1500)
    return () => clearTimeout(t)
  }, [fetchedAt, loadAllPending])

  const summary = useMemo(() => {
    const ready = filtered.filter((i) => i.available && !i.pending)
    const sum = (k: "views" | "likes" | "comments") => filtered.filter((i) => i.available).reduce((n, i) => n + (cols(i)[k] ?? 0), 0)
    const rates = ready.map((i) => i.engagement_rate).filter((r): r is number => r !== null && r !== undefined)
    return {
      posts: filtered.length,
      views: sum("views"),
      likes: sum("likes"),
      comments: sum("comments"),
      avgEngagement: rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2) : null,
    }
  }, [filtered])

  async function exportReport() {
    setExporting(true)
    try {
      await loadAllPending()
      const current = itemsRef.current ?? []
      const keys = new Set(filtered.map(keyOf))
      const list = filtered.length ? current.filter((i) => keys.has(keyOf(i))) : []
      const ordered = filtered.map((f) => list.find((i) => keyOf(i) === keyOf(f)) ?? f)
      const platformLabel = platform === "all" ? "All platforms" : (logoFor(platform)?.label ?? platform)
      const scope = [platformLabel, query.trim() && `matching "${query.trim()}"`, `${ordered.length} posts`].filter(Boolean).join(" · ")
      await exportPostReport({
        workspaceName: currentWorkspace?.name ?? "Reelmind",
        scope,
        items: ordered.map((i) => ({
          platform: i.platform,
          caption: i.caption,
          published_at: i.published_at,
          media_type: i.media_type,
          available: i.available,
          engagement_rate: i.engagement_rate ?? null,
          ...cols(i),
        })),
      })
    } finally {
      setExporting(false)
    }
  }

  const notes = Object.entries(platforms).filter(([, s]) => s.note)
  const counts = Object.entries(platforms)
    .filter(([, s]) => s.count > 0)
    .map(([k, s]) => ({ key: k, count: s.count }))
  const total = items?.length ?? 0
  const detailsDone = total - pendingCount

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Post insights"
        description="Every post from your connected accounts - published with Reelmind or not - with its numbers in one list."
        actions={
          <div className="flex items-center gap-3">
            {fetchedAt && (
              <span className="hidden text-xs text-[var(--color-text-faint)] sm:block">
                Updated {new Date(fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} /> Refresh
            </Button>
            <Button onClick={exportReport} disabled={!items || filtered.length === 0 || exporting}>
              {exporting ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              {exporting && pendingCount ? `Preparing ${detailsDone}/${total}` : "Export report"}
            </Button>
          </div>
        }
      />

      {!items && !error && (
        <div className="flex flex-col items-center gap-3 py-24 text-sm text-[var(--color-text-muted)]">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
          Pulling your posts from each platform…
        </div>
      )}
      {error && !items && <p className="py-10 text-center text-sm text-[var(--color-danger)]">{error}</p>}

      {items && (
        <div className="space-y-5">
          {notes.length > 0 && (
            <div className="space-y-1.5">
              {notes.map(([k, s]) => {
                const b = logoFor(k)
                return (
                  <div key={k} className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-white px-3.5 py-2 text-xs text-[var(--color-text-muted)]">
                    {b ? <b.logo className={k === "youtube" ? "h-3 w-4" : "h-4 w-4"} /> : <Info className="h-4 w-4" />}
                    {s.note}
                  </div>
                )
              })}
            </div>
          )}

          <div className="glass-card grid grid-cols-2 divide-[var(--color-border)] p-0 sm:grid-cols-5 sm:divide-x-2">
            {[
              { label: "Posts", value: summary.posts.toLocaleString(), icon: TrendingUp, color: "#2f7680" },
              { label: "Views", value: pendingCount > 0 && summary.views === 0 ? "…" : compact(summary.views), icon: Eye, color: "#6a8f2e", loading: pendingCount > 0 },
              { label: "Likes", value: compact(summary.likes), icon: Heart, color: "#c1432c" },
              { label: "Comments", value: compact(summary.comments), icon: MessageCircle, color: "#3f6fa0" },
              { label: "Avg. engagement", value: summary.avgEngagement ? `${summary.avgEngagement}%` : "—", icon: Repeat2, color: "#8a4f9e", loading: pendingCount > 0 },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: t.color + "1f" }}>
                  <t.icon className="h-4 w-4" style={{ color: t.color }} />
                </div>
                <div>
                  <div className="font-[var(--font-display)] text-xl font-bold leading-none">{t.value}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    {t.label}
                    {t.loading && <Spinner className="h-3 w-3 text-[var(--color-text-faint)]" />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[{ key: "all", count: total }, ...counts].map((p) => {
              const b = logoFor(p.key)
              const active = platform === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => setPlatform(p.key)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition " +
                    (active ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-[var(--color-border)] bg-white hover:border-[var(--color-border-strong)]")
                  }
                >
                  {b && <b.logo className={p.key === "youtube" ? "h-3 w-4" : "h-3.5 w-3.5"} />}
                  {b?.label ?? "All"}
                  <span className="text-[var(--color-text-faint)]">{p.count}</span>
                </button>
              )
            })}
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
                <Spinner className="h-3 w-3" /> Loading stats {detailsDone}/{total}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search captions"
                  className="w-48 rounded-lg border border-[var(--color-border-strong)] bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--color-primary)]"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="glass-card overflow-hidden p-0">
            <div className="hidden grid-cols-[56px_minmax(0,1fr)_repeat(5,84px)_24px] gap-4 border-b border-[var(--color-border)] bg-black/[0.02] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)] md:grid">
              <span />
              <span>Post</span>
              <span className="text-right">Views</span>
              <span className="text-right">Likes</span>
              <span className="text-right">Comments</span>
              <span className="text-right">Shares</span>
              <span className="text-right">Engagement</span>
              <span />
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-[var(--color-text-muted)]">
                {total === 0 ? "Connect a platform in Settings to see your posts here." : "No posts match your filters."}
              </p>
            ) : (
              visible.map((item) => (
                <Row
                  key={keyOf(item)}
                  item={item}
                  open={openKey === keyOf(item)}
                  onToggle={() => setOpenKey((o) => (o === keyOf(item) ? null : keyOf(item)))}
                  onManage={() => setManageTarget(item)}
                />
              ))
            )}

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-black/[0.015] px-4 py-3">
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>
                    Showing <b className="text-[var(--color-text)]">{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)}</b> of{" "}
                    <b className="text-[var(--color-text)]">{filtered.length}</b>
                  </span>
                  <label className="flex items-center gap-1.5">
                    Rows
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="rounded-md border border-[var(--color-border-strong)] bg-white px-1.5 py-1 text-xs font-semibold outline-none"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white transition hover:border-[var(--color-border-strong)] disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {pageList(safePage, pageCount).map((p, i) =>
                    p === "…" ? (
                      <span key={`gap-${i}`} className="px-1 text-xs text-[var(--color-text-faint)]">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={
                          "h-8 min-w-8 rounded-md px-2 text-xs font-bold transition " +
                          (p === safePage
                            ? "bg-[var(--color-primary)] text-white"
                            : "border border-[var(--color-border)] bg-white hover:border-[var(--color-border-strong)]")
                        }
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage === pageCount}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white transition hover:border-[var(--color-border-strong)] disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ManagePostDrawer
        target={manageTarget}
        onClose={() => setManageTarget(null)}
        onDeleted={(platform, id) => setItems((cur) => cur?.filter((i) => !(i.platform === platform && i.id === id)) ?? cur)}
        onCaptionChanged={(platform, id, caption) =>
          setItems((cur) => cur?.map((i) => (i.platform === platform && i.id === id ? { ...i, caption } : i)) ?? cur)
        }
      />
    </div>
  )
}
