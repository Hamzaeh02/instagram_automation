import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, ArrowLeft, ArrowUpRight, Clock, Info, MessageCircle, RefreshCw, Search, Send } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { BRAND_PLATFORMS } from "../components/BrandLogos"
import { PageHeader, Spinner } from "../components/ui"

interface Participant {
  id: string | null
  name: string
  username: string
}

interface Conversation {
  platform: string
  id: string
  participant: Participant
  last_message: { text: string; from_me: boolean; created_at: string | null }
  updated_at: string | null
  unread: number
  can_reply: boolean
  reply_until: string | null
}

interface Message {
  id: string
  text: string
  from_me: boolean
  created_at: string | null
  is_attachment: boolean
  status?: "sending" | "sent" | "failed"
}

interface Thread {
  participant: Participant
  messages: Message[]
  can_reply: boolean
  reply_until: string | null
}

const NATIVE_INBOX: Record<string, string> = {
  instagram: "https://www.instagram.com/direct/inbox/",
  facebook: "https://business.facebook.com/latest/inbox",
  x: "https://x.com/messages",
}

const AVATAR_COLORS = ["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e", "#c1432c", "#3f6fa0"]

function Avatar({ name, platform, size = 40 }: { name: string; platform: string; size?: number }) {
  const color = AVATAR_COLORS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]
  const brand = BRAND_PLATFORMS.find((b) => b.key === platform)
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span className="flex h-full w-full items-center justify-center rounded-full font-bold text-white" style={{ background: color, fontSize: size * 0.38 }}>
        {(name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
      </span>
      {brand && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-white">
          <brand.logo className={platform === "youtube" ? "h-2 w-3" : "h-3 w-3"} />
        </span>
      )}
    </span>
  )
}

function ago(iso: string | null) {
  if (!iso) return ""
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function windowNote(until: string | null) {
  if (!until) return null
  const hours = (new Date(until).getTime() - Date.now()) / 3600000
  if (hours <= 0) return null
  return hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min left to reply` : `${Math.floor(hours)}h left to reply`
}

const keyOf = (c: { platform: string; id: string }) => `${c.platform}:${c.id}`

export function Messages() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [platforms, setPlatforms] = useState<Record<string, { ok: boolean; count: number; note?: string }>>({})
  const [listError, setListError] = useState<string | null>(null)
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectedKey = selected ? keyOf(selected) : null

  const loadList = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await api.get<{ conversations: Conversation[]; platforms: typeof platforms }>("/messages/conversations")
      setConversations(res.conversations)
      setPlatforms(res.platforms)
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't load messages")
      setConversations((c) => c ?? [])
    } finally {
      setRefreshing(false)
    }
  }, [])

  const loadThread = useCallback(async (conv: Conversation, quiet = false) => {
    if (!quiet) {
      setThread(null)
      setThreadError(null)
    }
    try {
      const res = await api.get<Thread>(`/messages/${conv.platform}/${encodeURIComponent(conv.id)}`)
      setThread((cur) => {
        // Keep optimistic bubbles that haven't come back from the platform yet.
        const pending = (cur?.messages ?? []).filter((m) => m.status)
        return { ...res, messages: [...res.messages, ...pending.filter((p) => !res.messages.some((m) => m.from_me && m.text === p.text))] }
      })
      setThreadError(null)
    } catch (err) {
      if (!quiet) setThreadError(err instanceof ApiError ? err.message : "Couldn't load this conversation")
    }
  }, [])

  useEffect(() => {
    loadList()
    const t = setInterval(loadList, 30000)
    return () => clearInterval(t)
  }, [loadList])

  useEffect(() => {
    if (!selected) return
    loadThread(selected)
    const t = setInterval(() => loadThread(selected, true), 12000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [thread?.messages.length])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (conversations ?? []).filter(
      (c) =>
        (filter === "all" || c.platform === filter) &&
        (!q || c.participant.name.toLowerCase().includes(q) || c.participant.username.toLowerCase().includes(q) || c.last_message.text.toLowerCase().includes(q)),
    )
  }, [conversations, filter, query])

  async function send() {
    if (!selected || !thread || !draft.trim()) return
    const text = draft.trim()
    const temp: Message = { id: `tmp-${Date.now()}`, text, from_me: true, created_at: new Date().toISOString(), is_attachment: false, status: "sending" }
    setDraft("")
    setThread((t) => (t ? { ...t, messages: [...t.messages, temp] } : t))
    try {
      await api.post(`/messages/${selected.platform}/${encodeURIComponent(selected.id)}`, {
        text,
        recipient_id: thread.participant.id ?? selected.participant.id,
      })
      // Stays as a local "sent" bubble until the platform's own copy shows up
      // in a refresh - platforms can take a few seconds to return it.
      setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === temp.id ? { ...m, status: "sent" } : m)) } : t))
      setConversations((cs) =>
        cs?.map((c) => (keyOf(c) === keyOf(selected) ? { ...c, last_message: { text, from_me: true, created_at: temp.created_at }, updated_at: temp.created_at } : c)) ?? cs,
      )
      loadThread(selected, true)
    } catch (err) {
      setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === temp.id ? { ...m, status: "failed" } : m)) } : t))
      setThreadError(err instanceof ApiError ? err.message : "Message not sent")
    }
  }

  const notes = Object.entries(platforms).filter(([, s]) => s.note)
  const counts = Object.entries(platforms).filter(([, s]) => s.ok)
  const canReply = thread?.can_reply ?? selected?.can_reply ?? false
  const brand = selected ? BRAND_PLATFORMS.find((b) => b.key === selected.platform) : undefined

  return (
    <div>
      <PageHeader eyebrow="Inbox" title="Messages" description="Direct messages from every connected account, in one inbox. Reply without leaving Reelmind." />

      <div className="glass-card flex h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden p-0">
        {/* conversation list */}
        <div className={"flex w-full flex-col border-r border-[var(--color-border)] md:w-[340px] md:shrink-0 " + (selected ? "hidden md:flex" : "flex")}>
          <div className="space-y-3 border-b border-[var(--color-border)] p-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search messages"
                  className="w-full rounded-lg border border-[var(--color-border-strong)] bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <button onClick={loadList} disabled={refreshing} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border-strong)] bg-white hover:bg-black/5" aria-label="Refresh">
                <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[{ key: "all", label: "All", count: conversations?.length ?? 0 }, ...counts.map(([k, s]) => ({ key: k, label: BRAND_PLATFORMS.find((b) => b.key === k)?.label ?? k, count: s.count }))].map((p) => {
                const b = BRAND_PLATFORMS.find((x) => x.key === p.key)
                return (
                  <button
                    key={p.key}
                    onClick={() => setFilter(p.key)}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition " +
                      (filter === p.key ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-[var(--color-border)] bg-white hover:border-[var(--color-border-strong)]")
                    }
                  >
                    {b && <b.logo className="h-3 w-3" />} {p.label} <span className="text-[var(--color-text-faint)]">{p.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {notes.length > 0 && (
            <div className="space-y-1.5 border-b border-[var(--color-border)] p-3">
              {notes.map(([k, s]) => {
                const b = BRAND_PLATFORMS.find((x) => x.key === k)
                return (
                  <div key={k} className="flex items-start gap-2 rounded-lg bg-[var(--color-warning)]/8 px-2.5 py-2 text-[11px] text-[var(--color-warning)]">
                    {b ? <b.logo className="mt-px h-3.5 w-3.5 shrink-0" /> : <Info className="h-3.5 w-3.5 shrink-0" />}
                    <span>
                      {s.note}{" "}
                      {s.note?.includes("Reconnect") && (
                        <Link to="/settings" className="font-bold underline">
                          Settings
                        </Link>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {conversations === null ? (
              <div className="flex justify-center py-16">
                <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
              </div>
            ) : listError ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{listError}</p>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <MessageCircle className="h-8 w-8 text-[var(--color-text-faint)]" />
                <p className="text-sm font-semibold">{conversations.length ? "No matches" : "No conversations yet"}</p>
                {!conversations.length && (
                  <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                    New DMs show up here. If you already have messages on Instagram, reconnect Instagram in{" "}
                    <Link to="/settings" className="font-bold text-[var(--color-primary)] underline">
                      Settings
                    </Link>{" "}
                    so Reelmind gets message access.
                  </p>
                )}
              </div>
            ) : (
              visible.map((c) => {
                const active = selectedKey === keyOf(c)
                return (
                  <button
                    key={keyOf(c)}
                    onClick={() => {
                      setSelected(c)
                      setConversations((cs) => cs?.map((x) => (keyOf(x) === keyOf(c) ? { ...x, unread: 0 } : x)) ?? cs)
                    }}
                    className={"flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-3 text-left transition " + (active ? "bg-[var(--color-primary)]/8" : "hover:bg-black/[0.025]")}
                  >
                    <Avatar name={c.participant.name || c.participant.username} platform={c.platform} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={"truncate text-sm " + (c.unread ? "font-bold" : "font-semibold")}>{c.participant.name || `@${c.participant.username}`}</span>
                        <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">{ago(c.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={"truncate text-xs " + (c.unread ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]")}>
                          {c.last_message.from_me && "You: "}
                          {c.last_message.text || "…"}
                        </span>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-bold text-white">{c.unread}</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* thread */}
        <div className={"min-w-0 flex-1 flex-col bg-[var(--color-bg)] " + (selected ? "flex" : "hidden md:flex")}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10">
                <MessageCircle className="h-7 w-7 text-[var(--color-primary)]" />
              </div>
              <p className="font-semibold">Select a conversation</p>
              <p className="text-sm text-[var(--color-text-muted)]">Messages from Instagram, Facebook and X appear on the left.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button onClick={() => setSelected(null)} className="rounded-full p-1.5 hover:bg-black/5 md:hidden" aria-label="Back">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <Avatar name={selected.participant.name || selected.participant.username} platform={selected.platform} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{selected.participant.name || `@${selected.participant.username}`}</div>
                    <div className="truncate text-[11px] text-[var(--color-text-faint)]">
                      {selected.participant.username ? `@${selected.participant.username} · ` : ""}
                      {brand?.label}
                    </div>
                  </div>
                </div>
                <a
                  href={NATIVE_INBOX[selected.platform]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border-strong)] bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-black/5"
                >
                  Open in {brand?.label} <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {!thread && !threadError ? (
                  <div className="flex justify-center py-16">
                    <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
                  </div>
                ) : threadError && !thread ? (
                  <p className="py-10 text-center text-sm text-[var(--color-danger)]">{threadError}</p>
                ) : (
                  <div className="space-y-1.5">
                    {thread!.messages.map((m, i) => {
                      const prev = thread!.messages[i - 1]
                      const newDay = m.created_at && (!prev?.created_at || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString())
                      const grouped = prev && prev.from_me === m.from_me && !newDay
                      return (
                        <div key={m.id}>
                          {newDay && (
                            <div className="my-4 flex items-center gap-3 text-[11px] font-semibold text-[var(--color-text-faint)]">
                              <span className="h-px flex-1 bg-[var(--color-border)]" />
                              {dayLabel(m.created_at!)}
                              <span className="h-px flex-1 bg-[var(--color-border)]" />
                            </div>
                          )}
                          <motion.div
                            initial={m.status === "sending" ? { opacity: 0, y: 6 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            className={"flex " + (m.from_me ? "justify-end" : "justify-start") + (grouped ? "" : " mt-3")}
                          >
                            <div className="max-w-[75%]">
                              <div
                                className={
                                  "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm " +
                                  (m.from_me
                                    ? "rounded-br-md bg-[var(--color-primary)] text-white"
                                    : "rounded-bl-md border border-[var(--color-border)] bg-white") +
                                  (m.is_attachment ? " italic opacity-80" : "") +
                                  (m.status === "failed" ? " !bg-[var(--color-danger)]/80" : "")
                                }
                              >
                                {m.text}
                              </div>
                              <div className={"mt-0.5 px-1 text-[10px] text-[var(--color-text-faint)] " + (m.from_me ? "text-right" : "")}>
                                {m.status === "sending"
                                  ? "Sending…"
                                  : m.status === "sent"
                                    ? "Sent"
                                  : m.status === "failed"
                                    ? "Not sent"
                                    : m.created_at
                                      ? new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                                      : ""}
                              </div>
                            </div>
                          </motion.div>
                        </div>
                      )
                    })}
                    {thread!.messages.length === 0 && <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">No messages in this conversation yet.</p>}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              <AnimatePresence>
                {threadError && thread && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 border-t border-[var(--color-danger)]/20 bg-[var(--color-danger)]/8 px-4 py-2 text-xs text-[var(--color-danger)]">
                    <AlertCircle className="h-3.5 w-3.5" /> {threadError}
                  </motion.div>
                )}
              </AnimatePresence>

              {canReply ? (
                <form
                  className="border-t border-[var(--color-border)] bg-white px-4 py-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    send()
                  }}
                >
                  {windowNote(thread?.reply_until ?? selected.reply_until) && (
                    <div className="mb-2 flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">
                      <Clock className="h-3 w-3" /> {windowNote(thread?.reply_until ?? selected.reply_until)}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={1}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          send()
                        }
                      }}
                      placeholder={`Message ${selected.participant.name || "…"}`}
                      maxLength={1000}
                      className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--color-border-strong)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
                    />
                    <button type="submit" disabled={!draft.trim() || !thread} className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[var(--color-primary)] text-white disabled:opacity-40" aria-label="Send">
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-white px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  <Clock className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                  {brand?.label} only lets businesses reply within 24 hours of the person's last message. Reply in the {brand?.label} app, or wait for them to message again.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
