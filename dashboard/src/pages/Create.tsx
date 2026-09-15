import { motion } from "framer-motion"
import { ArrowRight, Sparkles, Wand2 } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, Card, FadeIn, Label, PageHeader, Textarea, Input } from "../components/ui"

const EXAMPLES = [
  "A quick tip for people who keep skipping leg day",
  "Behind the scenes of how we make our candles",
  "3 mistakes beginners make with home workouts",
  "Answer the question we get asked the most: is this worth the price?",
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
    <div>
      <PageHeader
        eyebrow="Create"
        title="Create a post with AI"
        description="Describe what you want this Reel to be about — Reelmind writes the script, generates the video, and puts it in your review queue."
      />

      <div className="mx-auto max-w-2xl">
        <FadeIn>
          <Card className="space-y-5">
            <div>
              <Label>What's this post about?</Label>
              <Textarea
                autoFocus
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A quick tip for people who keep skipping leg day"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Schedule for</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <Button onClick={submit} disabled={!prompt.trim() || loading} className="w-full">
              {loading ? (
                "Starting…"
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate this post <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <p className="text-center text-xs text-[var(--color-text-faint)]">
              Takes a minute or two — you'll land on the post and see it come together.
            </p>
          </Card>
        </FadeIn>

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
  )
}
