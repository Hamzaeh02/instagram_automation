import { AnimatePresence, motion } from "framer-motion"
import { CalendarPlus, Check, ChevronRight, Film, Image as ImageIcon, Sparkles, XCircle } from "lucide-react"
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

export function Calendar() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all")
  const [mediaFilter, setMediaFilter] = useState<"all" | "REELS" | "IMAGE">("all")
  const [showGenerate, setShowGenerate] = useState(false)
  const [runState, setRunState] = useState<{ status: "running" | "done" | "error"; message?: string } | null>(null)
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

  const grouped = useMemo(() => {
    const groups = new Map<string, Post[]>()
    for (const post of filtered) {
      const month = new Date(post.scheduled_at).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
      if (!groups.has(month)) groups.set(month, [])
      groups.get(month)!.push(post)
    }
    return Array.from(groups.entries())
  }, [filtered])

  return (
    <div className="section-calendar">
      <PageHeader
        eyebrow="Calendar"
        title="90-day content plan"
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
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300")
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition " +
                (statusFilter === f.value
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-full border border-[var(--color-border)] p-1">
          {MEDIA_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setMediaFilter(f.value)}
              className={
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition " +
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

      {posts && posts.length > 0 && filtered.length === 0 && (
        <Card className="py-16 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            Nothing matches these filters yet.
          </p>
        </Card>
      )}

      <div className="space-y-8">
        {grouped.map(([month, monthPosts]) => (
          <div key={month}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              {month}
            </h3>
            <div className="space-y-2">
              {monthPosts.map((post, i) => (
                <FadeIn key={post.id} delay={Math.min(i * 0.03, 0.3)}>
                  <Link to={`/posts/${post.id}`}>
                    <motion.div
                      whileHover={{ x: 3 }}
                      className="glass-card panel-strip flex items-center gap-4 px-5 py-4 transition-colors hover:border-[var(--color-border-strong)]"
                    >
                      <div className="w-16 shrink-0 text-center">
                        <div className="text-lg font-bold leading-none">
                          {new Date(post.scheduled_at).getDate()}
                        </div>
                        <div className="mt-1 text-[10px] uppercase text-[var(--color-text-faint)]">
                          {new Date(post.scheduled_at).toLocaleDateString(undefined, { weekday: "short" })}
                        </div>
                      </div>
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
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-faint)]" />
                    </motion.div>
                  </Link>
                </FadeIn>
              ))}
            </div>
          </div>
        ))}
      </div>

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
                className="w-full rounded-md border border-[var(--color-border)] bg-white/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary)] focus:bg-white/[0.05] focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>

            {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

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
