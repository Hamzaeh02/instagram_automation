import { motion } from "framer-motion"
import { ArrowRight, Sparkles, Wand2 } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, Label, PageHeader, Spinner, Textarea, Input } from "../components/ui"

const IDEAS = [
  "A quick tip for people who keep skipping leg day",
  "Behind the scenes of how we make our product",
  "3 mistakes beginners make and how to fix them",
  "A customer testimonial turned into a 30-second story",
  "Answering the #1 question we get in the DMs",
]

function defaultScheduledAt() {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function Create() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState("")
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{ id: number; status: string }>("/create", {
        prompt: prompt.trim(),
        scheduled_at: scheduledAt,
      })
      navigate(`/posts/${res.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start generating that post")
      setLoading(false)
    }
  }

  return (
    <div className="section-create">
      <PageHeader
        eyebrow="Create"
        title="Create a post with AI"
        description="Describe what you want this Reel to be about — Reelmind writes the script, generates the video, and puts it in your review queue."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="order-2 lg:order-1 lg:col-span-1">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
            Need an idea?
          </h3>
          <div className="space-y-2">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                onClick={() => setPrompt(idea)}
                className="block w-full rounded-md border-2 border-[var(--color-border)] px-3 py-2.5 text-left text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-text)]"
              >
                {idea}
              </button>
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-3">
          <div className="panel-terminal glass-card">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-faint)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-danger)]" />
              <span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />
              <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              <span className="ml-2">reelmind — create</span>
            </div>

            <Label>
              <span className="mr-1.5 text-[var(--color-primary)]">&gt;_</span>What's this post about?
            </Label>
            <Textarea
              autoFocus
              rows={7}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A quick tip for people who keep skipping leg day"
              className="!bg-black/40 font-mono text-[13px]"
            />

            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <Label>Schedule for</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <Button onClick={submit} disabled={!prompt.trim() || loading}>
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4" /> Starting…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" /> Generate this post <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}
          </div>

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]"
            >
              <Sparkles className="h-4 w-4 animate-pulse text-[var(--color-primary)]" />
              Writing your script…
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
