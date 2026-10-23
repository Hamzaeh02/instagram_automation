import { AnimatePresence, motion } from "framer-motion"
import { Check, Film, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { BRAND_PLATFORMS } from "../BrandLogos"

export function CalendarVisual() {
  const filled = new Set([1, 3, 4, 6, 8, 10, 11, 13, 15, 16, 18])
  const colors = ["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e"]
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 21 }, (_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.04, type: "spring", stiffness: 260, damping: 18 }}
          className="flex aspect-square flex-col justify-between rounded-md border border-black/[0.07] bg-white p-1"
        >
          <span className="text-[8px] font-semibold text-black/35">{i + 1}</span>
          {filled.has(i) && <span className="h-1.5 w-full rounded-full" style={{ background: colors[i % colors.length] }} />}
        </motion.div>
      ))}
    </div>
  )
}

const CAPTIONS = [
  "3 moves to a perfect latte heart ☕ Save this for your next pour!",
  "Stop scrolling - this 30-sec trick doubles your reach 🚀",
  "Behind the scenes: how we roast every batch by hand 🔥",
]

export function TypingVisual() {
  const [idx, setIdx] = useState(0)
  const [len, setLen] = useState(0)
  useEffect(() => {
    const text = CAPTIONS[idx]
    if (len < text.length) {
      const t = setTimeout(() => setLen((l) => l + 1), 32)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setIdx((i) => (i + 1) % CAPTIONS.length)
      setLen(0)
    }, 1800)
    return () => clearTimeout(t)
  }, [len, idx])
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6a8f2e]">
        <Sparkles className="h-3 w-3" /> AI caption
      </div>
      <p className="min-h-[40px] text-sm font-medium leading-snug text-[#211f1a]">
        {CAPTIONS[idx].slice(0, len)}
        <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-[#6a8f2e]" />
      </p>
      <p className="mt-2 text-xs font-medium text-[#065fd4]">#coffee #latteart #barista</p>
    </div>
  )
}

export function VideoVisual() {
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {["#6a8f2e", "#b5701f", "#2f7680", "#8a4f9e", "#c1432c"].map((c, i) => (
          <motion.div
            key={c}
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
            className="relative aspect-[9/16] flex-1 overflow-hidden rounded-md"
            style={{ background: `linear-gradient(160deg, ${c}, ${c}99)` }}
          >
            <Film className="absolute bottom-1 left-1 h-3 w-3 text-white/80" />
          </motion.div>
        ))}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[10px] font-semibold text-black/50">
          <span>Writing from your brand profile</span>
          <span>auto</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#6a8f2e] to-[#b5701f]"
            animate={{ width: ["0%", "100%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
          />
        </div>
      </div>
    </div>
  )
}

export function ApproveVisual() {
  const [approved, setApproved] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setApproved((a) => !a), 2200)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-3.5 shadow-sm">
      <div className="flex gap-3">
        <div className="aspect-[9/16] w-14 shrink-0 rounded-md bg-gradient-to-br from-[#2f7680] to-[#6a8f2e]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Latte art in 60s</div>
          <div className="mt-1 text-[11px] text-black/50">Tue · 9:00 AM · 3 platforms</div>
          <div className="mt-3 flex gap-2">
            <AnimatePresence mode="wait">
              {approved ? (
                <motion.span
                  key="ok"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  className="inline-flex items-center gap-1 rounded-md bg-[#2f8a54]/12 px-2.5 py-1 text-[11px] font-bold text-[#2f8a54]"
                >
                  <Check className="h-3.5 w-3.5" /> Approved - scheduled
                </motion.span>
              ) : (
                <motion.span
                  key="btn"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  className="inline-flex items-center gap-1 rounded-md bg-[#5f8a2c] px-2.5 py-1 text-[11px] font-bold text-white"
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PublishVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        {BRAND_PLATFORMS.map((_, i) => {
          const a = (i / BRAND_PLATFORMS.length) * Math.PI * 2 - Math.PI / 2
          return (
            <motion.line
              key={i}
              x1="100"
              y1="100"
              x2={100 + Math.cos(a) * 78}
              y2={100 + Math.sin(a) * 78}
              stroke="#6a8f2e"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 0.5 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.6 }}
            />
          )
        })}
      </svg>
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-br from-[#6a8f2e] to-[#b5701f] shadow-lg"
      >
        <Sparkles className="h-5 w-5 text-white" />
      </motion.div>
      {BRAND_PLATFORMS.map((p, i) => {
        const a = (i / BRAND_PLATFORMS.length) * Math.PI * 2 - Math.PI / 2
        return (
          <motion.div
            key={p.key}
            initial={{ opacity: 0, scale: 0.4 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 + i * 0.12, type: "spring", stiffness: 240, damping: 16 }}
            className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-black/[0.06] bg-white shadow-md"
            style={{ left: `${50 + Math.cos(a) * 39}%`, top: `${50 + Math.sin(a) * 39}%` }}
          >
            <p.logo className={p.key === "youtube" ? "h-5 w-7" : "h-6 w-6"} />
          </motion.div>
        )
      })}
    </div>
  )
}

export function AnalyticsVisual() {
  const bars = [38, 52, 44, 68, 61, 79, 92]
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-[var(--font-display)] text-2xl font-bold">142.1K</span>
        <span className="rounded-full bg-[#2f8a54]/12 px-2 py-0.5 text-[10px] font-bold text-[#2f8a54]">+38% reach</span>
      </div>
      <div className="flex h-24 items-end gap-1.5">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            whileInView={{ height: `${h}%` }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 rounded-t-md"
            style={{ background: i === bars.length - 1 ? "linear-gradient(180deg,#6a8f2e,#2f8a54)" : "rgba(106,143,46,0.22)" }}
          />
        ))}
      </div>
    </div>
  )
}
