import { AnimatePresence, motion } from "framer-motion"
import { Briefcase, Camera, Check, ClipboardCheck, Globe, Music2, PlayCircle, XCircle, Zap } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, PageHeader, Spinner } from "../components/ui"
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
      api.get<{ runs: RunLogEntry[] }>("/activity?limit=5"),
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

  const cards = [
    {
      key: "instagram",
      label: "Instagram",
      icon: Camera,
      ok: Boolean(ig?.connected),
      detail: ig?.connected ? "Connected" : "Not connected",
    },
    {
      key: "facebook",
      label: "Facebook",
      icon: Globe,
      ok: Boolean(fb?.connected && !fb.needs_page),
      detail: fb?.connected && !fb.needs_page ? "Connected" : fb?.connected && fb.needs_page ? "Pick a Page" : "Not connected",
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      icon: Briefcase,
      ok: Boolean(li?.connected),
      detail: li?.connected ? "Connected" : "Not connected",
    },
    {
      key: "tiktok",
      label: "TikTok",
      icon: Music2,
      ok: Boolean(tt?.connected),
      detail: tt?.connected ? "Connected" : "Not connected",
    },
    {
      key: "brand",
      label: "Brand profile",
      icon: ClipboardCheck,
      ok: brandReady,
      detail: brandReady ? "Complete" : "Incomplete",
    },
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

      <AnimatePresence>
        {runState && (
          <FadeIn>
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={
                "mb-6 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm " +
                (runState.status === "running"
                  ? "border-[var(--color-border)] bg-white/[0.03] text-[var(--color-text-muted)]"
                  : runState.status === "done"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300")
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <FadeIn key={c.key} delay={i * 0.05}>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <c.icon className="h-5 w-5 text-[var(--color-text-muted)]" strokeWidth={1.75} />
                <span className={"h-2 w-2 rounded-full " + (c.ok ? "bg-emerald-400" : "bg-amber-400")} />
              </div>
              <div className="text-sm font-semibold">{c.label}</div>
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{c.detail}</div>
            </Card>
          </FadeIn>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <FadeIn delay={0.1} className="lg:col-span-3">
          <Card className="p-0">
            <div className="flex items-center justify-between px-6 py-5">
              <h3 className="font-[var(--font-display)] font-bold">Up next</h3>
              <Link to="/calendar" className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                View calendar →
              </Link>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {posts === null && (
                <div className="flex justify-center py-10">
                  <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
                </div>
              )}
              {posts?.length === 0 && (
                <p className="px-6 py-8 text-sm text-[var(--color-text-muted)]">
                  No posts planned yet — upload content or generate your calendar to get started.
                </p>
              )}
              {posts?.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    to={`/posts/${p.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-3.5 transition hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.title || "Untitled"}</div>
                      <div className="text-xs text-[var(--color-text-faint)]">
                        {new Date(p.scheduled_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · {p.pillar || p.source}
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                </motion.div>
              ))}
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={0.15} className="lg:col-span-2">
          <Card className="p-0">
            <div className="px-6 py-5">
              <h3 className="font-[var(--font-display)] font-bold">Recent activity</h3>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {activity === null && (
                <div className="flex justify-center py-10">
                  <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
                </div>
              )}
              {activity?.length === 0 && (
                <p className="px-6 py-8 text-sm text-[var(--color-text-muted)]">
                  No automation runs yet. Trigger one above, or wait for the daily schedule.
                </p>
              )}
              {activity?.map((run) => (
                <div key={run.id} className="flex items-start gap-3 px-6 py-3.5">
                  <PlayCircle
                    className={
                      "mt-0.5 h-4 w-4 shrink-0 " +
                      (run.status === "ok"
                        ? "text-emerald-400"
                        : run.status === "error"
                          ? "text-rose-400"
                          : "text-amber-400")
                    }
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--color-text)]">
                      {run.summary || run.error || "Running…"}
                    </div>
                    <div className="text-xs text-[var(--color-text-faint)]">
                      {new Date(run.started_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </FadeIn>
      </div>
    </div>
  )
}
