import { motion } from "framer-motion"
import { Film, Cloud, Camera, Sparkles, Zap, PlayCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, PageHeader, Spinner } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import type { CredentialGroups, Post, RunLogEntry } from "../lib/types"

const GROUP_META: Record<string, { label: string; icon: typeof Sparkles }> = {
  llm: { label: "Content strategy", icon: Sparkles },
  video: { label: "Video engine", icon: Film },
  instagram: { label: "Instagram", icon: Camera },
  storage: { label: "Storage", icon: Cloud },
}

// Some groups offer a choice of provider (e.g. LLM_PROVIDER=anthropic|groq) -
// only the active provider's key should count toward "configured", not every
// field in the group (the inactive provider's key is expected to be blank).
function isGroupConfigured(key: string, fields: import("../lib/types").CredentialField[]): boolean {
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
  if (key === "llm") {
    const activeKey = byName.llm_provider?.value === "groq" ? byName.groq_api_key : byName.anthropic_api_key
    return Boolean(activeKey?.configured)
  }
  if (key === "video") {
    const activeKey = byName.video_engine?.value === "broll" ? byName.pexels_api_key : byName.heygen_api_key
    return Boolean(activeKey?.configured)
  }
  return fields.length > 0 && fields.every((f) => f.configured)
}

export function Dashboard() {
  const [groups, setGroups] = useState<CredentialGroups | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [activity, setActivity] = useState<RunLogEntry[] | null>(null)
  const [running, setRunning] = useState(false)

  async function load() {
    const [creds, postsRes, activityRes] = await Promise.all([
      api.get<{ groups: CredentialGroups }>("/credentials"),
      api.get<{ posts: Post[] }>("/posts?limit=8"),
      api.get<{ runs: RunLogEntry[] }>("/activity?limit=5"),
    ])
    setGroups(creds.groups)
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

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Your content engine"
        description="Everything running end to end — plan, generate, review, publish."
        actions={
          <Button onClick={runNow} disabled={running}>
            {running ? <Spinner className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            {running ? "Running…" : "Run automation now"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries(GROUP_META).map(([key, meta], i) => {
          const fields = groups?.[key] ?? []
          const configured = isGroupConfigured(key, fields)
          const partial = !configured && fields.some((f) => f.configured)
          return (
            <FadeIn key={key} delay={i * 0.05}>
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <meta.icon className="h-5 w-5 text-[var(--color-text-muted)]" strokeWidth={1.75} />
                  <span
                    className={
                      "h-2 w-2 rounded-full " +
                      (configured ? "bg-emerald-400" : partial ? "bg-amber-400" : "bg-slate-600")
                    }
                  />
                </div>
                <div className="text-sm font-semibold">{meta.label}</div>
                <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {configured ? "Connected" : partial ? "Incomplete" : "Not set up"}
                </div>
              </Card>
            </FadeIn>
          )
        })}
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
                  No posts planned yet — generate your calendar to get started.
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
                        {p.scheduled_date} · {p.pillar}
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
