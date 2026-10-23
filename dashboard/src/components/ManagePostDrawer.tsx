import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowUpRight,
  Check,
  CornerDownRight,
  Eye,
  Heart,
  MessageCircle,
  MessageSquareOff,
  Pencil,
  Repeat2,
  Send,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { BoostButton } from "./BoostButton"
import { BRAND_PLATFORMS } from "./BrandLogos"
import { Spinner } from "./ui"

export interface ManageTarget {
  platform: string
  id: string
  caption: string
  thumbnail: string
  permalink: string
  published_at: string | null
  metrics?: { key: string; label: string; value: number }[]
}

interface Comment {
  id: string
  author: string
  text: string
  created_at: string | null
  like_count: number
  liked?: boolean
  hidden: boolean
  is_own: boolean
  replies: Comment[]
}

type Caps = Record<string, boolean>

function ago(iso: string | null) {
  if (!iso) return ""
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

const AVATAR_COLORS = ["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e", "#c1432c", "#3f6fa0"]
function Avatar({ name }: { name: string }) {
  const clean = name.replace(/^@/, "")
  const color = AVATAR_COLORS[[...clean].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: color }}>
      {(clean[0] ?? "?").toUpperCase()}
    </span>
  )
}

function CommentItem({
  c,
  caps,
  platform,
  depth,
  onAction,
}: {
  c: Comment
  caps: Caps
  platform: string
  depth: number
  onAction: (fn: () => Promise<unknown>, success: string) => Promise<boolean>
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const base = `/engage/${platform}/comments/${encodeURIComponent(c.id)}`

  return (
    <div className={depth ? "ml-11 mt-3" : ""}>
      <div className={"group flex gap-3 " + (c.hidden ? "opacity-55" : "")}>
        <Avatar name={c.author} />
        <div className="min-w-0 flex-1">
          <div className="rounded-2xl bg-black/[0.04] px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold">{c.author}</span>
              {c.is_own && <span className="rounded bg-[var(--color-primary)]/12 px-1.5 py-px text-[10px] font-bold text-[var(--color-primary)]">You</span>}
              {c.hidden && <span className="rounded bg-black/10 px-1.5 py-px text-[10px] font-bold">Hidden</span>}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.text}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 px-2 text-[11px] font-semibold text-[var(--color-text-faint)]">
            <span>{ago(c.created_at)}</span>
            {c.like_count > 0 && (
              <span className="flex items-center gap-0.5">
                <Heart className="h-3 w-3" /> {c.like_count}
              </span>
            )}
            {platform === "facebook" && (
              <button
                className={"hover:text-[var(--color-text)] " + (c.liked ? "text-[#1877f2]" : "")}
                onClick={() => onAction(() => api.post(`${base}/like`, { value: !c.liked }), c.liked ? "Like removed" : "Liked as your Page")}
              >
                {c.liked ? "Liked" : "Like"}
              </button>
            )}
            {caps.reply && depth === 0 && (
              <button className="hover:text-[var(--color-text)]" onClick={() => setReplying((r) => !r)}>
                Reply
              </button>
            )}
            {caps.hide && !c.is_own && (
              <button
                className="hover:text-[var(--color-text)]"
                onClick={() => onAction(() => api.post(`${base}/hidden`, { value: !c.hidden }), c.hidden ? "Comment is visible again" : "Comment hidden")}
              >
                {c.hidden ? "Unhide" : "Hide"}
              </button>
            )}
            {caps.delete_comment && (platform !== "x" || c.is_own) &&
              (confirmDelete ? (
                <span className="flex items-center gap-2">
                  <button
                    className="text-[var(--color-danger)]"
                    onClick={() => onAction(() => api.delete(`${base}?own=${c.is_own}`), "Comment deleted")}
                  >
                    Confirm delete
                  </button>
                  <button className="hover:text-[var(--color-text)]" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="hover:text-[var(--color-danger)]" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              ))}
          </div>

          <AnimatePresence initial={false}>
            {replying && (
              <motion.form
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!reply.trim()) return
                  const ok = await onAction(() => api.post(`${base}/replies`, { text: reply.trim() }), "Reply posted")
                  if (ok) {
                    setReply("")
                    setReplying(false)
                  }
                }}
              >
                <div className="mt-2 flex items-end gap-2">
                  <CornerDownRight className="mb-2.5 h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                  <textarea
                    autoFocus
                    rows={1}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={`Reply to ${c.author}…`}
                    className="min-h-[38px] flex-1 resize-none rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                  />
                  <button type="submit" disabled={!reply.trim()} className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-white disabled:opacity-40">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
      {c.replies.map((r) => (
        <CommentItem key={r.id} c={r} caps={caps} platform={platform} depth={depth + 1} onAction={onAction} />
      ))}
    </div>
  )
}

export function ManagePostDrawer({
  target,
  onClose,
  onDeleted,
  onCaptionChanged,
}: {
  target: ManageTarget | null
  onClose: () => void
  onDeleted: (platform: string, id: string) => void
  onCaptionChanged: (platform: string, id: string, caption: string) => void
}) {
  const [caps, setCaps] = useState<Record<string, Caps>>({})
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  const [composer, setComposer] = useState("")
  const [posting, setPosting] = useState(false)
  const [liked, setLiked] = useState(false)
  const [reposted, setReposted] = useState(false)
  const [commentsOff, setCommentsOff] = useState(false)
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState("")
  const [confirmDeletePost, setConfirmDeletePost] = useState(false)
  const [busy, setBusy] = useState(false)

  const platform = target?.platform ?? ""
  const pc: Caps = caps[platform] ?? {}
  const brand = BRAND_PLATFORMS.find((b) => b.key === platform)
  const postBase = target ? `/engage/${platform}/posts/${encodeURIComponent(target.id)}` : ""

  useEffect(() => {
    api.get<Record<string, Caps>>("/engage/capabilities").then(setCaps).catch(() => {})
  }, [])

  const loadComments = useCallback(async () => {
    if (!target) return
    setLoadError(null)
    try {
      const res = await api.get<{ comments: Comment[] }>(`${postBase}/comments`)
      setComments(res.comments)
    } catch (err) {
      setComments([])
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load comments")
    }
  }, [target, postBase])

  useEffect(() => {
    if (!target) return
    setComments(null)
    setLiked(false)
    setReposted(false)
    setCommentsOff(false)
    setEditing(false)
    setConfirmDeletePost(false)
    setCaption(target.caption)
    setComposer("")
    loadComments()
  }, [target, loadComments])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [target, onClose])

  const flash = (tone: "ok" | "err", text: string) => {
    setToast({ tone, text })
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500)
  }

  // Runs one platform action, shows the outcome, and reloads comments so the
  // thread always reflects what's really on the platform.
  const run = useCallback(
    async (fn: () => Promise<unknown>, success: string, reload = true) => {
      setBusy(true)
      try {
        await fn()
        flash("ok", success)
        if (reload) await loadComments()
        return true
      } catch (err) {
        flash("err", err instanceof ApiError ? err.message : "That didn't work - try again.")
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadComments],
  )

  const totalComments = comments ? comments.reduce((n, c) => n + 1 + c.replies.length, 0) : 0
  const metric = (k: string) => target?.metrics?.find((m) => m.key === k)?.value

  return createPortal(
    <AnimatePresence>
      {target && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-[2px]"
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-y-0 right-0 z-[56] flex w-full max-w-[520px] flex-col bg-[var(--color-bg)] shadow-2xl"
          >
            {/* header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-5 py-4">
              <div className="flex items-center gap-2.5">
                {brand && <brand.logo className={platform === "youtube" ? "h-5 w-7" : "h-6 w-6"} />}
                <div>
                  <div className="font-[var(--font-display)] text-base font-bold leading-tight">Manage post</div>
                  <div className="text-[11px] text-[var(--color-text-faint)]">
                    {brand?.label} · {target.published_at ? new Date(target.published_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-[var(--color-text-muted)] hover:bg-black/5" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* post */}
              <div className="space-y-4 border-b border-[var(--color-border)] bg-white px-5 py-4">
                <div className="flex gap-3">
                  {target.thumbnail ? (
                    <img src={target.thumbnail} className="h-24 w-24 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="h-24 w-24 shrink-0 rounded-xl bg-black/[0.06]" />
                  )}
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          rows={4}
                          className="w-full resize-y rounded-xl border border-[var(--color-border-strong)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={async () => {
                              const ok = await run(() => api.patch(postBase, { caption }), "Caption updated", false)
                              if (ok) {
                                onCaptionChanged(platform, target.id, caption)
                                setEditing(false)
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-bold text-white"
                          >
                            <Check className="h-3.5 w-3.5" /> Save
                          </button>
                          <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-black/5">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="line-clamp-4 whitespace-pre-wrap text-sm">{caption || <span className="text-[var(--color-text-faint)]">No caption</span>}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-[var(--color-text-muted)]">
                      {metric("views") !== undefined && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{metric("views")!.toLocaleString()}</span>}
                      {(metric("likes") ?? metric("reactions")) !== undefined && <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{(metric("likes") ?? metric("reactions"))!.toLocaleString()}</span>}
                      {(metric("comments") ?? metric("replies")) !== undefined && <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{(metric("comments") ?? metric("replies"))!.toLocaleString()}</span>}
                    </div>
                  </div>
                </div>

                {/* actions */}
                <div className="flex flex-wrap gap-2">
                  {pc.like && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => api.post(`${postBase}/like`, { value: !liked }), liked ? "Like removed" : "Liked", false)) setLiked(!liked)
                      }}
                      className={"inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition " + (liked ? "border-[#1877f2] bg-[#1877f2]/10 text-[#1877f2]" : "border-[var(--color-border-strong)] bg-white hover:bg-black/5")}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" /> {liked ? "Liked" : platform === "facebook" ? "Like as Page" : "Like"}
                    </button>
                  )}
                  {pc.repost && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => api.post(`${postBase}/repost`, { value: !reposted }), reposted ? "Repost undone" : "Reposted", false)) setReposted(!reposted)
                      }}
                      className={"inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition " + (reposted ? "border-[#00ba7c] bg-[#00ba7c]/10 text-[#00ba7c]" : "border-[var(--color-border-strong)] bg-white hover:bg-black/5")}
                    >
                      <Repeat2 className="h-3.5 w-3.5" /> {reposted ? "Reposted" : "Repost"}
                    </button>
                  )}
                  {pc.edit && !editing && (
                    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-xs font-bold hover:bg-black/5">
                      <Pencil className="h-3.5 w-3.5" /> Edit caption
                    </button>
                  )}
                  {pc.toggle_comments && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => api.patch(postBase, { comments_enabled: commentsOff }), commentsOff ? "Comments turned on" : "Comments turned off", false)) setCommentsOff(!commentsOff)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-xs font-bold hover:bg-black/5"
                    >
                      <MessageSquareOff className="h-3.5 w-3.5" /> {commentsOff ? "Turn comments on" : "Turn comments off"}
                    </button>
                  )}
                  <BoostButton platform={platform} permalink={target.permalink} caption={caption} thumbnail={target.thumbnail} />
                  {target.permalink && (
                    <a href={target.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-xs font-bold hover:bg-black/5">
                      Open <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {pc.delete_post &&
                    (confirmDeletePost ? (
                      <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-danger)]/10 px-3 py-1.5 text-xs font-bold text-[var(--color-danger)]">
                        Delete from {brand?.label}?
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (await run(() => api.delete(postBase), "Post deleted", false)) {
                              onDeleted(platform, target.id)
                              onClose()
                            }
                          }}
                          className="rounded bg-[var(--color-danger)] px-2 py-1 text-white"
                        >
                          Delete
                        </button>
                        <button onClick={() => setConfirmDeletePost(false)} className="px-1">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeletePost(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-danger)]/30 bg-white px-3 py-2 text-xs font-bold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5">
                        <Trash2 className="h-3.5 w-3.5" /> Delete post
                      </button>
                    ))}
                </div>
                {platform === "instagram" && (
                  <p className="text-[11px] text-[var(--color-text-faint)]">Instagram doesn't let apps like, repost, edit or delete posts - do those in the Instagram app.</p>
                )}
              </div>

              {/* comments */}
              <div className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold">
                    Comments {comments && comments.length > 0 && <span className="text-[var(--color-text-faint)]">· {totalComments}</span>}
                  </h4>
                  <button onClick={loadComments} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
                    Refresh
                  </button>
                </div>
                {comments === null ? (
                  <div className="flex justify-center py-10">
                    <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
                  </div>
                ) : loadError ? (
                  <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-3 text-sm text-[var(--color-warning)]">
                    {loadError}
                    {loadError.toLowerCase().includes("reconnect") && (
                      <Link to="/settings" className="ml-1 font-bold underline">
                        Go to Settings
                      </Link>
                    )}
                  </div>
                ) : comments.length === 0 && (metric("comments") ?? metric("replies") ?? 0) > 0 ? (
                  // The post has comments but the platform returned none: the
                  // connection predates the comment permission. Meta returns an
                  // empty list instead of an error in that case.
                  <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-4 text-sm">
                    <p className="font-semibold text-[var(--color-text)]">
                      This post has {(metric("comments") ?? metric("replies"))!.toLocaleString()} comments, but {brand?.label} is withholding them from Reelmind.
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                      While your Meta app is in <b>Development mode</b>, Meta only shares comments written by accounts that have a role on the app - not your followers'.
                      To see everyone's comments, request <b>Advanced Access</b> for <code className="rounded bg-black/5 px-1">instagram_business_manage_comments</code> in
                      Meta App Review and switch the app to <b>Live</b>.
                    </p>
                    <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                      Never reconnected since comment access was added? Reconnect once first.
                    </p>
                    <a
                      href={`/api/${platform}/connect`}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-xs font-bold hover:bg-black/5"
                    >
                      Reconnect {brand?.label}
                    </a>
                  </div>
                ) : comments.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <MessageCircle className="h-7 w-7 text-[var(--color-text-faint)]" />
                    <p className="text-sm font-semibold">No comments yet</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Start the conversation below.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {comments.map((c) => (
                      <CommentItem key={c.id} c={c} caps={pc} platform={platform} depth={0} onAction={run} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* composer */}
            {pc.comment && (
              <form
                className="flex items-end gap-2 border-t border-[var(--color-border)] bg-white px-5 py-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!composer.trim()) return
                  setPosting(true)
                  const ok = await run(() => api.post(`${postBase}/comments`, { text: composer.trim() }), "Comment posted")
                  setPosting(false)
                  if (ok) setComposer("")
                }}
              >
                <textarea
                  rows={1}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder={platform === "x" ? "Reply to this post…" : "Add a comment…"}
                  className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--color-border-strong)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
                <button type="submit" disabled={!composer.trim() || posting} className="flex h-[42px] items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-bold text-white disabled:opacity-40">
                  {posting ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Post
                </button>
              </form>
            )}

            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={
                    "pointer-events-none absolute inset-x-5 bottom-20 rounded-xl px-4 py-2.5 text-center text-sm font-semibold shadow-lg " +
                    (toast.tone === "ok" ? "bg-[#211f1a] text-white" : "bg-[var(--color-danger)] text-white")
                  }
                >
                  {toast.text}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
