import { AnimatePresence, motion } from "framer-motion"
import { Briefcase, Camera, Check, ClipboardCheck, Globe, Music2, PlayCircle, UploadCloud, Wand2, CalendarDays, Zap, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Button, FadeIn, PageHeader, Spinner } from "../components/ui"
import { TiltCard } from "../components/TiltCard"
import { StatusBadge } from "../components/StatusBadge"
import type { BrandProfile, Post, RunLogEntry } from "../lib/types"

interface PlatformStatus {
  connected: boolean
  needs_page?: boolean
  needs_organization?: boolean
}

const POLL_MS = 3000
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export function Dashboard() {
  const [ig, setIg] = useState<PlatformStatus | null>(null)
  const [fb, setFb] = useState<PlatformStatus | null>(null)
  const [li, setLi] = useState<PlatformStatus | null>(null)
  const [tt, setTt] = useState<PlatformStatus | null>(null)
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [activity, setActivity] = useState<RunLogEntry[] | null>(null)
  const [runState, setRunState] = useState<{ status: "running" | "done" | "error"; message?: string } | null>(null)
  const pollRef = useRef<number | null>(null)

  async function load() {
    const [igRes, fbRes, liRes, ttRes, brandRes, postsRes, activityRes] = await Promise.all([
      api.get<PlatformStatus>("/instagram/status"),
      api.get<PlatformStatus>("/facebook/status"),
      api.get<PlatformStatus>("/linkedin/status"),
      api.get<PlatformStatus>("/tiktok/status"),
      api.get<{ brand: BrandProfile | null }>("/brand"),
      api.get<{ posts: Post[] }>("/posts?limit=8"),
      api.get<{ runs: RunLogEntry[] }>("/activity?limit=6"),
    ])
    setIg(igRes)
    setFb(fbRes)
    setLi(liRes)
    setTt(ttRes)
    setBrand(brandRes.brand)
    setPosts(postsRes.posts)
    setActivity(activityRes.runs)
  }

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  async function runNow() {
    setRunState({ status: "running" })
    try {
      await api.post("/orchestrator/run")
    } catch {
      setRunState({ status: "error", message: "Couldn't start the automation run - try again." })
      return
    }

    const startedAt = Date.now()
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        setRunState({ status: "error", message: "This is taking longer than expected — check Recent activity below." })
        return
      }
      const res = await api.get<{ runs: RunLogEntry[] }>("/activity?limit=1")
      const latest = res.runs[0]
      if (latest && latest.status !== "running" && new Date(latest.started_at).getTime() >= startedAt - POLL_MS) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        await load()
        if (latest.status === "error") {
          setRunState({ status: "error", message: latest.error || "The run failed." })
        } else {
          setRunState({ status: "done", message: latest.summary || "Done." })
        }
        setTimeout(() => setRunState((s) => (s?.status === "done" ? null : s)), 6000)
      }
    }, POLL_MS)
  }

  const brandReady = Boolean(brand?.brand_name && brand?.niche)
  const running = runState?.status === "running"

  const statuses = [
    { key: "instagram", label: "Instagram", icon: Camera, ok: Boolean(ig?.connected) },
    { key: "facebook", label: "Facebook", icon: Globe, ok: Boolean(fb?.connected && !fb.needs_page) },
    { key: "linkedin", label: "LinkedIn", icon: Briefcase, ok: Boolean(li?.connected) },
    { key: "tiktok", label: "TikTok", icon: Music2, ok: Boolean(tt?.connected) },
    { key: "brand", label: "Brand profile", icon: ClipboardCheck, ok: brandReady },
  ]

  const quickLinks = [
    { to: "/upload", label: "Upload content", icon: UploadCloud },
    { to: "/create", label: "Create with AI", icon: Wand2 },
    { to: "/calendar", label: "Open calendar", icon: CalendarDays },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Your content engine"
        description="Everything running end to end — schedule, generate, review, publish."
        actions={
          <Button onClick={runNow} disabled={running}>
            {running ? <Spinner className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            {running ? "Running…" : "Run automation now"}
          </Button>
        }
      />

      {/* Status strip: every connection state in one horizontal bar instead
          of a grid of separate cards. */}
      <div className="mb-8 flex flex-wrap items-center gap-2 rounded-md border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3">
        {statuses.map((s) => (
          <div
            key={s.key}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-1.5"
          >
            <s.icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" strokeWidth={2} />
            <span className="text-xs font-semibold">{s.label}</span>
            <span className={"h-1.5 w-1.5 rounded-full " + (s.ok ? "bg-[var(--color-success)]" : "bg-[var(--color-warning)]")} />
          </div>
        ))}
      </div>

      <AnimatePresence>
        {runState && (
          <FadeIn>
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={
                "mb-6 flex items-center gap-2.5 rounded-md border-2 px-4 py-3 text-sm " +
                (runState.status === "running"
                  ? "border-[var(--color-border)] bg-white/[0.03] text-[var(--color-text-muted)]"
                  : runState.status === "done"
                    ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                    : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]")
              }
            >
              {runState.status === "running" ? (
                <>
                  <Spinner className="h-4 w-4" /> Running your automation in the background — this'll update on
                  its own.
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

      {/* Asymmetric body: a tall activity timeline on the left, a stacked
          "up next" queue + quick-action tiles rail on the right — replaces
          the old two-cards-side-by-side pattern entirely. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <FadeIn delay={0.1} className="lg:col-span-3">
          <div className="glass-card p-6">
            <h3 className="mb-5 font-[var(--font-display)] font-bold">Activity timeline</h3>
            {activity === null && (
              <div className="flex justify-center py-10">
                <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
              </div>
            )}
            {activity?.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">
                No automation runs yet. Trigger one above, or wait for the daily schedule.
              </p>
            )}
            {activity && activity.length > 0 && (
              <div className="relative ml-1.5 space-y-6 border-l-2 border-[var(--color-border)] pl-6">
                {activity.map((run) => (
                  <div key={run.id} className="relative">
                    <span
                      className={
                        "absolute -left-[29px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--color-bg-elevated)] " +
                        (run.status === "ok"
                          ? "bg-[var(--color-success)]"
                          : run.status === "error"
                            ? "bg-[var(--color-danger)]"
                            : "bg-[var(--color-warning)]")
                      }
                    />
                    <div className="flex items-start gap-2">
                      <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--color-text)]">{run.summary || run.error || "Running…"}</div>
                        <div className="text-xs text-[var(--color-text-faint)]">
                          {new Date(run.started_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FadeIn>

        <div className="space-y-5 lg:col-span-2">
          <FadeIn delay={0.15}>
            <div className="glass-card p-0">
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="font-[var(--font-display)] text-sm font-bold">Up next</h3>
                <Link to="/calendar" className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                  Calendar →
                </Link>
              </div>
              <div className="divide-y-2 divide-[var(--color-border)]">
                {posts === null && (
                  <div className="flex justify-center py-8">
                    <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
                  </div>
                )}
                {posts?.length === 0 && (
                  <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">Nothing planned yet.</p>
                )}
                {posts?.slice(0, 4).map((p) => (
                  <Link
                    key={p.id}
                    to={`/posts/${p.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.title || "Untitled"}</div>
                      <div className="text-xs text-[var(--color-text-faint)]">
                        {new Date(p.scheduled_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <TiltCard className="!p-4">
              <h3 className="mb-3 font-[var(--font-display)] text-sm font-bold">Quick actions</h3>
              <div className="space-y-2">
                {quickLinks.map((q) => (
                  <Link
                    key={q.to}
                    to={q.to}
                    className="flex items-center gap-2.5 rounded-md border-2 border-[var(--color-border)] px-3 py-2.5 text-sm font-semibold transition hover:border-[var(--color-primary)] hover:bg-white/[0.03]"
                  >
                    <q.icon className="h-4 w-4 text-[var(--color-primary)]" />
                    {q.label}
                  </Link>
                ))}
              </div>
            </TiltCard>
          </FadeIn>
        </div>
      </div>
    </div>
  )
}
