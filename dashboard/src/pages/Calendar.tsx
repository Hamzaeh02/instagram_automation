import { AnimatePresence, motion } from "framer-motion"
import { CalendarPlus, ChevronRight, Film, Image as ImageIcon, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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

export function Calendar() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all")
  const [mediaFilter, setMediaFilter] = useState<"all" | "REELS" | "IMAGE">("all")
  const [showGenerate, setShowGenerate] = useState(false)

  async function load() {
    const res = await api.get<{ posts: Post[] }>("/posts?limit=200")
    setPosts(res.posts)
  }

  useEffect(() => {
    load()
  }, [])

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
    <div>
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition " +
                (statusFilter === f.value
                  ? "border-[var(--color-primary)] bg-violet-500/15 text-[var(--color-text)]"
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
                  ? "bg-violet-500/15 text-[var(--color-text)]"
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
                      className="glass-card flex items-center gap-4 px-5 py-4 transition-colors hover:border-[var(--color-border-strong)]"
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

      <GenerateModal open={showGenerate} onClose={() => setShowGenerate(false)} onDone={load} />
    </div>
  )
}

function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [contentType, setContentType] = useState<"video" | "post">("video")
  const [brief, setBrief] = useState("")
  const [days, setDays] = useState(90)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (!brief.trim()) return
    setGenerating(true)
    setError(null)
    try {
      await api.post("/calendar/generate", { days, content_type: contentType, brief: brief.trim() })
      // Generation runs server-side as a background task (it makes several
      // slow LLM calls) - poll the activity log rather than holding one long
      // HTTP request open, which was fragile (interrupted by navigation,
      // proxy timeouts, etc.) and left the button stuck spinning.
      const startedAt = Date.now()
      const POLL_MS = 3000
      const TIMEOUT_MS = 5 * 60 * 1000
      while (Date.now() - startedAt < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        const res = await api.get<{ runs: RunLogEntry[] }>("/activity?limit=1")
        const latest = res.runs[0]
        if (latest && latest.status !== "running" && new Date(latest.started_at).getTime() >= startedAt - POLL_MS) {
          if (latest.status === "error") {
            setError(latest.error || "Generation failed")
            return
          }
          break
        }
      }
      await onDone()
      setBrief("")
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start generating")
    } finally {
      setGenerating(false)
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
          onClick={() => !generating && onClose()}
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
                    "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition " +
                    (contentType === "video"
                      ? "border-[var(--color-primary)] bg-violet-500/10 text-[var(--color-text)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
                  }
                >
                  <Film className="h-4 w-4" /> Video Reels
                </button>
                <button
                  type="button"
                  onClick={() => setContentType("post")}
                  className={
                    "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition " +
                    (contentType === "post"
                      ? "border-[var(--color-primary)] bg-violet-500/10 text-[var(--color-text)]"
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
                className="w-full rounded-xl border border-[var(--color-border)] bg-white/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary)] focus:bg-white/[0.05] focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={onClose} disabled={generating}>
                Cancel
              </Button>
              <Button onClick={generate} disabled={generating || !brief.trim()}>
                {generating ? <Spinner className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
                {generating ? "Generating…" : "Generate"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
