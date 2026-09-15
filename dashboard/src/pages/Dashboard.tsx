import { motion } from "framer-motion"
import { Camera, ClipboardCheck, PlayCircle, Zap } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, PageHeader, Spinner } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import type { BrandProfile, Post, RunLogEntry } from "../lib/types"

interface InstagramStatus {
  connected: boolean
  username?: string
}

export function Dashboard() {
  const [ig, setIg] = useState<InstagramStatus | null>(null)
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [activity, setActivity] = useState<RunLogEntry[] | null>(null)
  const [running, setRunning] = useState(false)

  async function load() {
    const [igRes, brandRes, postsRes, activityRes] = await Promise.all([
      api.get<InstagramStatus>("/instagram/status"),
      api.get<{ brand: BrandProfile | null }>("/brand"),
      api.get<{ posts: Post[] }>("/posts?limit=8"),
      api.get<{ runs: RunLogEntry[] }>("/activity?limit=5"),
    ])
    setIg(igRes)
    setBrand(brandRes.brand)
    setPosts(postsRes.posts)
    setActivity(activityRes.runs)
  }

  useEffect(() => {
    load()
  }, [])

  async function runNow() {
    setRunning(true)
    try {
      await api.post("/orchestrator/run")
      setTimeout(load, 1500)
    } finally {
      setTimeout(() => setRunning(false), 1500)
    }
  }

  const brandReady = Boolean(brand?.brand_name && brand?.niche)

  const cards = [
    {
      key: "instagram",
      label: "Instagram",
      icon: Camera,
      ok: Boolean(ig?.connected),
      detail: ig?.connected ? `@${ig?.username}` : "Not connected",
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
