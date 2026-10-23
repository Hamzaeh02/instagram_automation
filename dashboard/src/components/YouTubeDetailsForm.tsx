import { AnimatePresence, motion } from "framer-motion"
import { Sparkles,
  Baby,
  Captions,
  ChevronDown,
  Globe,
  ImagePlus,
  Link2,
  ListVideo,
  Lock,
  Plus,
  ShieldCheck,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { api, ApiError } from "../api/client"
import type { YouTubeOptions, YouTubePrivacy } from "../lib/types"
import { AiImproveButton } from "./AiImproveButton"
import { YouTubeBrand } from "./BrandLogos"
import { Input, Spinner } from "./ui"

const TITLE_MAX = 100
const DESCRIPTION_MAX = 5000
const TAGS_MAX = 500

const LANGUAGES = [
  ["", "Not set"],
  ["en", "English"],
  ["ur", "Urdu"],
  ["hi", "Hindi"],
  ["ar", "Arabic"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["it", "Italian"],
  ["tr", "Turkish"],
  ["id", "Indonesian"],
  ["ru", "Russian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
]

const VISIBILITY: { value: YouTubePrivacy; label: string; hint: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", hint: "Everyone can watch your video", icon: Globe },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the video link can watch", icon: Link2 },
  { value: "private", label: "Private", hint: "Only you can watch", icon: Lock },
]

interface Category {
  id: string
  title: string
}

interface Playlist {
  id: string
  title: string
  privacy: string
  count: number
}

export function tagsLength(tags: string[]) {
  return tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(tags.length - 1, 0)
}

function parseTags(text: string) {
  return text
    .split(",")
    .map((t) => t.replace(/[#<>]/g, "").trim())
    .filter(Boolean)
}

function Section({
  title,
  hint,
  icon: Icon,
  children,
  required,
}: {
  title: string
  hint?: string
  icon?: typeof Globe
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <section className="border-t border-[var(--color-border)] pt-5 first:border-t-0 first:pt-0">
      <h4 className="flex items-center gap-2 text-[15px] font-bold">
        {Icon && <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />}
        {title}
        {required && <span className="text-[var(--color-danger)]">*</span>}
      </h4>
      {hint && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={"text-[11px] tabular-nums " + (value > max ? "font-bold text-[var(--color-danger)]" : "text-[var(--color-text-faint)]")}>
      {value}/{max}
    </span>
  )
}

function Field({ label, counter, action, children }: { label: string; counter?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3.5 pb-2 pt-2.5 transition focus-within:border-[var(--color-primary)] focus-within:ring-2 focus-within:ring-[var(--color-primary)]/15">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">{label}</span>
        {action}
      </div>
      {children}
      {counter && <div className="mt-1 text-right">{counter}</div>}
    </div>
  )
}

export function YouTubeDetailsForm({
  value,
  onChange,
  fallback,
  videoUrl,
  thumbnailUrl,
  onThumbnail,
  onGenerateThumbnail,
  generatingThumbnail,
  captionsName,
  onCaptions,
  assetBusy,
}: {
  value: YouTubeOptions
  onChange: (patch: Partial<YouTubeOptions>) => void
  fallback: { title: string; caption: string; hashtags: string }
  videoUrl?: string | null
  thumbnailUrl: string | null
  onThumbnail: (file: File | null) => void
  onGenerateThumbnail?: () => void
  generatingThumbnail?: boolean
  captionsName: string
  onCaptions: (file: File | null) => void
  assetBusy?: boolean
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [connected, setConnected] = useState<{ connected: boolean; channel_title?: string } | null>(null)
  const [newPlaylist, setNewPlaylist] = useState<string | null>(null)
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [tagDraft, setTagDraft] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const thumbRef = useRef<HTMLInputElement>(null)
  const capRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<{ categories: Category[] }>("/youtube/categories").then((r) => setCategories(r.categories)).catch(() => {})
    api.get<{ connected: boolean; channel_title?: string }>("/youtube/status").then(setConnected).catch(() => {})
    api.get<{ playlists: Playlist[] }>("/youtube/playlists").then((r) => setPlaylists(r.playlists)).catch(() => setPlaylists([]))
  }, [])

  const defaultDescription = [fallback.caption.trim(), fallback.hashtags.trim()].filter(Boolean).join("\n\n")
  const effectiveTitle = value.title || fallback.title || fallback.caption.split("\n")[0] || "Untitled video"
  const effectiveDescription = value.description || defaultDescription
  const tags = value.tags ?? []
  const hashtagsAbove = useMemo(
    () => (effectiveDescription.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 3),
    [effectiveDescription],
  )
  const privacy = value.privacy ?? "public"
  const aiContext = { title: effectiveTitle, caption: fallback.caption, hashtags: fallback.hashtags }

  function addTags(text: string) {
    const next = [...tags]
    for (const t of parseTags(text)) {
      if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t)
    }
    onChange({ tags: next })
    setTagDraft("")
  }

  async function createPlaylist() {
    if (!newPlaylist?.trim()) return
    setCreatingPlaylist(true)
    setError(null)
    try {
      const pl = await api.post<Playlist>("/youtube/playlists", { title: newPlaylist.trim(), privacy: "public" })
      setPlaylists((p) => [pl, ...(p ?? [])])
      onChange({ playlist_id: pl.id })
      setNewPlaylist(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the playlist")
    } finally {
      setCreatingPlaylist(false)
    }
  }

  const selectClass =
    "w-full rounded-lg border border-[var(--color-border-strong)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        {connected && !connected.connected && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3.5 py-2.5 text-xs text-[var(--color-warning)]">
            YouTube isn't connected for this workspace yet - these settings are saved and applied once you connect it in Settings.
          </div>
        )}

        <Section title="Details">
          <div className="space-y-3">
            <Field
              label="Title (required)"
              counter={<Counter value={(value.title ?? "").length} max={TITLE_MAX} />}
              action={
                <AiImproveButton field="youtube_title" text={value.title || effectiveTitle} context={aiContext} onImproved={(t) => onChange({ title: t.slice(0, TITLE_MAX) })} />
              }
            >
              <input
                value={value.title ?? ""}
                onChange={(e) => onChange({ title: e.target.value.replace(/[<>]/g, "") })}
                placeholder={effectiveTitle}
                maxLength={TITLE_MAX}
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-text-faint)]"
              />
            </Field>
            <Field
              label="Description"
              counter={<Counter value={(value.description ?? "").length} max={DESCRIPTION_MAX} />}
              action={
                <AiImproveButton
                  field="youtube_description"
                  text={value.description || defaultDescription || effectiveTitle}
                  context={aiContext}
                  onImproved={(t) => onChange({ description: t.slice(0, DESCRIPTION_MAX) })}
                />
              }
            >
              <textarea
                rows={6}
                value={value.description ?? ""}
                onChange={(e) => onChange({ description: e.target.value.replace(/[<>]/g, "") })}
                placeholder={defaultDescription || "Tell viewers about your video. Add #hashtags - the first three appear above your title."}
                maxLength={DESCRIPTION_MAX}
                className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-[var(--color-text-faint)]"
              />
            </Field>
            {!value.description && defaultDescription && (
              <p className="text-[11px] text-[var(--color-text-faint)]">Left empty, your caption and hashtags are used as the description.</p>
            )}
          </div>
        </Section>

        <Section title="Thumbnail" icon={ImagePlus} hint="Pick an image that shows what's in your video. JPG or PNG, up to 2MB - 1280×720 works best.">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => thumbRef.current?.click()}
              disabled={assetBusy}
              className="flex aspect-video w-44 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--color-border-strong)] text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              {assetBusy ? <Spinner className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
              <span className="text-xs font-semibold">{thumbnailUrl ? "Change thumbnail" : "Upload thumbnail"}</span>
            </button>
            {onGenerateThumbnail && (
              <button
                type="button"
                onClick={onGenerateThumbnail}
                disabled={assetBusy || generatingThumbnail}
                className="flex aspect-video w-44 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--color-primary)]/50 bg-[var(--color-primary)]/[0.04] px-2 text-center text-[var(--color-primary)] transition hover:bg-[var(--color-primary)]/10 disabled:opacity-60"
              >
                {generatingThumbnail ? <Spinner className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                <span className="text-xs font-semibold">
                  {generatingThumbnail ? "Creating… (~40s)" : thumbnailUrl ? "New AI thumbnail" : "Create with AI"}
                </span>
              </button>
            )}
            {thumbnailUrl && (
              <div className="group relative aspect-video w-44 overflow-hidden rounded-lg border-2 border-[var(--color-primary)]">
                <img src={thumbnailUrl} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onThumbnail(null)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  title="Remove thumbnail"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <input
            ref={thumbRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              if (f && f.size > 2 * 1024 * 1024) setError("Thumbnail must be 2MB or smaller")
              else if (f) onThumbnail(f)
              e.target.value = ""
            }}
          />
          <p className="mt-2 text-[11px] text-[var(--color-text-faint)]">
            YouTube only allows custom thumbnails on phone-verified channels (youtube.com/verify).
          </p>
        </Section>

        <Section title="Playlists" icon={ListVideo} hint="Add your video to one of your playlists to help viewers find more of your content.">
          {!connected?.connected ? (
            <p className="text-xs text-[var(--color-text-faint)]">Connect YouTube to choose a playlist.</p>
          ) : playlists === null ? (
            <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
          ) : (
            <div className="space-y-2">
              <select className={selectClass} value={value.playlist_id ?? ""} onChange={(e) => onChange({ playlist_id: e.target.value })}>
                <option value="">None</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · {p.count} videos{p.privacy !== "public" ? ` · ${p.privacy}` : ""}
                  </option>
                ))}
              </select>
              {newPlaylist === null ? (
                <button type="button" onClick={() => setNewPlaylist("")} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline">
                  <Plus className="h-3.5 w-3.5" /> New playlist
                </button>
              ) : (
                <div className="flex gap-2">
                  <Input autoFocus value={newPlaylist} onChange={(e) => setNewPlaylist(e.target.value)} placeholder="Playlist name" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createPlaylist())} />
                  <button type="button" onClick={createPlaylist} disabled={creatingPlaylist} className="btn-primary shrink-0 rounded-md px-3 text-xs font-bold">
                    {creatingPlaylist ? "Creating…" : "Create"}
                  </button>
                  <button type="button" onClick={() => setNewPlaylist(null)} className="shrink-0 rounded-md px-2 text-[var(--color-text-muted)] hover:bg-black/5">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Audience" icon={Baby} required hint="Is this video made for kids? YouTube requires every upload to answer this to comply with COPPA and other children's privacy laws.">
          <div className="space-y-2">
            {[
              { v: true, label: "Yes, it's made for kids" },
              { v: false, label: "No, it's not made for kids" },
            ].map((o) => (
              <label key={String(o.v)} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input type="radio" name="made_for_kids" checked={value.made_for_kids === o.v} onChange={() => onChange({ made_for_kids: o.v })} className="h-4 w-4 accent-[var(--color-primary)]" />
                {o.label}
              </label>
            ))}
            {value.made_for_kids === undefined && <p className="text-[11px] font-semibold text-[var(--color-danger)]">Choose one to continue.</p>}
          </div>
        </Section>

        <Section title="Visibility" icon={ShieldCheck} hint="Choose who can see your video once it's published.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {VISIBILITY.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => onChange({ privacy: v.value })}
                className={
                  "rounded-lg border-2 p-3 text-left transition " +
                  (privacy === v.value ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]")
                }
              >
                <v.icon className={"mb-1.5 h-4 w-4 " + (privacy === v.value ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]")} />
                <div className="text-sm font-bold">{v.label}</div>
                <div className="text-[11px] leading-snug text-[var(--color-text-muted)]">{v.hint}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Tags" icon={Tag} hint="Tags help with misspellings and search. Press Enter or comma to add. Left empty, your hashtags are used.">
          <Field
            label="Tags"
            counter={<Counter value={tagsLength(tags)} max={TAGS_MAX} />}
            action={
              <AiImproveButton
                field="youtube_tags"
                text={tags.join(", ") || fallback.hashtags || effectiveTitle}
                context={aiContext}
                onImproved={(t) => onChange({ tags: parseTags(t) })}
              />
            }
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <AnimatePresence initial={false}>
                {tags.map((t) => (
                  <motion.span
                    key={t}
                    layout
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] py-1 pl-2.5 pr-1.5 text-xs font-medium"
                  >
                    {t}
                    <button type="button" onClick={() => onChange({ tags: tags.filter((x) => x !== t) })} className="rounded-full p-0.5 text-[var(--color-text-faint)] hover:bg-black/10 hover:text-[var(--color-text)]">
                      <X className="h-3 w-3" />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              <input
                value={tagDraft}
                onChange={(e) => {
                  if (e.target.value.includes(",")) addTags(e.target.value)
                  else setTagDraft(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addTags(tagDraft)
                  } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                    onChange({ tags: tags.slice(0, -1) })
                  }
                }}
                onBlur={() => tagDraft && addTags(tagDraft)}
                placeholder={tags.length ? "" : "Add tag"}
                className="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-text-faint)]"
              />
            </div>
          </Field>
        </Section>

        <Section title="Category" hint="Add your video to a category so viewers can find it more easily.">
          <select className={selectClass} value={value.category_id ?? "22"} onChange={(e) => onChange({ category_id: e.target.value })}>
            {(categories.length ? categories : [{ id: "22", title: "People & Blogs" }]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Subtitles" icon={Captions} hint="Reach a broader audience with subtitles. Upload an .srt, .vtt or .sbv file.">
          <div className="flex flex-wrap items-center gap-2">
            {captionsName ? (
              <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm">
                <Captions className="h-4 w-4 text-[var(--color-primary)]" />
                {captionsName}
                <button type="button" onClick={() => onCaptions(null)} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]" title="Remove subtitles">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => capRef.current?.click()} disabled={assetBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-sm font-semibold transition hover:bg-black/5">
                <Plus className="h-4 w-4" /> Upload subtitle file
              </button>
            )}
            <select className={selectClass + " !w-auto"} value={value.captions_language ?? "en"} onChange={(e) => onChange({ captions_language: e.target.value })}>
              {LANGUAGES.filter(([code]) => code).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={capRef}
            type="file"
            accept=".srt,.vtt,.sbv"
            className="hidden"
            onChange={(e) => {
              onCaptions(e.target.files?.[0] ?? null)
              e.target.value = ""
            }}
          />
        </Section>

        <div className="border-t border-[var(--color-border)] pt-4">
          <button type="button" onClick={() => setShowMore((s) => !s)} className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {showMore ? "Show less" : "Show more"}
            <ChevronDown className={"h-4 w-4 transition " + (showMore ? "rotate-180" : "")} />
          </button>
          <AnimatePresence initial={false}>
            {showMore && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--color-text-muted)]">Video language</div>
                    <select className={selectClass} value={value.default_language ?? ""} onChange={(e) => onChange({ default_language: e.target.value })}>
                      {LANGUAGES.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-[var(--color-text-muted)]">License</div>
                    <select className={selectClass} value={value.license ?? "youtube"} onChange={(e) => onChange({ license: e.target.value as YouTubeOptions["license"] })}>
                      <option value="youtube">Standard YouTube License</option>
                      <option value="creativeCommon">Creative Commons - Attribution</option>
                    </select>
                  </div>
                  {[
                    { key: "notify_subscribers" as const, label: "Publish to subscriptions feed and notify subscribers" },
                    { key: "embeddable" as const, label: "Allow embedding on other websites" },
                  ].map((o) => (
                    <label key={o.key} className="flex cursor-pointer items-start gap-2.5 text-sm sm:col-span-2">
                      <input type="checkbox" checked={value[o.key] ?? true} onChange={(e) => onChange({ [o.key]: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]" />
                      {o.label}
                    </label>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      </div>

      {/* Live preview, like YouTube Studio's right-hand card */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-white shadow-sm">
          <div className="relative aspect-video bg-neutral-900">
            {thumbnailUrl ? (
              <img src={thumbnailUrl} className="h-full w-full object-cover" />
            ) : videoUrl ? (
              <video src={videoUrl} muted controls className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <YouTubeBrand className="h-8 w-11 opacity-80" />
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div>
              {hashtagsAbove.length > 0 && <div className="mb-0.5 truncate text-xs font-medium text-[#065fd4]">{hashtagsAbove.join(" ")}</div>}
              <div className="line-clamp-2 text-[15px] font-bold leading-snug">{effectiveTitle}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <YouTubeBrand className="h-3 w-4" />
                {connected?.channel_title || "Your channel"}
              </div>
            </div>
            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-xs">
              <Row label="Visibility" value={VISIBILITY.find((v) => v.value === privacy)?.label ?? "Public"} />
              <Row label="Audience" value={value.made_for_kids === undefined ? "Not set" : value.made_for_kids ? "Made for kids" : "Not made for kids"} />
              <Row label="Category" value={categories.find((c) => c.id === (value.category_id ?? "22"))?.title ?? "People & Blogs"} />
              <Row label="Playlist" value={playlists?.find((p) => p.id === value.playlist_id)?.title ?? "None"} />
              <Row label="Tags" value={tags.length ? `${tags.length} added` : "From hashtags"} />
              <Row label="Subtitles" value={captionsName ? "Added" : "None"} />
            </div>
            <p className="rounded-md bg-black/[0.04] px-2.5 py-2 text-[11px] text-[var(--color-text-muted)]">Video link appears here after Reelmind publishes it.</p>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-text-faint)]">{label}</span>
      <span className="truncate text-right font-semibold">{value}</span>
    </div>
  )
}
