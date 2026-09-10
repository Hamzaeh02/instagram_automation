import { motion } from "framer-motion"
import { CalendarPlus, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, PageHeader, Spinner } from "../components/ui"
import { StatusBadge } from "../components/StatusBadge"
import type { Post, PostStatus } from "../lib/types"

const FILTERS: { label: string; value: PostStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Planned", value: "planned" },
  { label: "Pending review", value: "pending_review" },
  { label: "Approved", value: "approved" },
  { label: "Posted", value: "posted" },
  { label: "Needs attention", value: "needs_manual_edit" },
]

export function Calendar() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [filter, setFilter] = useState<PostStatus | "all">("all")
  const [generating, setGenerating] = useState(false)

  async function load() {
    const res = await api.get<{ posts: Post[] }>("/posts?limit=200")
    setPosts(res.posts)
  }

  useEffect(() => {
    load()
  }, [])

  async function generate() {
    setGenerating(true)
    try {
      await api.post("/calendar/generate", { days: 90 })
      await load()
    } finally {
      setGenerating(false)
    }
  }

  const filtered = useMemo(() => {
    if (!posts) return []
    return filter === "all" ? posts : posts.filter((p) => p.status === filter)
  }, [posts, filter])

  const grouped = useMemo(() => {
    const groups = new Map<string, Post[]>()
    for (const post of filtered) {
      const month = new Date(post.scheduled_date).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
      if (!groups.has(month)) groups.set(month, [])
      groups.get(month)!.push(post)
    }
    return Array.from(groups.entries())
  }, [filtered])

  return (
    <div>
      <PageHeader
        eyebrow="Calendar"
        title="90-day content plan"
        description="Every post the strategy engine has planned, generated, or published."
        actions={
          <Button onClick={generate} disabled={generating}>
            {generating ? <Spinner className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
            {generating ? "Generating…" : "Extend calendar"}
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={
              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition " +
              (filter === f.value
                ? "border-[var(--color-primary)] bg-violet-500/15 text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-white/5")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {posts === null && (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
        </div>
      )}

      {posts?.length === 0 && (
        <Card className="py-16 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            No content planned yet. Generate your first 90-day calendar to get started.
          </p>
          <Button onClick={generate} disabled={generating} className="mx-auto mt-4">
            <CalendarPlus className="h-4 w-4" /> Generate 90-day calendar
          </Button>
        </Card>
      )}

      <div className="space-y-8">
        {grouped.map(([month, monthPosts]) => (
          <div key={month}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              {month}
            </h3>
            <div className="space-y-2">
              {monthPosts.map((post, i) => (
                <FadeIn key={post.id} delay={Math.min(i * 0.03, 0.3)}>
                  <Link to={`/posts/${post.id}`}>
                    <motion.div
                      whileHover={{ x: 3 }}
                      className="glass-card flex items-center gap-4 px-5 py-4 transition-colors hover:border-[var(--color-border-strong)]"
                    >
                      <div className="w-16 shrink-0 text-center">
                        <div className="text-lg font-bold leading-none">
                          {new Date(post.scheduled_date).getDate()}
                        </div>
                        <div className="mt-1 text-[10px] uppercase text-[var(--color-text-faint)]">
                          {new Date(post.scheduled_date).toLocaleDateString(undefined, { weekday: "short" })}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{post.title || "Untitled"}</div>
                        <div className="truncate text-xs text-[var(--color-text-faint)]">{post.pillar}</div>
                      </div>
                      <StatusBadge status={post.status} />
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-faint)]" />
                    </motion.div>
                  </Link>
                </FadeIn>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
