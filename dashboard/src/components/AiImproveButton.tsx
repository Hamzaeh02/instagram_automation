import { Loader2, Sparkles } from "lucide-react"
import { useState } from "react"
import { api, ApiError } from "../api/client"

export function AiImproveButton({
  field,
  text,
  context,
  onImproved,
}: {
  field: string
  text: string
  context?: Record<string, string>
  onImproved: (improved: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function improve() {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{ improved: string }>("/ai/improve", {
        field,
        text,
        context: context ?? {},
      })
      onImproved(res.improved)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't optimize this right now")
      setTimeout(() => setError(null), 3000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={improve}
        disabled={!text.trim() || loading}
        title="Optimize with AI"
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] bg-white/5 px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)] transition hover:bg-violet-500/15 disabled:opacity-30 disabled:pointer-events-none"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        {loading ? "Optimizing…" : "Optimize"}
      </button>
      {error && (
        <span className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-lg bg-rose-500/90 px-2 py-1 text-[11px] text-white shadow-lg">
          {error}
        </span>
      )}
    </div>
  )
}
