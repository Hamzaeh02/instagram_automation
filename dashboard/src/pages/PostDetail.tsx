import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, Check, ExternalLink, Save, Sparkles, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, Label, Spinner, Textarea, Input } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import type { Post } from "../lib/types"

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await api.get<Post>(`/posts/${id}`)
    setPost(res)
    setDirty(false)
    return res
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // While a post is still being written/generated (e.g. just triggered from
  // "Create with AI"), poll for progress instead of leaving the page frozen
  // on a stale "generating" state - stops itself once it leaves that phase.
  useEffect(() => {
    if (!post || !["planned", "video_generating", "image_generating"].includes(post.status)) return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.status])

  function update<K extends keyof Post>(key: K, value: Post[K]) {
    setPost((p) => (p ? { ...p, [key]: value } : p))
    setDirty(true)
  }

  async function save() {
    if (!post) return
    setSaving(true)
    try {
      await api.patch(`/posts/${post.id}`, {
        title: post.title,
        caption: post.caption,
        hashtags: post.hashtags,
        script: post.script,
        on_screen_text: post.on_screen_text,
        broll_keywords: post.broll_keywords,
        scheduled_at: post.scheduled_at,
      })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!post) return
    setBusy(true)
    try {
      const res = await api.post<Post>(`/posts/${post.id}/approve`)
      setPost(res)
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!post || !reason.trim()) return
    setBusy(true)
    try {
      const res = await api.post<Post>(`/posts/${post.id}/reject`, { reason })
      setPost(res)
      setShowReject(false)
      setReason("")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!post) return
    if (!confirm(`Delete "${post.title || "this post"}"? This can't be undone.`)) return
    setBusy(true)
    try {
      await api.delete(`/posts/${post.id}`)
      navigate(post.source === "user_uploaded" ? "/upload" : "/calendar")
    } finally {
      setBusy(false)
    }
  }

  if (!post) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-[var(--font-display)] text-2xl font-bold">{post.title || "Untitled"}</h1>
            <StatusBadge status={post.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {new Date(post.scheduled_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            · {post.pillar}
          </p>
        </div>

        {post.ig_permalink && (
          <a
            href={post.ig_permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            View on Instagram <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {post.error_message && (
        <FadeIn>
          <Card className="mb-6 border-rose-500/30 bg-rose-500/5 py-4">
            <p className="text-sm text-rose-300">{post.error_message}</p>
          </Card>
        </FadeIn>
      )}
      {post.reject_reason && (
        <FadeIn>
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5 py-4">
            <p className="text-sm text-amber-300">
              <span className="font-semibold">Last rejection:</span> {post.reject_reason}
              {post.retry_count > 0 && ` (attempt ${post.retry_count})`}
            </p>
          </Card>
        </FadeIn>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <FadeIn className="lg:col-span-2">
          <Card className="overflow-hidden p-0">
            {post.has_video && post.media_type === "IMAGE" ? (
              <img className="aspect-[9/16] w-full bg-black object-contain" src={`/api/posts/${post.id}/video`} />
            ) : post.has_video ? (
              <video controls className="aspect-[9/16] w-full bg-black" src={`/api/posts/${post.id}/video`} />
            ) : post.status === "planned" || post.status === "video_generating" || post.status === "image_generating" ? (
              <GeneratingPanel status={post.status} />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center text-sm text-[var(--color-text-faint)]">
                No video for this post
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.05} className="space-y-5 lg:col-span-3">
          <Card>
            <Label>Title</Label>
            <Input value={post.title} onChange={(e) => update("title", e.target.value)} />
          </Card>

          <Card>
            <Label>Posting date & time</Label>
            <Input
              type="datetime-local"
              value={toDatetimeLocal(post.scheduled_at)}
              onChange={(e) => update("scheduled_at", e.target.value)}
            />
          </Card>

          <Card>
            <Label>Caption</Label>
            <Textarea rows={4} value={post.caption} onChange={(e) => update("caption", e.target.value)} />
          </Card>

          <Card>
            <Label>Hashtags</Label>
            <Textarea rows={2} value={post.hashtags} onChange={(e) => update("hashtags", e.target.value)} />
          </Card>

          {post.source === "ai_generated" && post.media_type === "REELS" && (
            <>
              <Card>
                <Label>Voiceover script</Label>
                <Textarea rows={5} value={post.script} onChange={(e) => update("script", e.target.value)} />
              </Card>

              <Card>
                <Label>B-roll keywords</Label>
                <Input value={post.broll_keywords} onChange={(e) => update("broll_keywords", e.target.value)} />
              </Card>
            </>
          )}

          {post.source === "ai_generated" && post.media_type === "IMAGE" && (
            <Card>
              <Label>Stock photo keywords</Label>
              <Input value={post.broll_keywords} onChange={(e) => update("broll_keywords", e.target.value)} />
              <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                What the stock photo was searched for.
              </p>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {dirty && (
              <Button variant="outline" onClick={save} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save changes"}
              </Button>
            )}

            {(post.status === "pending_review" || post.status === "needs_manual_edit") && (
              <>
                <Button onClick={approve} disabled={busy}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button variant="danger" onClick={() => setShowReject(true)} disabled={busy}>
                  <X className="h-4 w-4" /> Reject
                </Button>
              </>
            )}

            {post.status !== "posted" && post.status !== "publishing" && (
              <Button variant="danger" onClick={remove} disabled={busy} className="ml-auto">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </FadeIn>
      </div>

      <AnimatePresence>
        {showReject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowReject(false)}
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
                Your feedback is used to regenerate the script and video.
              </p>
              <Textarea
                autoFocus
                rows={3}
                className="mt-4"
                placeholder="e.g. the hook is weak, make it punchier"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setShowReject(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={reject} disabled={busy || !reason.trim()}>
                  {busy ? "Submitting…" : "Confirm rejection"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function GeneratingPanel({ status }: { status: "planned" | "video_generating" | "image_generating" }) {
  const label =
    status === "video_generating"
      ? "Generating your video…"
      : status === "image_generating"
        ? "Finding a matching photo…"
        : "Queued — starting shortly…"
  const detail =
    status === "image_generating"
      ? "Searching stock photos for a match — usually just a few seconds."
      : "Voiceover, footage, and captions are being put together — usually a minute or two."
  return (
    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-5 p-8 text-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)] shadow-lg shadow-violet-900/40"
      >
        <Sparkles className="h-5 w-5 text-white" strokeWidth={2.5} />
      </motion.div>
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">{detail}</p>
      </div>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--color-accent-from)] to-[var(--color-accent-to)]"
          animate={{ x: ["-100%", "220%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)]">This page updates automatically — no need to refresh.</p>
    </div>
  )
}
