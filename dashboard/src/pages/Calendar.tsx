import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  Film,
  Lock,
  Image as ImageIcon,
  List,
  PartyPopper,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, Card, FadeIn, Label, PageHeader, Spinner, Textarea } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import { ScoreBadge } from "../components/PostScore"
import type { Post, PostStatus, RunLogEntry } from "../lib/types"

const STATUS_FILTERS: { label: string; value: PostStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Planned", value: "planned" },
  { label: "Pending review", value: "pending_review" },
  { label: "Approved", value: "approved" },
  { label: "Posted", value: "posted" },
  { label: "Needs attention", value: "needs_manual_edit" },
]

const MEDIA_FILTERS: { label: string; value: "all" | "REELS" | "IMAGE"; icon: typeof Film }[] = [
  { label: "All", value: "all", icon: Sparkles },
  { label: "Videos", value: "REELS", icon: Film },
  { label: "Posts", value: "IMAGE", icon: ImageIcon },
]

const STATUS_DOT: Record<string, string> = {
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const POLL_MS = 3000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

interface CalEvent {
  key: string
  date: string
  end_date: string
  name: string
  type: "holiday" | "observance"
  approx: boolean
  emoji: string
  post_id: number | null
}

interface EventsResponse {
  country: { code: string; name: string; flag: string } | null
  events: CalEvent[]
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function loadView(): "month" | "list" {
  try {
    return localStorage.getItem("calendar-view") === "list" ? "list" : "month"
  } catch {
    return "month"
  }
}

export function Calendar() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all")
  const [mediaFilter, setMediaFilter] = useState<"all" | "REELS" | "IMAGE">("all")
  const [showGenerate, setShowGenerate] = useState(false)
  const [runState, setRunState] = useState<{ status: "running" | "done" | "error"; message?: string } | null>(null)
  const [actioningId, setActioningId] = useState<number | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Post | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectBusy, setRejectBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [view, setView] = useState<"month" | "list">(loadView)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<string>(() => iso(new Date()))
  const [events, setEvents] = useState<EventsResponse | null>(null)
  const [creatingFor, setCreatingFor] = useState<Set<string>>(new Set())
  const pollRef = useRef<number | null>(null)

  async function load() {
    const res = await api.get<{ posts: Post[] }>("/posts?limit=500")
    setPosts(res.posts)
  }

  // Real-calendar grid: whole weeks, including the tail of the previous
  // month and the start of the next one.
  const gridDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    const end = new Date(last)
    end.setDate(last.getDate() + (6 - last.getDay()))
    const days: Date[] = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d))
    return days
  }, [month])

  const loadEvents = useCallback(async () => {
    const start = iso(gridDays[0])
    const end = iso(gridDays[gridDays.length - 1])
    try {
      setEvents(await api.get<EventsResponse>(`/events?start=${start}&end=${end}`))
    } catch {
      setEvents({ country: null, events: [] })
    }
  }, [gridDays])

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  useEffect(() => {
    try {
      localStorage.setItem("calendar-view", view)
    } catch {
      /* per-viewer preference only */
    }
  }, [view])

  function watchRun() {
    if (pollRef.current) window.clearInterval(pollRef.current)
    setRunState({ status: "running" })
    const startedAt = Date.now()
    const before = new Set((posts ?? []).map((p) => p.id))

    pollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        setRunState({ status: "error", message: "This is taking longer than expected — check back shortly." })
        return
      }
      const [activityRes] = await Promise.all([api.get<{ runs: RunLogEntry[] }>("/activity?limit=1"), load()])
      const latest = activityRes.runs[0]
      if (latest && latest.status !== "running" && new Date(latest.started_at).getTime() >= startedAt - POLL_MS) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        setCreatingFor(new Set())
        await loadEvents()
        if (latest.status === "error") {
          setRunState({ status: "error", message: latest.error || "Generation failed" })
        } else {
          const res = await api.get<{ posts: Post[] }>("/posts?limit=500")
          setPosts(res.posts)
          const added = res.posts.filter((p) => !before.has(p.id)).length
          setRunState({ status: "done", message: latest.summary || (added > 0 ? `Generated ${added} new post${added === 1 ? "" : "s"}.` : "Done — nothing new to add.") })
        }
        setTimeout(() => setRunState((s) => (s?.status === "done" ? null : s)), 6000)
      }
    }, POLL_MS)
  }

  async function createEventPosts(evs: CalEvent[]) {
    const keys = evs.filter((e) => !e.post_id).map((e) => e.key)
    if (!keys.length) return
    setCreatingFor((s) => new Set([...s, ...keys]))
    try {
      await api.post("/events/posts", { keys })
      watchRun()
    } catch (err) {
      setCreatingFor(new Set())
      setRunState({ status: "error", message: err instanceof ApiError ? err.message : "Couldn't start creating event posts" })
    }
  }

  async function quickApprove(post: Post) {
    setActioningId(post.id)
    try {
      await api.post(`/posts/${post.id}/approve`)
      await load()
    } finally {
      setActioningId(null)
    }
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setRejectBusy(true)
    try {
      await api.post(`/posts/${rejectTarget.id}/reject`, { reason: rejectReason.trim() })
      setRejectTarget(null)
      await load()
    } finally {
      setRejectBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await api.delete(`/posts/${deleteTarget.id}`)
      setDeleteTarget(null)
      await Promise.all([load(), loadEvents()])
    } finally {
      setDeleteBusy(false)
    }
  }

  const filtered = useMemo(() => {
    if (!posts) return []
    return posts
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => mediaFilter === "all" || p.media_type === mediaFilter)
  }, [posts, statusFilter, mediaFilter])

  const postsByDay = useMemo(() => {
    const map = new Map<string, Post[]>()
    for (const post of filtered) {
      const key = iso(new Date(post.scheduled_at))
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(post)
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    return map
  }, [filtered])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const e of events?.events ?? []) {
      for (let d = parseIso(e.date); d <= parseIso(e.end_date); d.setDate(d.getDate() + 1)) {
        const key = iso(d)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(e)
      }
    }
    return map
  }, [events])

  const grouped = useMemo(() => {
    const groups = new Map<string, Post[]>()
    for (const post of filtered) {
      const label = new Date(post.scheduled_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label)!.push(post)
    }
    return Array.from(groups.entries())
  }, [filtered])

  const todayIso = iso(new Date())
  const monthEvents = (events?.events ?? []).filter((e) => parseIso(e.date).getMonth() === month.getMonth() && e.date >= todayIso)
  const monthEventsWithoutPost = monthEvents.filter((e) => !e.post_id && !creatingFor.has(e.key))
  const dayPosts = postsByDay.get(selectedDay) ?? []
  const dayEvents = eventsByDay.get(selectedDay) ?? []

  const renderPostRow = (post: Post, compact = false) => {
    const canReview = post.status === "pending_review" || post.status === "needs_manual_edit"
    const canDelete = post.status !== "posted" && post.status !== "publishing"
    return (
      <motion.div
        key={post.id}
        whileHover={{ x: 3 }}
        className={"glass-card flex items-center gap-3 transition-colors hover:border-[var(--color-border-strong)] " + (compact ? "px-3.5 py-3" : "px-5 py-4")}
      >
        <Link to={`/posts/${post.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          {!compact && (
            <div className="w-14 shrink-0 text-center">
              <div className="text-lg font-bold leading-none">{new Date(post.scheduled_at).getDate()}</div>
              <div className="mt-1 text-[10px] uppercase text-[var(--color-text-faint)]">
                {new Date(post.scheduled_at).toLocaleDateString(undefined, { weekday: "short" })}
              </div>
            </div>
          )}
          {post.media_type === "REELS" ? (
            <Film className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
          ) : (
            <ImageIcon className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{post.title || "Untitled"}</div>
            <div className="truncate text-xs text-[var(--color-text-faint)]">
              {new Date(post.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              {post.pillar ? ` · ${post.pillar}` : ""}
            </div>
          </div>
        </Link>
        {(canReview || canDelete) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {canReview && (
              <>
                <button
                  type="button"
                  title="Approve"
                  disabled={actioningId === post.id}
                  onClick={() => quickApprove(post)}
                  className="rounded-md p-1.5 text-[var(--color-text-faint)] transition hover:bg-[var(--color-success)]/10 hover:text-[var(--color-success)] disabled:opacity-40"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Reject"
                  onClick={() => {
                    setRejectReason("")
                    setRejectTarget(post)
                  }}
                  className="rounded-md p-1.5 text-[var(--color-text-faint)] transition hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
            {canDelete && (
              <button
                type="button"
                title="Delete"
                onClick={() => setDeleteTarget(post)}
                className="rounded-md p-1.5 text-[var(--color-text-faint)] transition hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {post.score && <ScoreBadge score={post.score.overall} />}
        <StatusBadge status={post.status} />
        {!compact && (
          <Link to={`/posts/${post.id}`}>
            <ChevronRight className="h-4 w-4 text-[var(--color-text-faint)]" />
          </Link>
        )}
      </motion.div>
    )
  }

  return (
    <div className="section-calendar">
      <PageHeader
        eyebrow="Calendar"
        title="Content calendar"
        description="Every post planned, generated or published - plus the holidays and occasions in your target country."
        actions={
          <Button onClick={() => setShowGenerate(true)}>
            <CalendarPlus className="h-4 w-4" /> Generate content
          </Button>
        }
      />

      <AnimatePresence>
        {runState && (
          <FadeIn>
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={
                "mb-6 flex items-center gap-2.5 rounded-md border px-4 py-3 text-sm " +
                (runState.status === "running"
                  ? "border-[var(--color-border)] bg-black/[0.03] text-[var(--color-text-muted)]"
                  : runState.status === "done"
                    ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                    : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]")
              }
            >
              {runState.status === "running" ? (
                <>
                  <Spinner className="h-4 w-4" /> Writing your content in the background — feel free to keep browsing, this'll update on its own.
                </>
              ) : runState.status === "done" ? (
                <>
                  <Check className="h-4 w-4" /> {runState.message}
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" /> {runState.message}
                </>
              )}
            </motion.div>
          </FadeIn>
        )}
      </AnimatePresence>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-semibold transition " +
              (statusFilter === f.value
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
            }
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1">
            {MEDIA_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setMediaFilter(f.value)}
                className={
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition " +
                  (mediaFilter === f.value ? "bg-[var(--color-primary)]/15 text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-black/5")
                }
              >
                <f.icon className="h-3.5 w-3.5" />
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1">
            {[
              { v: "month" as const, label: "Month", icon: CalendarDays },
              { v: "list" as const, label: "List", icon: List },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setView(o.v)}
                className={
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition " +
                  (view === o.v ? "bg-[#211f1a] text-white" : "text-[var(--color-text-muted)] hover:bg-black/5")
                }
              >
                <o.icon className="h-3.5 w-3.5" /> {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {posts === null && (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
        </div>
      )}

      {posts && view === "month" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
          <div className="glass-card overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                  className="rounded-md border border-[var(--color-border)] p-1.5 hover:bg-black/5"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                  className="rounded-md border border-[var(--color-border)] p-1.5 hover:bg-black/5"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <h3 className="ml-1 font-[var(--font-display)] text-lg font-bold">
                  {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </h3>
                <button
                  onClick={() => {
                    const d = new Date()
                    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                    setSelectedDay(iso(d))
                  }}
                  className="ml-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-semibold hover:bg-black/5"
                >
                  Today
                </button>
              </div>
              {events?.country ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d9a441]/15 px-2.5 py-1 text-xs font-semibold text-[#8a5a12]">
                    <span>{events.country.flag}</span> {events.country.name} events
                  </span>
                  {monthEventsWithoutPost.length > 0 && (
                    <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => createEventPosts(monthEventsWithoutPost)}>
                      <PartyPopper className="h-3.5 w-3.5" /> Create posts for {monthEventsWithoutPost.length} event{monthEventsWithoutPost.length === 1 ? "" : "s"}
                    </Button>
                  )}
                </div>
              ) : (
                events && (
                  <Link to="/settings" className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
                    Set a target country to see its holidays →
                  </Link>
                )
              )}
            </div>

            <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-black/[0.02]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {gridDays.map((d, i) => {
                const key = iso(d)
                const inMonth = d.getMonth() === month.getMonth()
                const isToday = key === todayIso
                const isSelected = key === selectedDay
                const dayEvts = eventsByDay.get(key) ?? []
                const dayPs = postsByDay.get(key) ?? []
                const items = dayEvts.length + dayPs.length
                const MAX = 3
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(key)}
                    className={
                      "group relative flex min-h-[112px] flex-col gap-1 border-b border-r border-[var(--color-border)] p-1.5 text-left align-top transition " +
                      ((i + 1) % 7 === 0 ? "border-r-0 " : "") +
                      (isSelected ? "bg-[var(--color-primary)]/[0.07] ring-2 ring-inset ring-[var(--color-primary)]/50" : inMonth ? "bg-white hover:bg-black/[0.02]" : "bg-black/[0.025]")
                    }
                  >
                    <span
                      className={
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                        (isToday ? "bg-[var(--color-primary)] text-white" : inMonth ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]")
                      }
                    >
                      {d.getDate()}
                    </span>
                    {dayEvts.slice(0, MAX).map((e) => (
                      <span
                        key={e.key}
                        title={e.name}
                        className={
                          "flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold " +
                          (e.type === "holiday" ? "bg-[#d9a441]/20 text-[#7a4f0c]" : "bg-[#8a4f9e]/12 text-[#5c2f6e]") +
                          (inMonth ? "" : " opacity-60")
                        }
                      >
                        <span className="shrink-0">{e.emoji}</span>
                        <span className="truncate">{e.name}</span>
                        {e.post_id && <Check className="h-3 w-3 shrink-0" />}
                      </span>
                    ))}
                    {dayPs.slice(0, Math.max(0, MAX - dayEvts.length)).map((p) => (
                      <span
                        key={p.id}
                        title={p.title}
                        className={"flex items-center gap-1 truncate rounded border-l-[3px] bg-black/[0.035] px-1.5 py-0.5 text-[11px] " + (inMonth ? "" : "opacity-60")}
                        style={{ borderLeftColor: STATUS_DOT[p.status] ?? "#948d7d" }}
                      >
                        <span className="shrink-0 font-semibold text-[var(--color-text-faint)]">
                          {new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase()}
                        </span>
                        <span className="truncate font-medium">{p.title || "Untitled"}</span>
                      </span>
                    ))}
                    {items > MAX && <span className="px-1 text-[11px] font-semibold text-[var(--color-text-faint)]">+{items - MAX} more</span>}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] text-[var(--color-text-faint)]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#d9a441]/40" /> Public holiday</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#8a4f9e]/25" /> Occasion</span>
              <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> Post created</span>
              {Object.entries({ Planned: "planned", "In review": "pending_review", Approved: "approved", Posted: "posted" }).map(([label, s]) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-[3px] rounded-sm" style={{ background: STATUS_DOT[s] }} /> {label}
                </span>
              ))}
            </div>
          </div>

          {/* Selected day */}
          <div className="space-y-3">
            <h3 className="font-[var(--font-display)] text-base font-bold">
              {parseIso(selectedDay).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h3>
            {dayEvents.map((e) => (
              <div key={e.key} className="glass-card flex items-center gap-3 px-3.5 py-3">
                <span className="text-2xl leading-none">{e.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{e.name}</div>
                  <div className="text-[11px] text-[var(--color-text-faint)]">
                    {e.type === "holiday" ? "Public holiday" : "Occasion"}
                    {e.end_date !== e.date && ` · until ${parseIso(e.end_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                    {e.approx && " · date may shift by a day"}
                  </div>
                </div>
                {e.post_id ? (
                  <Link to={`/posts/${e.post_id}`} className="shrink-0 rounded-md border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-bold hover:bg-black/5">
                    View post
                  </Link>
                ) : creatingFor.has(e.key) ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
                    <Spinner className="h-3.5 w-3.5" /> Writing…
                  </span>
                ) : e.date >= todayIso ? (
                  <button
                    onClick={() => createEventPosts([e])}
                    className="shrink-0 rounded-md bg-[#211f1a] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-primary)]"
                  >
                    Create post
                  </button>
                ) : null}
              </div>
            ))}
            {dayPosts.map((p) => renderPostRow(p, true))}
            {dayEvents.length === 0 && dayPosts.length === 0 && (
              <div className="glass-card px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">Nothing scheduled this day.</div>
            )}
          </div>
        </div>
      )}

      {posts && view === "list" && (
        <>
          {posts.length === 0 && (
            <Card className="py-16 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">No content planned yet. Describe what you want and generate your first content run.</p>
              <Button onClick={() => setShowGenerate(true)} className="mx-auto mt-4">
                <CalendarPlus className="h-4 w-4" /> Generate content
              </Button>
            </Card>
          )}
          {posts.length > 0 && filtered.length === 0 && (
            <Card className="py-16 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">Nothing matches these filters yet.</p>
            </Card>
          )}
          <div className="space-y-8">
            {grouped.map(([label, monthPosts]) => (
              <div key={label}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{label}</h3>
                <div className="space-y-2">
                  {monthPosts.map((post, i) => (
                    <FadeIn key={post.id} delay={Math.min(i * 0.03, 0.3)}>
                      {renderPostRow(post)}
                    </FadeIn>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <GenerateModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onStarted={() => {
          setShowGenerate(false)
          watchRun()
        }}
      />

      <AnimatePresence>
        {rejectTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => !rejectBusy && setRejectTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card w-full max-w-md p-6"
            >
              <h3 className="font-[var(--font-display)] text-lg font-bold">Why are you rejecting this?</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">"{rejectTarget.title || "Untitled"}" — your feedback is used to regenerate it.</p>
              <Textarea
                autoFocus
                rows={3}
                className="mt-4"
                placeholder="e.g. the hook is weak, make it punchier"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={rejectBusy}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmReject} disabled={rejectBusy || !rejectReason.trim()}>
                  {rejectBusy ? "Submitting…" : "Confirm rejection"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => !deleteBusy && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card w-full max-w-md p-6"
            >
              <h3 className="font-[var(--font-display)] text-lg font-bold">Delete "{deleteTarget.title || "this post"}"?</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">This can't be undone — the post, its video/image, and its publish history will all be gone.</p>
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
                  {deleteBusy ? "Deleting…" : "Delete post"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const DOCUMENT_ACCEPT = ".txt,.md,.pdf,.docx"

interface PlanItem {
  scheduled_date: string
  pillar: string
  hook: string
  video_concept: string
  script?: string
  on_screen_text?: string
  caption: string
  hashtags: string
  title: string
  broll_keywords?: string
}

function GenerateModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [phase, setPhase] = useState<"input" | "review">("input")
  const [contentType, setContentType] = useState<"video" | "post">("post")
  const [brief, setBrief] = useState("")
  const [docFile, setDocFile] = useState<File | null>(null)
  const [days, setDays] = useState(30)
  const [outline, setOutline] = useState<PlanItem[]>([])
  const [resolvedBrief, setResolvedBrief] = useState("")
  const [amendment, setAmendment] = useState("")
  const [expandedDay, setExpandedDay] = useState<number | null>(null)
  const [amending, setAmending] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setPhase("input")
    setBrief("")
    setDocFile(null)
    setOutline([])
    setResolvedBrief("")
    setAmendment("")
    setExpandedDay(null)
    setError(null)
  }

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("days", String(days))
      formData.append("content_type", contentType)
      formData.append("brief", brief.trim())
      if (docFile) formData.append("document", docFile)
      const res = await api.upload<{ outline: PlanItem[]; brief: string }>("/calendar/analyze", formData)
      setOutline(res.outline)
      setResolvedBrief(res.brief)
      setPhase("review")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't analyze that")
    } finally {
      setAnalyzing(false)
    }
  }

  async function applyAmendment() {
    if (!amendment.trim() || outline.length === 0) return
    setAmending(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("outline", JSON.stringify(outline))
      formData.append("amendment", amendment.trim())
      formData.append("brief", resolvedBrief)
      const res = await api.upload<{ outline: PlanItem[]; brief: string }>("/calendar/analyze", formData)
      setOutline(res.outline)
      setAmendment("")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't apply that change")
    } finally {
      setAmending(false)
    }
  }

  async function start() {
    if (outline.length === 0) return
    setStarting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("days", String(days))
      formData.append("content_type", contentType)
      formData.append("brief", resolvedBrief)
      formData.append("outline", JSON.stringify(outline))
      await api.upload("/calendar/generate", formData)
      reset()
      onStarted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start generating")
    } finally {
      setStarting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !starting && !analyzing && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            onClick={(e) => e.stopPropagation()}
            className={"glass-card w-full p-6 " + (phase === "review" ? "max-w-2xl" : "max-w-lg")}
          >
            {phase === "input" ? (
              <>
                <h3 className="font-[var(--font-display)] text-lg font-bold">Generate extra content</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Your 30-day plan was already made from your brand profile. Use this to add extra posts on top of
                  it — add a focus or a document to steer them, and you'll review everything before it's saved.
                </p>

                <div className="mt-5">
                  <Label>Content type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled
                      title="Video Reels are locked for now"
                      className="flex cursor-not-allowed items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-black/[0.03] p-3 text-sm font-medium text-[var(--color-text-faint)]"
                    >
                      <Film className="h-4 w-4" /> Video Reels <Lock className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setContentType("post")}
                      className={
                        "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition " +
                        (contentType === "post"
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-text)]"
                          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
                      }
                    >
                      <ImageIcon className="h-4 w-4" /> Photo posts
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                    Written from your brand profile — a caption, hashtags and a photo with a short headline for each date.
                    Video Reels are locked for now.
                  </p>
                </div>

                <div className="mt-5">
                  <Label>Extra focus for this run (optional)</Label>
                  <Textarea
                    autoFocus
                    rows={4}
                    placeholder="e.g. Focus the next batch on our new winter product line, more customer testimonials, and less generic tips"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                  />
                </div>

                <div className="mt-5">
                  <Label>Or upload a document (optional)</Label>
                  <p className="-mt-1 mb-2 text-[11px] text-[var(--color-text-faint)]">
                    A business plan, brand brief, or style guide — we'll read it and show you what we found next.
                  </p>
                  {docFile ? (
                    <div className="flex items-center gap-2.5 rounded-md border border-[var(--color-border)] bg-black/[0.03] px-3.5 py-2.5">
                      <FileIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate text-sm">{docFile.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDocFile(null)
                          if (fileInputRef.current) fileInputRef.current.value = ""
                        }}
                        className="shrink-0 rounded-md p-1 text-[var(--color-text-faint)] hover:bg-black/5 hover:text-[var(--color-text)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border-strong)] px-3.5 py-3 text-sm text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
                    >
                      <Upload className="h-4 w-4" /> Choose a .txt, .pdf, or .docx file
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    className="hidden"
                    onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  />
                </div>

                <div className="mt-5 w-32">
                  <Label>Days to plan</Label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={days}
                    onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full rounded-md border border-[var(--color-border)] bg-black/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary)] focus:bg-black/[0.05]"
                  />
                </div>

                {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

                <div className="mt-6 flex justify-end gap-3">
                  <Button variant="ghost" onClick={onClose} disabled={analyzing}>
                    Cancel
                  </Button>
                  <Button onClick={analyze} disabled={analyzing}>
                    {analyzing ? <Spinner className="h-4 w-4" /> : null}
                    {analyzing ? "Writing your plan…" : "Next: review"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-[var(--font-display)] text-lg font-bold">Review your plan</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {outline.length} post{outline.length === 1 ? "" : "s"} over {days} day{days === 1 ? "" : "s"},
                  matching your posting frequency. Don't like something? Say so below and we'll adjust it.
                </p>

                <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
                  {outline.map((item, i) => {
                    const isOpen = expandedDay === i
                    return (
                      <div key={item.scheduled_date + i} className="rounded-md border border-[var(--color-border)] bg-black/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[var(--color-primary)]">
                            Day {i + 1} ·{" "}
                            {new Date(item.scheduled_date).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          {item.pillar && (
                            <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                              {item.pillar}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm font-semibold">{item.title || item.hook}</div>
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                          <span className="font-semibold text-[var(--color-text-faint)]">Hook: </span>
                          {item.hook}
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                          <span className="font-semibold text-[var(--color-text-faint)]">Video: </span>
                          {item.video_concept}
                        </div>

                        {isOpen && (
                          <div className="mt-2 space-y-1.5 border-t border-[var(--color-border)] pt-2">
                            {item.script && (
                              <div className="text-xs text-[var(--color-text-muted)]">
                                <span className="font-semibold text-[var(--color-text-faint)]">Script: </span>
                                {item.script}
                              </div>
                            )}
                            {item.on_screen_text && (
                              <div className="text-xs text-[var(--color-text-muted)]">
                                <span className="font-semibold text-[var(--color-text-faint)]">On-screen text: </span>
                                {item.on_screen_text}
                              </div>
                            )}
                            <div className="text-xs text-[var(--color-text-muted)]">
                              <span className="font-semibold text-[var(--color-text-faint)]">Caption: </span>
                              {item.caption}
                            </div>
                            <div className="text-xs text-[var(--color-primary)]">{item.hashtags}</div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setExpandedDay(isOpen ? null : i)}
                          className="mt-1.5 text-[11px] font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          {isOpen ? "Hide full content" : "Show full content"}
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4">
                  <Label>Want to change something?</Label>
                  <div className="flex gap-2">
                    <Textarea
                      rows={2}
                      placeholder="e.g. Make day 3 about client testimonials instead, or add more myth-busting days"
                      value={amendment}
                      onChange={(e) => setAmendment(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={applyAmendment}
                      disabled={amending || !amendment.trim()}
                      className="shrink-0 self-start"
                    >
                      {amending ? <Spinner className="h-4 w-4" /> : "Apply"}
                    </Button>
                  </div>
                </div>

                {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

                <div className="mt-6 flex items-center justify-between gap-3">
                  <Button variant="ghost" onClick={() => setPhase("input")} disabled={starting || amending}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <div className="flex gap-3">
                    <Button variant="ghost" onClick={onClose} disabled={starting}>
                      Cancel
                    </Button>
                    <Button onClick={start} disabled={starting || amending || outline.length === 0}>
                      {starting ? <Spinner className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
                      {starting ? "Starting…" : `Generate ${outline.length} post${outline.length === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
