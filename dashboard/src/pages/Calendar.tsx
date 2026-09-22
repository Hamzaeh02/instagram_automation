import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, CalendarPlus, Check, ChevronRight, File as FileIcon, Film, Image as ImageIcon, Sparkles, Trash2, Upload, X, XCircle } from "lucide-react"
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
  const [actioningId, setActioningId] = useState<number | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Post | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [rejectBusy, setRejectBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
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
      await load()
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
                  ? "border-[var(--color-border)] bg-black/[0.03] text-[var(--color-text-muted)]"
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
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
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
                  : "text-[var(--color-text-muted)] hover:bg-black/5")
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
          <p className="text-sm text-[var(--color-text-muted)]">Nothing matches these filters yet.</p>
        </Card>
      )}

      <div className="space-y-8">
        {grouped.map(([month, monthPosts]) => (
          <div key={month}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              {month}
            </h3>
            <div className="space-y-2">
              {monthPosts.map((post, i) => {
                const canReview = post.status === "pending_review" || post.status === "needs_manual_edit"
                const canDelete = post.status !== "posted" && post.status !== "publishing"
                return (
                  <FadeIn key={post.id} delay={Math.min(i * 0.03, 0.3)}>
                    <motion.div
                      whileHover={{ x: 3 }}
                      className="glass-card flex items-center gap-4 px-5 py-4 transition-colors hover:border-[var(--color-border-strong)]"
                    >
                      <Link to={`/posts/${post.id}`} className="flex min-w-0 flex-1 items-center gap-4">
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
                      </Link>

                      {(canReview || canDelete) && (
                        <div className="flex shrink-0 items-center gap-1">
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

                      <StatusBadge status={post.status} />
                      <Link to={`/posts/${post.id}`}>
                        <ChevronRight className="h-4 w-4 text-[var(--color-text-faint)]" />
                      </Link>
                    </motion.div>
                  </FadeIn>
                )
              })}
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
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                "{rejectTarget.title || "Untitled"}" — your feedback is used to regenerate it.
              </p>
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
              <h3 className="font-[var(--font-display)] text-lg font-bold">
                Delete "{deleteTarget.title || "this post"}"?
              </h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                This can't be undone — the post, its video/image, and its publish history will all be gone.
              </p>
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
  description: string
}

function GenerateModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [phase, setPhase] = useState<"input" | "review">("input")
  const [contentType, setContentType] = useState<"video" | "post">("video")
  const [brief, setBrief] = useState("")
  const [docFile, setDocFile] = useState<File | null>(null)
  const [days, setDays] = useState(90)
  const [outline, setOutline] = useState<PlanItem[]>([])
  const [resolvedBrief, setResolvedBrief] = useState("")
  const [amendment, setAmendment] = useState("")
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
    setError(null)
  }

  async function analyze() {
    if (!brief.trim() && !docFile) return
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
                <h3 className="font-[var(--font-display)] text-lg font-bold">Generate content</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Describe it, upload a document, or both — we'll show you what we understood before anything's
                  generated.
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
                          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
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
                          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
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
                    max={90}
                    value={days}
                    onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full rounded-md border border-[var(--color-border)] bg-black/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary)] focus:bg-black/[0.05]"
                  />
                </div>

                {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

                <div className="mt-6 flex justify-end gap-3">
                  <Button variant="ghost" onClick={onClose} disabled={analyzing}>
                    Cancel
                  </Button>
                  <Button onClick={analyze} disabled={analyzing || (!brief.trim() && !docFile)}>
                    {analyzing ? <Spinner className="h-4 w-4" /> : null}
                    {analyzing ? "Analyzing…" : "Next: review"}
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

                <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
                  {outline.map((item, i) => (
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
                      <div className="mt-1 text-sm font-semibold">{item.hook}</div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{item.description}</div>
                    </div>
                  ))}
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
