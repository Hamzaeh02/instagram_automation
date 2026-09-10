import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, Check, ExternalLink, Save, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, Label, Spinner, Textarea, Input } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import type { Post } from "../lib/types"

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
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

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
            {post.scheduled_date} · {post.pillar}
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
            {post.has_video ? (
              <video controls className="aspect-[9/16] w-full bg-black" src={`/api/posts/${post.id}/video`} />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center text-sm text-[var(--color-text-faint)]">
                No video generated yet
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
            <Label>Caption</Label>
            <Textarea rows={4} value={post.caption} onChange={(e) => update("caption", e.target.value)} />
          </Card>

          <Card>
            <Label>Hashtags</Label>
            <Textarea rows={2} value={post.hashtags} onChange={(e) => update("hashtags", e.target.value)} />
          </Card>

          <Card>
            <Label>Voiceover script</Label>
            <Textarea rows={5} value={post.script} onChange={(e) => update("script", e.target.value)} />
          </Card>

          <Card>
            <Label>B-roll keywords</Label>
            <Input value={post.broll_keywords} onChange={(e) => update("broll_keywords", e.target.value)} />
          </Card>

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
