import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, Check, ExternalLink, FlaskConical, Save, Sparkles, Trash2, Upload, Video, X } from "lucide-react"
import { useEffect, useRef, useState, type ComponentType } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, Card, FadeIn, Label, Spinner, Textarea, Input } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import { FacebookBrand, InstagramBrand, LinkedInBrand, TikTokBrand, XBrand, YouTubeBrand } from "../components/BrandLogos"
import { YouTubeDetailsForm } from "../components/YouTubeDetailsForm"
import { PostInsightsPanel } from "../components/PostInsightsPanel"
import { PostScoreCard, ScoreBadge } from "../components/PostScore"
import type { Platform, Post, YouTubeOptions } from "../lib/types"

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const PLATFORM_META: Record<Platform, { label: string; icon: ComponentType<{ className?: string }> }> = {
  instagram: { label: "Instagram", icon: InstagramBrand },
  facebook: { label: "Facebook", icon: FacebookBrand },
  linkedin: { label: "LinkedIn", icon: LinkedInBrand },
  tiktok: { label: "TikTok", icon: TikTokBrand },
  x: { label: "X", icon: XBrand },
  youtube: { label: "YouTube", icon: YouTubeBrand },
}
const ALL_PLATFORMS: Platform[] = ["instagram", "facebook", "linkedin", "tiktok", "x", "youtube"]
const TABS = ["Content", "Publishing", "Insights"] as const

export function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => {
    const requested = searchParams.get("tab")
    return (TABS as readonly string[]).includes(requested ?? "") ? (requested as (typeof TABS)[number]) : "Content"
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState<Record<Platform, boolean> | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [yt, setYt] = useState<YouTubeOptions>({})
  const [ytDirty, setYtDirty] = useState(false)
  const ytDirtyRef = useRef(false)
  const [ytSaving, setYtSaving] = useState(false)
  const [ytSaved, setYtSaved] = useState(false)
  const [ytAssetBusy, setYtAssetBusy] = useState(false)
  const [thumbVersion, setThumbVersion] = useState(0)

  async function load() {
    const res = await api.get<Post>(`/posts/${id}`)
    setPost(res)
    setDirty(false)
    // Background polling (while a video generates) mustn't wipe unsaved
    // YouTube edits the user is in the middle of.
    if (!ytDirtyRef.current) setYt(res.youtube_options ?? {})
    return res
  }

  function markYtDirty(dirtyNow: boolean) {
    ytDirtyRef.current = dirtyNow
    setYtDirty(dirtyNow)
  }

  async function saveYouTube() {
    if (!post) return
    setYtSaving(true)
    setActionError(null)
    try {
      const { has_thumbnail: _h, captions_filename: _c, ...editable } = yt
      setYt(await api.put<YouTubeOptions>(`/youtube/posts/${post.id}/options`, editable))
      markYtDirty(false)
      setYtSaved(true)
      setTimeout(() => setYtSaved(false), 2500)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't save YouTube settings")
    } finally {
      setYtSaving(false)
    }
  }

  const [ytGenerating, setYtGenerating] = useState(false)
  async function generateThumbnail() {
    if (!post) return
    setYtGenerating(true)
    setActionError(null)
    try {
      const view = await api.post<YouTubeOptions>(`/youtube/posts/${post.id}/thumbnail/generate`)
      setYt((o) => ({ ...o, has_thumbnail: view.has_thumbnail }))
      setThumbVersion((v) => v + 1)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't create a thumbnail - try again.")
    } finally {
      setYtGenerating(false)
    }
  }

  async function setYouTubeAsset(kind: "thumbnail" | "captions", file: File | null) {
    if (!post) return
    setYtAssetBusy(true)
    setActionError(null)
    try {
      let view: YouTubeOptions
      if (file) {
        const fd = new FormData()
        fd.append("file", file)
        if (kind === "captions") fd.append("language", yt.captions_language ?? "en")
        view = await api.upload<YouTubeOptions>(`/youtube/posts/${post.id}/${kind}`, fd)
      } else {
        view = await api.delete<YouTubeOptions>(`/youtube/posts/${post.id}/${kind}`)
      }
      setYt((current) => ({ ...current, has_thumbnail: view.has_thumbnail, captions_filename: view.captions_filename }))
      if (kind === "thumbnail") setThumbVersion((v) => v + 1)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Couldn't update the ${kind}`)
    } finally {
      setYtAssetBusy(false)
    }
  }

  useEffect(() => {
    load()
    Promise.all([
      api.get<{ connected: boolean }>("/instagram/status"),
      api.get<{ connected: boolean; needs_page?: boolean }>("/facebook/status"),
      api.get<{ connected: boolean }>("/linkedin/status"),
      api.get<{ connected: boolean }>("/tiktok/status"),
      api.get<{ connected: boolean }>("/x/status"),
      api.get<{ connected: boolean }>("/youtube/status"),
    ]).then(([ig, fb, li, tt, x, yt]) => {
      setConnected({
        instagram: ig.connected,
        facebook: fb.connected && !fb.needs_page,
        linkedin: li.connected,
        tiktok: tt.connected,
        x: x.connected,
        youtube: yt.connected,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // While a post is still being written/generated, poll for progress instead
  // of leaving the page frozen on a stale "generating" state - stops itself
  // once it leaves that phase.
  // Keyed on `id` too (not just status): navigating directly between two
  // posts that happen to share the same in-progress status string wouldn't
  // otherwise restart this effect, leaving it polling the previous post.
  useEffect(() => {
    // Only photo posts are filled in by the server; a Reel waits for the
    // creator's own video, so there's nothing to poll for.
    if (!post || post.media_type !== "IMAGE" || !["planned", "image_generating"].includes(post.status)) return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.status, id])

  function onMediaUploaded(updated: Post) {
    setPost(updated)
    setDirty(false)
  }

  function update<K extends keyof Post>(key: K, value: Post[K]) {
    setPost((p) => (p ? { ...p, [key]: value } : p))
    setDirty(true)
  }

  function togglePlatform(platform: Platform) {
    if (!connected?.[platform]) return
    setPost((p) => {
      if (!p) return p
      const has = p.target_platforms.includes(platform)
      const target_platforms = has ? p.target_platforms.filter((x) => x !== platform) : [...p.target_platforms, platform]
      return { ...p, target_platforms }
    })
    setDirty(true)
  }

  async function save() {
    if (!post) return
    setSaving(true)
    setActionError(null)
    try {
      await api.patch(`/posts/${post.id}`, {
        title: post.title,
        caption: post.caption,
        hashtags: post.hashtags,
        hook: post.hook,
        video_concept: post.video_concept,
        image_prompt: post.image_prompt,
        script: post.script,
        on_screen_text: post.on_screen_text,
        broll_keywords: post.broll_keywords,
        scheduled_at: post.scheduled_at,
        target_platforms: post.target_platforms,
      })
      setDirty(false)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't save changes - try again.")
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!post) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await api.post<Post>(`/posts/${post.id}/approve`)
      setPost(res)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't approve this post - try again.")
    } finally {
      setBusy(false)
    }
  }

  async function redesign() {
    if (!post) return
    setBusy(true)
    setActionError(null)
    try {
      setPost(await api.post<Post>(`/posts/${post.id}/redesign`))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't start the redesign - try again.")
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!post || !reason.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await api.post<Post>(`/posts/${post.id}/reject`, { reason })
      setPost(res)
      setShowReject(false)
      setReason("")
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't reject this post - try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!post) return
    setBusy(true)
    setActionError(null)
    try {
      await api.delete(`/posts/${post.id}`)
      navigate(post.source === "user_uploaded" ? "/upload" : "/calendar")
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete this post - try again.")
      setShowDelete(false)
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
    <div className="section-post">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header bar: title + every primary action up front, instead of
          buried at the bottom of a long stacked form. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-[var(--font-display)] text-xl font-bold">{post.title || "Untitled"}</h1>
            <StatusBadge status={post.status} />
            {post.score && <ScoreBadge score={post.score.overall} grade={post.score.grade} />}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {new Date(post.scheduled_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            {post.pillar && ` · ${post.pillar}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {dirty && (
            <Button variant="outline" onClick={save} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
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
            <Button variant="danger" onClick={() => setShowDelete(true)} disabled={busy}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {post.error_message && (
        <FadeIn>
          <Card className="mb-6 border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 py-4">
            <p className="text-sm text-[var(--color-danger)]">{post.error_message}</p>
          </Card>
        </FadeIn>
      )}
      {post.reject_reason && (
        <FadeIn>
          <Card className="mb-6 border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 py-4">
            <p className="text-sm text-[var(--color-warning)]">
              <span className="font-semibold">Last rejection:</span> {post.reject_reason}
              {post.retry_count > 0 && ` (attempt ${post.retry_count})`}
            </p>
          </Card>
        </FadeIn>
      )}

      {actionError && (
        <FadeIn>
          <p className="mb-4 text-sm text-[var(--color-danger)]">{actionError}</p>
        </FadeIn>
      )}

      {/* Media as a top banner instead of a dominant side column - sized to
          the media's own aspect ratio (mostly portrait 9:16 Reels) rather
          than stretched full-width, which just letterboxed it with huge
          black bars on either side. */}
      <div className="panel-ribbon glass-card mx-auto mb-6 w-fit overflow-hidden p-0">
        {post.media_type === "IMAGE" && (post.status === "planned" || post.status === "image_generating") ? (
          <GeneratingPanel status={post.status} />
        ) : post.has_video && post.media_type === "IMAGE" ? (
          <img className="h-96 w-auto max-w-full bg-black object-contain" src={`/api/posts/${post.id}/video?v=${encodeURIComponent(post.updated_at)}`} />
        ) : post.has_video ? (
          <video controls className="h-96 w-auto max-w-full bg-black" src={`/api/posts/${post.id}/video?v=${encodeURIComponent(post.updated_at)}`} />
        ) : (
          <MediaUploadPanel post={post} onUploaded={onMediaUploaded} />
        )}
      </div>
      {post.has_video && !["posted", "publishing", "image_generating"].includes(post.status) && (
        <div className="-mt-3 mb-6 flex justify-center gap-2">
          {post.media_type === "IMAGE" && post.source === "ai_generated" && (
            <button
              type="button"
              onClick={redesign}
              disabled={busy || dirty}
              title={dirty ? "Save your changes first" : undefined}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" /> Redesign
            </button>
          )}
          <ReplaceMediaButton post={post} onUploaded={onMediaUploaded} />
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b-2 border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "-mb-0.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition " +
              (tab === t
                ? "border-[var(--color-primary)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Content" && (
        <div className="max-w-3xl space-y-5">
          {post.score && <PostScoreCard score={post.score} />}
          {(post.research_notes || post.sources?.length > 0) && <ResearchCard post={post} />}
          <div>
            <Label>Title</Label>
            <Input value={post.title} onChange={(e) => update("title", e.target.value)} />
          </div>
          <div>
            <Label>Caption</Label>
            <Textarea rows={4} value={post.caption} onChange={(e) => update("caption", e.target.value)} />
          </div>
          <div>
            <Label>Hashtags</Label>
            <Textarea rows={2} value={post.hashtags} onChange={(e) => update("hashtags", e.target.value)} />
          </div>

          {post.source === "ai_generated" && post.media_type === "REELS" && (
            <>
              <div>
                <Label>Hook (first 1–2 seconds)</Label>
                <Input value={post.hook} onChange={(e) => update("hook", e.target.value)} />
              </div>
              <div>
                <Label>Script to record</Label>
                <Textarea rows={6} value={post.script} onChange={(e) => update("script", e.target.value)} />
              </div>
              <div>
                <Label>Shot list</Label>
                <Textarea rows={6} value={post.video_concept} onChange={(e) => update("video_concept", e.target.value)} />
              </div>
              <div>
                <Label>On-screen text</Label>
                <Textarea rows={3} value={post.on_screen_text} onChange={(e) => update("on_screen_text", e.target.value)} />
              </div>
              <div>
                <Label>B-roll to capture</Label>
                <Input value={post.broll_keywords} onChange={(e) => update("broll_keywords", e.target.value)} />
              </div>
            </>
          )}

          {post.source === "ai_generated" && post.media_type === "IMAGE" && (
            <div>
              <Label>Image prompt</Label>
              <Textarea rows={8} value={post.image_prompt} onChange={(e) => update("image_prompt", e.target.value)} />
              <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                The prompt this post's image was made from. Edit it, save, then press Redesign — or clear it
                and Redesign to have Claude write a fresh one.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "Publishing" && (
        <div className="max-w-3xl space-y-5">
          <div>
            <Label>Posting date & time</Label>
            <Input
              type="datetime-local"
              value={toDatetimeLocal(post.scheduled_at)}
              onChange={(e) => update("scheduled_at", e.target.value)}
            />
          </div>

          <div>
            <Label>Publish to</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_PLATFORMS.map((platform) => {
                const meta = PLATFORM_META[platform]
                const isConnected = Boolean(connected?.[platform])
                const isSelected = post.target_platforms.includes(platform)
                return (
                  <button
                    key={platform}
                    type="button"
                    disabled={!isConnected}
                    onClick={() => togglePlatform(platform)}
                    title={isConnected ? undefined : `Connect ${meta.label} in Settings first`}
                    className={
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition " +
                      (!isConnected
                        ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-faint)] opacity-50"
                        : isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-text)]"
                          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-black/5")
                    }
                  >
                    <meta.icon className="h-4 w-4" />
                    {meta.label}
                    {!isConnected && " (not connected)"}
                  </button>
                )
              })}
            </div>
          </div>

          {post.publications.length > 0 && (
            <div>
              <Label>Publish history</Label>
              <div className="space-y-1.5 rounded-md border border-[var(--color-border)] p-4">
                {post.publications.map((pub) => {
                  const meta = PLATFORM_META[pub.platform]
                  return (
                    <div key={pub.platform} className="flex items-center gap-2 text-xs">
                      <meta.icon className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
                      <span className="text-[var(--color-text-muted)]">{meta.label}:</span>
                      {pub.status === "posted" && pub.permalink ? (
                        <a
                          href={pub.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline"
                        >
                          Posted <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : pub.status === "failed" ? (
                        <span className="text-[var(--color-danger)]">Failed{pub.error_message ? `: ${pub.error_message}` : ""}</span>
                      ) : (
                        <span className="text-[var(--color-text-faint)] capitalize">{pub.status}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "Insights" && <PostInsightsPanel postId={post.id} />}

      {tab === "Publishing" && post.media_type === "REELS" && (
        <div className="glass-card mt-8 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
            <div className="flex items-center gap-2.5">
              <YouTubeBrand className="h-6 w-8" />
              <div>
                <h3 className="font-[var(--font-display)] text-lg font-bold leading-tight">YouTube details</h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {post.target_platforms.includes("youtube")
                    ? "Applied when this video is published to YouTube."
                    : "Select YouTube under Publish to above for these to be used."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {ytSaved && (
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--color-success)]">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              <Button onClick={saveYouTube} disabled={!ytDirty || ytSaving}>
                <Save className="h-4 w-4" /> {ytSaving ? "Saving…" : "Save YouTube details"}
              </Button>
            </div>
          </div>
          <YouTubeDetailsForm
            value={yt}
            onChange={(patch) => {
              setYt((o) => ({ ...o, ...patch }))
              markYtDirty(true)
            }}
            fallback={{ title: post.title, caption: post.caption, hashtags: post.hashtags }}
            videoUrl={post.has_video ? `/api/posts/${post.id}/video` : null}
            thumbnailUrl={yt.has_thumbnail ? `/api/youtube/posts/${post.id}/thumbnail?v=${thumbVersion}` : null}
            onThumbnail={(f) => setYouTubeAsset("thumbnail", f)}
            onGenerateThumbnail={generateThumbnail}
            generatingThumbnail={ytGenerating}
            captionsName={yt.captions_filename ?? ""}
            onCaptions={(f) => setYouTubeAsset("captions", f)}
            assetBusy={ytAssetBusy}
          />
        </div>
      )}

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

      <AnimatePresence>
        {showDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => !busy && setShowDelete(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card w-full max-w-md p-6"
            >
              <h3 className="font-[var(--font-display)] text-lg font-bold">
                Delete "{post.title || "this post"}"?
              </h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                This can't be undone — the post, its video/image, and its publish history will all be gone.
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setShowDelete(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={remove} disabled={busy}>
                  {busy ? "Deleting…" : "Delete post"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function GeneratingPanel({ status }: { status: "planned" | "image_generating" }) {
  const label = status === "image_generating" ? "Making your image…" : "Queued — starting shortly…"
  const detail = "Claude is picking a photo and writing the headline — usually 10–20 seconds."
  return (
    <div className="flex h-96 w-72 flex-col items-center justify-center gap-5 p-8 text-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
        className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--color-border-strong)] bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)]"
      >
        <Sparkles className="h-5 w-5 text-white" strokeWidth={2.5} />
      </motion.div>
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">{detail}</p>
      </div>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-black/8">
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

function useMediaUpload(post: Post, onUploaded: (p: Post) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isReel = post.media_type === "REELS"
  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      onUploaded(await api.upload<Post>(`/uploads/posts/${post.id}/media`, fd))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed - try again.")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={isReel ? "video/mp4,video/quicktime,.mp4,.mov" : "image/jpeg,image/png,.jpg,.jpeg,.png"}
      className="hidden"
      onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
    />
  )
  return { inputRef, uploading, error, isReel, upload, input }
}

function MediaUploadPanel({ post, onUploaded }: { post: Post; onUploaded: (p: Post) => void }) {
  const { inputRef, uploading, error, isReel, upload, input } = useMediaUpload(post, onUploaded)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) upload(file)
      }}
      className={
        "flex h-96 w-80 flex-col items-center justify-center gap-4 p-8 text-center transition " +
        (over ? "bg-[var(--color-primary)]/10" : "")
      }
    >
      {input}
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)]">
        {isReel ? <Video className="h-5 w-5 text-white" /> : <Upload className="h-5 w-5 text-white" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{isReel ? "Film it, then upload your video" : "Upload a photo"}</p>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">
          {isReel
            ? "Use the script and shot list below. Once your video is attached this Reel moves to review."
            : "Drop in the photo for this post to send it to review."}
        </p>
      </div>
      <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {uploading ? "Uploading…" : isReel ? "Choose video (mp4/mov)" : "Choose photo (jpg/png)"}
      </Button>
      <p className="text-[11px] text-[var(--color-text-faint)]">or drag and drop it here</p>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}

function ReplaceMediaButton({ post, onUploaded }: { post: Post; onUploaded: (p: Post) => void }) {
  const { inputRef, uploading, error, isReel, input } = useMediaUpload(post, onUploaded)
  return (
    <div className="flex flex-col items-center gap-1">
      {input}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
      >
        {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? "Uploading…" : isReel ? "Replace video" : "Replace photo"}
      </button>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}

function ResearchCard({ post }: { post: Post }) {
  return (
    <div className="rounded-xl border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/[0.05] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
        <FlaskConical className="h-3.5 w-3.5" /> Research behind this post
      </div>
      {post.research_notes && <p className="text-sm leading-relaxed text-[var(--color-text)]">{post.research_notes}</p>}
      {post.sources?.length > 0 && (
        <ul className="mt-3 space-y-1">
          {post.sources.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate text-xs text-[var(--color-primary)] hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{url.replace(/^https?:\/\/(www\.)?/, "")}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
