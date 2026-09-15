import { AnimatePresence, motion } from "framer-motion"
import { Calendar as CalendarIcon, Check, Film, Image as ImageIcon, UploadCloud, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api, ApiError } from "../api/client"
import { Button, Card, FadeIn, FieldLabelRow, Input, Label, PageHeader, Textarea } from "../components/ui"
import { AiImproveButton } from "../components/AiImproveButton"
import { StatusBadge } from "../components/StatusBadge"
import type { BrandProfile, PostStatus } from "../lib/types"

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

  async function loadRecent() {
    const res = await api.get<{ posts: UploadedPost[] }>("/uploads?limit=50")
    setRecent(res.posts)
  }

  useEffect(() => {
    loadRecent()
    api.get<{ brand: BrandProfile | null }>("/brand").then((r) => setBrand(r.brand))
  }, [])

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

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  const isVideo = file && /\.(mp4|mov)$/i.test(file.name)

  async function submit() {
    if (!file || !scheduledAt) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("title", title)
      formData.append("caption", caption)
      formData.append("hashtags", hashtags)
      formData.append("scheduled_at", scheduledAt)
      await api.upload("/uploads", formData)

      setJustUploaded(title || file.name)
      setTimeout(() => setJustUploaded(null), 3000)

      // Reset for the next upload, but keep caption/hashtags since batch
      // uploads (e.g. a month of Reels) often reuse similar copy/style.
      pickFile(null)
      setTitle("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadRecent()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Upload"
        title="Upload & schedule your content"
        description="Upload videos or photos you've already made, set the caption and date, and Reelmind publishes them automatically at that time."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <FadeIn className="lg:col-span-2">
          <Card
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex aspect-[9/16] flex-col items-center justify-center overflow-hidden p-0 text-center"
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
          </Card>
        </FadeIn>

        <FadeIn delay={0.05} className="space-y-5 lg:col-span-3">
          <Card className="space-y-5">
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
                  <AiImproveButton
                    field="upload_caption"
                    text={caption}
                    context={aiContext}
                    onImproved={setCaption}
                  />
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
                  <AiImproveButton
                    field="upload_hashtags"
                    text={hashtags}
                    context={aiContext}
                    onImproved={setHashtags}
                  />
                }
              />
              <Textarea rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#yourbrand #niche #tips" />
            </div>
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

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Button onClick={submit} disabled={!file || !scheduledAt || uploading} className="w-full">
              {uploading ? "Uploading…" : "Schedule this post"}
            </Button>

            <AnimatePresence>
              {justUploaded && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300"
                >
                  <Check className="h-4 w-4" /> "{justUploaded}" scheduled — add the next one below.
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </FadeIn>
      </div>

      <div className="mt-10">
        <h2 className="mb-4 font-[var(--font-display)] text-lg font-bold">Your uploads</h2>
        {recent === null ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : recent.length === 0 ? (
          <Card className="py-10 text-center text-sm text-[var(--color-text-muted)]">
            Nothing uploaded yet — add your first post above.
          </Card>
        ) : (
          <div className="space-y-2">
            {recent.map((p) => (
              <Card key={p.id} className="flex items-center gap-4 py-3.5">
                {p.media_type === "REELS" ? (
                  <Film className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-[var(--color-text-faint)]">
                    {new Date(p.scheduled_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
