import { AnimatePresence, motion } from "framer-motion"
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Film, Image as ImageIcon, Sparkles, XCircle } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, Card, FadeIn, Label, PageHeader, Spinner, Textarea } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
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

const POLL_MS = 3000
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function Calendar() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all")
  const [mediaFilter, setMediaFilter] = useState<"all" | "REELS" | "IMAGE">("all")
  const [showGenerate, setShowGenerate] = useState(false)
  const [runState, setRunState] = useState<{ status: "running" | "done" | "error"; message?: string } | null>(null)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const pollRef = useRef<number | null>(null)

  async function load() {
    const res = await api.get<{ posts: Post[] }>("/posts?limit=200")
    setPosts(res.posts)
  }

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  function watchRun() {
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
        if (latest.status === "error") {
          setRunState({ status: "error", message: latest.error || "Generation failed" })
        } else {
          const res = await api.get<{ posts: Post[] }>("/posts?limit=200")
          setPosts(res.posts)
          const added = res.posts.filter((p) => !before.has(p.id)).length
          setRunState({ status: "done", message: added > 0 ? `Generated ${added} new post${added === 1 ? "" : "s"}.` : "Done — nothing new to add." })
        }
        setTimeout(() => setRunState((s) => (s?.status === "done" ? null : s)), 6000)
      }
    }, POLL_MS)
  }

  const filtered = useMemo(() => {
    if (!posts) return []
    return posts
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => mediaFilter === "all" || p.media_type === mediaFilter)
  }, [posts, statusFilter, mediaFilter])

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>()
    for (const post of filtered) {
      const key = dayKey(new Date(post.scheduled_at))
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(post)
    }
    return map
  }, [filtered])

  const grid = useMemo(() => {
    const firstWeekday = month.getDay()
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [month])

  const dayPosts = (byDay.get(dayKey(selectedDay)) ?? []).sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  )
  const today = new Date()

  return (
    <div className="section-calendar">
      <PageHeader
        eyebrow="Calendar"
        title="Content calendar"
        description="Every post the strategy engine has planned, generated, or published."
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
                  ? "border-[var(--color-border)] bg-white/[0.03] text-[var(--color-text-muted)]"
                  : runState.status === "done"
                    ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                    : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]")
              }
            >
              {runState.status === "running" ? (
                <>
                  <Spinner className="h-4 w-4" /> Generating your content in the background — feel free to keep
                  browsing, this'll update on its own.
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

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-semibold transition " +
              (statusFilter === f.value
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
            }
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex gap-1 rounded-md border border-[var(--color-border)] p-1">
          {MEDIA_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setMediaFilter(f.value)}
              className={
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition " +
                (mediaFilter === f.value
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-white/5")
              }
            >
              <f.icon className="h-3.5 w-3.5" />
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {posts === null && (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
        </div>
      )}

      {posts?.length === 0 && (
        <Card className="py-16 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            No content planned yet. Describe what you want and generate your first content run.
          </p>
          <Button onClick={() => setShowGenerate(true)} className="mx-auto mt-4">
            <CalendarPlus className="h-4 w-4" /> Generate content
          </Button>
        </Card>
      )}

      {posts && posts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="glass-card p-4 lg:col-span-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <button
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="rounded-md border border-[var(--color-border)] p-1.5 hover:bg-white/5"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="font-[var(--font-display)] font-bold">
                {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </h3>
              <button
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="rounded-md border border-[var(--color-border)] p-1.5 hover:bg-white/5"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 px-1 pb-1.5 text-center text-[10px] font-bold uppercase text-[var(--color-text-faint)]">
              {WEEKDAYS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((d, i) => {
                if (!d) return <div key={i} />
                const key = dayKey(d)
                const dayItems = byDay.get(key) ?? []
                const isToday = dayKey(today) === key
                const isSelected = dayKey(selectedDay) === key
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDay(d)}
                    className={
                      "flex aspect-square flex-col items-center justify-start gap-1 rounded-md border p-1.5 text-left transition " +
                      (isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                        : isToday
                          ? "border-[var(--color-border-strong)]"
                          : "border-[var(--color-border)] hover:bg-white/5")
                    }
                  >
                    <span className={"text-xs font-semibold " + (isToday ? "text-[var(--color-primary)]" : "")}>
                      {d.getDate()}
                    </span>
                    <div className="flex flex-wrap justify-center gap-0.5">
                      {dayItems.slice(0, 4).map((p) => (
                        <span
                          key={p.id}
                          className={
                            "h-1.5 w-1.5 rounded-full " +
                            (p.status === "posted"
                              ? "bg-[var(--color-success)]"
                              : p.status === "needs_manual_edit"
                                ? "bg-[var(--color-danger)]"
                                : "bg-[var(--color-primary)]")
                          }
                        />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="lg:col-span-2">
            <h3 className="mb-3 font-[var(--font-display)] text-sm font-bold">
              {selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h3>
            {dayPosts.length === 0 ? (
              <div className="glass-card panel-strip px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                Nothing scheduled this day.
              </div>
            ) : (
              <div className="space-y-2">
                {dayPosts.map((post, i) => (
                  <FadeIn key={post.id} delay={Math.min(i * 0.03, 0.3)}>
                    <Link to={`/posts/${post.id}`}>
                      <motion.div
                        whileHover={{ x: 3 }}
                        className="glass-card panel-strip flex items-center gap-3 px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
                      >
                        {post.media_type === "REELS" ? (
                          <Film className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                        ) : (
                          <ImageIcon className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{post.title || "Untitled"}</div>
                          <div className="truncate text-xs text-[var(--color-text-faint)]">
                            {new Date(post.scheduled_at).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}{" "}
                            · {post.pillar}
                          </div>
                        </div>
                        <StatusBadge status={post.status} />
                      </motion.div>
                    </Link>
                  </FadeIn>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <GenerateModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onStarted={() => {
          setShowGenerate(false)
          watchRun()
        }}
      />
    </div>
  )
}

function GenerateModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [contentType, setContentType] = useState<"video" | "post">("video")
  const [brief, setBrief] = useState("")
  const [days, setDays] = useState(90)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (!brief.trim()) return
    setStarting(true)
    setError(null)
    try {
      await api.post("/calendar/generate", { days, content_type: contentType, brief: brief.trim() })
      setBrief("")
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
          onClick={() => !starting && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-lg p-6"
          >
            <h3 className="font-[var(--font-display)] text-lg font-bold">Generate content</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Tell us what this run should be about — the strategy engine writes and schedules it for you.
            </p>

            <div className="mt-5">
              <Label>Content type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setContentType("video")}
                  className={
                    "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition " +
                    (contentType === "video"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-text)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
                  }
                >
                  <Film className="h-4 w-4" /> Video Reels
                </button>
                <button
                  type="button"
                  onClick={() => setContentType("post")}
                  className={
                    "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition " +
                    (contentType === "post"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-text)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
                  }
                >
                  <ImageIcon className="h-4 w-4" /> Photo posts
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                {contentType === "video"
                  ? "Script, voiceover, stock b-roll, and burned-in captions."
                  : "A caption + matching stock photo for each date, no video."}
              </p>
            </div>

            <div className="mt-5">
              <Label>What should this run be about?</Label>
              <Textarea
                autoFocus
                rows={4}
                placeholder="e.g. Focus the next batch on our new winter product line, more customer testimonials, and less generic tips"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>

            <div className="mt-5 w-32">
              <Label>Days to plan</Label>
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full rounded-md border border-[var(--color-border)] bg-black/20 px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary)] focus:bg-black/30"
              />
            </div>

            {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={onClose} disabled={starting}>
                Cancel
              </Button>
              <Button onClick={start} disabled={starting || !brief.trim()}>
                {starting ? <Spinner className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
                {starting ? "Starting…" : "Generate"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
