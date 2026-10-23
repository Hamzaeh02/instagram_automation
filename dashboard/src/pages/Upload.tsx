import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, ArrowRight, Calendar as CalendarIcon, Check, Film, Image as ImageIcon, UploadCloud, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, FieldLabelRow, Input, Label, PageHeader, Textarea } from "../components/ui"
import { AiImproveButton } from "../components/AiImproveButton"
import { BRAND_PLATFORMS, YouTubeBrand } from "../components/BrandLogos"
import { StatusBadge } from "../components/StatusBadge"
import { YouTubeDetailsForm } from "../components/YouTubeDetailsForm"
import type { BrandProfile, Platform, PostStatus, YouTubeOptions } from "../lib/types"

interface UploadedPost {
  id: number
  title: string
  media_type: "REELS" | "IMAGE"
  scheduled_at: string
  status: PostStatus
  video_url: string
}

function nowLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function Upload() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [caption, setCaption] = useState("")
  const [hashtags, setHashtags] = useState("")
  const [scheduledAt, setScheduledAt] = useState(nowLocal())
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justUploaded, setJustUploaded] = useState<string | null>(null)
  const [recent, setRecent] = useState<UploadedPost[] | null>(null)
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [targets, setTargets] = useState<Platform[]>([])
  const [ytOptions, setYtOptions] = useState<YouTubeOptions>({})
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [capFile, setCapFile] = useState<File | null>(null)

  async function loadRecent() {
    const res = await api.get<{ posts: UploadedPost[] }>("/uploads?limit=50")
    setRecent(res.posts)
  }

  useEffect(() => {
    loadRecent()
    api.get<{ brand: BrandProfile | null }>("/brand").then((r) => setBrand(r.brand))
    Promise.all(
      BRAND_PLATFORMS.map((p) =>
        api
          .get<{ connected: boolean; needs_page?: boolean }>(`/${p.key}/status`)
          .then((s) => [p.key, s.connected && !s.needs_page] as const)
          .catch(() => [p.key, false] as const),
      ),
    ).then((entries) => {
      const map = Object.fromEntries(entries)
      setConnected(map)
      setTargets(entries.filter(([, ok]) => ok).map(([k]) => k as Platform))
    })
  }, [])

  const isVideo = Boolean(file && /\.(mp4|mov)$/i.test(file.name))
  const steps = useMemo(() => (isVideo ? ["Media", "Details", "YouTube", "Schedule"] : ["Media", "Details", "Schedule"]), [isVideo])
  const stepName = steps[Math.min(step, steps.length - 1)]
  const youtubeSelected = targets.includes("youtube")

  // Photos can't go to YouTube - drop it from the targets if a photo is picked.
  const effectiveTargets = isVideo ? targets : targets.filter((t) => t !== "youtube")

  const aiContext = {
    brand_name: brand?.brand_name ?? "",
    niche: brand?.niche ?? "",
    tone: brand?.tone ?? "",
    title,
    caption,
    hashtags,
  }

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(f ? URL.createObjectURL(f) : null)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""))
  }

  function pickThumbnail(f: File | null) {
    if (thumbPreview) URL.revokeObjectURL(thumbPreview)
    setThumbFile(f)
    setThumbPreview(f ? URL.createObjectURL(f) : null)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  function toggleTarget(key: Platform) {
    if (!connected[key]) return
    setTargets((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]))
  }

  const canAdvance =
    (stepName !== "Media" || Boolean(file)) && (stepName !== "YouTube" || !youtubeSelected || ytOptions.made_for_kids !== undefined)

  async function submit() {
    if (!file || !scheduledAt) return
    if (effectiveTargets.includes("youtube") && ytOptions.made_for_kids === undefined) {
      setError("Answer the YouTube audience question (made for kids?) before scheduling.")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("title", title)
      formData.append("caption", caption)
      formData.append("hashtags", hashtags)
      formData.append("scheduled_at", scheduledAt)
      formData.append("target_platforms", JSON.stringify(effectiveTargets))
      if (isVideo) {
        const { has_thumbnail: _h, captions_filename: _c, ...editable } = ytOptions
        formData.append("youtube_options", JSON.stringify(editable))
      }
      const post = await api.upload<{ id: number }>("/uploads", formData)

      if (isVideo && thumbFile) {
        const fd = new FormData()
        fd.append("file", thumbFile)
        await api.upload(`/youtube/posts/${post.id}/thumbnail`, fd)
      }
      if (isVideo && capFile) {
        const fd = new FormData()
        fd.append("file", capFile)
        fd.append("language", ytOptions.captions_language ?? "en")
        await api.upload(`/youtube/posts/${post.id}/captions`, fd)
      }

      setJustUploaded(title || file.name)
      setTimeout(() => setJustUploaded(null), 3000)

      // Reset for the next upload, but keep caption/hashtags and YouTube
      // defaults (category, audience, visibility) since batch uploads usually
      // share them.
      pickFile(null)
      pickThumbnail(null)
      setCapFile(null)
      setTitle("")
      setYtOptions(({ category_id, made_for_kids, privacy, playlist_id, default_language, license }) => ({
        category_id,
        made_for_kids,
        privacy,
        playlist_id,
        default_language,
        license,
      }))
      setStep(0)
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadRecent()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="section-upload">
      <PageHeader
        eyebrow="Upload"
        title="Upload & schedule your content"
        description="Upload videos or photos you've already made, set the caption, YouTube details and date, and Reelmind publishes them automatically at that time."
      />

      <div className={"mx-auto transition-all " + (stepName === "YouTube" ? "max-w-5xl" : "max-w-2xl")}>
        <div className="mb-6 flex items-center justify-center gap-2">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={
                  "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold " +
                  (i === step
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : i < step
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-faint)]")
                }
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={"text-xs font-semibold " + (i === step ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]")}>
                {label}
              </span>
              {i < steps.length - 1 && <div className="h-0.5 w-8 bg-[var(--color-border)]" />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={stepName}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            {stepName === "Media" && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="panel-dashed glass-card flex aspect-[3/2] flex-col items-center justify-center overflow-hidden p-0 text-center"
              >
                {previewUrl ? (
                  <div className="relative h-full w-full">
                    {isVideo ? (
                      <video src={previewUrl} controls className="h-full w-full bg-black object-contain" />
                    ) : (
                      <img src={previewUrl} className="h-full w-full object-contain" />
                    )}
                    <button
                      onClick={() => pickFile(null)}
                      className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]"
                  >
                    <UploadCloud className="h-10 w-10" strokeWidth={1.5} />
                    <div>
                      <p className="text-sm font-medium">Click or drag a file here</p>
                      <p className="mt-1 text-xs text-[var(--color-text-faint)]">MP4, MOV, JPG, or PNG · up to 250MB</p>
                    </div>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp4,.mov,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}

            {stepName === "Details" && (
              <div className="glass-card p-6 space-y-5">
                <div>
                  <FieldLabelRow
                    label="Title (internal only)"
                    action={
                      <AiImproveButton field="upload_title" text={title} context={aiContext} onImproved={setTitle} />
                    }
                  />
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning routine reel" />
                </div>
                <div>
                  <FieldLabelRow
                    label="Caption"
                    action={
                      <AiImproveButton field="upload_caption" text={caption} context={aiContext} onImproved={setCaption} />
                    }
                  />
                  <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the caption for this post…" />
                  <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                    Write a rough draft, then hit Optimize to punch it up for reach.
                  </p>
                </div>
                <div>
                  <FieldLabelRow
                    label="Hashtags"
                    action={
                      <AiImproveButton field="upload_hashtags" text={hashtags} context={aiContext} onImproved={setHashtags} />
                    }
                  />
                  <Textarea rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#yourbrand #niche #tips" />
                </div>
              </div>
            )}

            {stepName === "YouTube" && (
              <div className="glass-card p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-4">
                  <div className="flex items-center gap-2.5">
                    <YouTubeBrand className="h-6 w-8" />
                    <div>
                      <h3 className="font-[var(--font-display)] text-lg font-bold leading-tight">YouTube details</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">Everything YouTube Studio asks for - applied when this video is published.</p>
                    </div>
                  </div>
                  <label className={"flex items-center gap-2 text-sm font-semibold " + (connected.youtube ? "cursor-pointer" : "opacity-50")}>
                    <input
                      type="checkbox"
                      checked={youtubeSelected}
                      disabled={!connected.youtube}
                      onChange={() => toggleTarget("youtube")}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    Publish to YouTube
                  </label>
                </div>
                <YouTubeDetailsForm
                  value={ytOptions}
                  onChange={(patch) => setYtOptions((o) => ({ ...o, ...patch }))}
                  fallback={{ title, caption, hashtags }}
                  videoUrl={previewUrl}
                  thumbnailUrl={thumbPreview}
                  onThumbnail={pickThumbnail}
                  captionsName={capFile?.name ?? ""}
                  onCaptions={setCapFile}
                />
              </div>
            )}

            {stepName === "Schedule" && (
              <div className="glass-card p-6 space-y-5">
                <div>
                  <Label>Publish on</Label>
                  <div className="relative">
                    <CalendarIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
                    <Input
                      type="datetime-local"
                      className="pl-10"
                      min={nowLocal()}
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label>Publish to</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {BRAND_PLATFORMS.map((p) => {
                      const isConnected = connected[p.key]
                      const blockedForPhoto = p.key === "youtube" && !isVideo
                      const selected = effectiveTargets.includes(p.key as Platform)
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={!isConnected || blockedForPhoto}
                          onClick={() => toggleTarget(p.key as Platform)}
                          title={!isConnected ? `Connect ${p.label} in Settings first` : blockedForPhoto ? "YouTube only accepts videos" : undefined}
                          className={
                            "flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left text-sm font-semibold transition " +
                            (!isConnected || blockedForPhoto
                              ? "cursor-not-allowed border-[var(--color-border)] opacity-45"
                              : selected
                                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
                                : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]")
                          }
                        >
                          <span className="flex h-6 w-7 items-center justify-center">
                            <p.logo className={p.key === "youtube" ? "h-5 w-7" : "h-6 w-6"} />
                          </span>
                          <span className="flex-1 truncate">{p.label}</span>
                          {selected && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">
                    Greyed-out platforms aren't connected yet - connect them in Settings.
                  </p>
                </div>

                <div className="rounded-md border border-[var(--color-border)] bg-black/[0.03] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Ready to schedule</p>
                  <p className="mt-1 truncate text-sm font-medium">{title || file?.name || "Untitled"}</p>
                  <p className="text-xs text-[var(--color-text-faint)]">{caption ? caption.slice(0, 80) : "No caption yet"}</p>
                  {effectiveTargets.includes("youtube") && (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      YouTube: {ytOptions.title || title || "untitled"} · {ytOptions.privacy ?? "public"}
                      {thumbFile ? " · custom thumbnail" : ""}
                      {capFile ? " · subtitles" : ""}
                    </p>
                  )}
                </div>

                {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

                <Button onClick={submit} disabled={!file || !scheduledAt || uploading || effectiveTargets.length === 0} className="w-full">
                  {uploading ? "Uploading…" : effectiveTargets.length === 0 ? "Pick at least one platform" : "Schedule this post"}
                </Button>

                <AnimatePresence>
                  {justUploaded && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 rounded-md border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-3.5 py-2.5 text-sm text-[var(--color-success)]"
                    >
                      <Check className="h-4 w-4" /> "{justUploaded}" scheduled - add the next one below.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < steps.length - 1 && (
            <Button onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} disabled={!canAdvance}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-12">
        <h2 className="mb-4 font-[var(--font-display)] text-lg font-bold">Your uploads</h2>
        {recent === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="glass-card px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
            Nothing uploaded yet - add your first post above.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recent.map((p) => (
              <Link key={p.id} to={`/posts/${p.id}`} className="w-48 shrink-0">
                <div className="glass-card flex h-full flex-col gap-2 p-3.5 transition-colors hover:border-[var(--color-primary)]">
                  <div className="flex items-center gap-2">
                    {p.media_type === "REELS" ? (
                      <Film className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                    ) : (
                      <ImageIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                    )}
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-[var(--color-text-faint)]">
                    {new Date(p.scheduled_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
