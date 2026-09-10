import { AnimatePresence, motion } from "framer-motion"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import { Input } from "./ui"

export function TagList({
  values,
  onChange,
  placeholder,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onChange([...values, trimmed])
    setDraft("")
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={add}
          className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-strong)] px-3.5 text-[var(--color-text-muted)] transition hover:bg-white/5 hover:text-[var(--color-text)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {values.map((v, i) => (
            <motion.span
              key={v + i}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-white/5 py-1.5 pl-3 pr-2 text-sm text-[var(--color-text)]"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(i)}
                className="rounded-full p-0.5 text-[var(--color-text-faint)] hover:bg-white/10 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
