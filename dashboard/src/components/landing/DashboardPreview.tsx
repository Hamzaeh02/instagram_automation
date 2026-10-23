import { animate, useInView } from "framer-motion"
import { BarChart3, CalendarDays, Clock, FileStack, LayoutDashboard, Send, Settings, UploadCloud } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis } from "recharts"
import { FacebookBrand, InstagramBrand, TikTokBrand, YouTubeBrand } from "../BrandLogos"

export function CountUp({ to, suffix = "", decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!inView) return
    const controls = animate(0, to, { duration: 1.8, ease: [0.16, 1, 0.3, 1], onUpdate: setValue })
    return () => controls.stop()
  }, [inView, to])
  const text =
    to >= 1000 && !decimals
      ? value >= 1000
        ? (value / 1000).toFixed(1).replace(/\.0$/, "") + "K"
        : Math.round(value).toString()
      : value.toFixed(decimals)
  return (
    <span ref={ref} className="tabular-nums">
      {text}
      {suffix}
    </span>
  )
}

const TIMELINE = [
  { w: "Aug 24", s: 4, p: 2 },
  { w: "Aug 31", s: 6, p: 5 },
  { w: "Sep 7", s: 7, p: 6 },
  { w: "Sep 14", s: 9, p: 8 },
  { w: "Sep 21", s: 8, p: 8 },
  { w: "Sep 28", s: 11, p: 10 },
  { w: "Oct 5", s: 12, p: 11 },
  { w: "Oct 12", s: 14, p: 12 },
]

const STATUS = [
  { name: "Posted", value: 48, color: "#2f8a54" },
  { name: "Approved", value: 14, color: "#6a8f2e" },
  { name: "In review", value: 9, color: "#2f7680" },
  { name: "Planned", value: 22, color: "#d9c9a3" },
]

const PLATFORMS = [
  { label: "YouTube", logo: YouTubeBrand, wide: true, followers: 18400, rate: "6.2%", color: "#e62117" },
  { label: "Instagram", logo: InstagramBrand, followers: 24700, rate: "4.8%", color: "#c13584" },
  { label: "TikTok", logo: TikTokBrand, followers: 31200, rate: "7.9%", color: "#111111" },
  { label: "Facebook", logo: FacebookBrand, followers: 9600, rate: "2.1%", color: "#1877f2" },
]

export function DashboardPreview() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartsVisible = useInView(chartRef, { once: true, margin: "-80px" })

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#faf9f5] text-[#211f1a] shadow-[0_40px_120px_-30px_rgba(106,143,46,0.55)]">
      {/* browser chrome */}
      <div className="flex items-center gap-2 border-b border-black/10 bg-white px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <div className="ml-3 hidden flex-1 rounded-md bg-black/[0.05] px-3 py-1 text-[11px] text-black/45 sm:block">reelmind.app/dashboard</div>
      </div>

      <div className="flex">
        <aside className="hidden w-44 shrink-0 border-r border-black/10 bg-white p-3 md:block">
          <div className="mb-4 flex items-center gap-2 px-1">
            <div className="h-6 w-6 rounded-md bg-[#5f8a2c]" />
            <span className="text-xs font-bold">Reelmind</span>
          </div>
          <div className="mb-3 rounded-md border border-black/10 px-2 py-1.5 text-[11px] font-semibold">Demo Coffee Co. ▾</div>
          {[
            { l: "Dashboard", i: BarChart3, on: true },
            { l: "Overview", i: LayoutDashboard },
            { l: "Upload", i: UploadCloud },
            { l: "Calendar", i: CalendarDays },
            { l: "Settings", i: Settings },
          ].map((n) => (
            <div key={n.l} className={"mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold " + (n.on ? "bg-[#5f8a2c] text-white" : "text-black/55")}>
              <n.i className="h-3.5 w-3.5" /> {n.l}
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1 space-y-3 p-4 sm:p-5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#5f8a2c]">Dashboard</div>
            <div className="font-[var(--font-display)] text-lg font-bold">Performance overview</div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              { l: "Total reach", v: 142100, i: FileStack, g: "from-[#6a8f2e] to-[#2f8a54]" },
              { l: "Published", v: 48, i: Send, g: "from-[#2f7680] to-[#3f6fa0]" },
              { l: "Upcoming", v: 36, i: Clock, g: "from-[#b5701f] to-[#d9a441]" },
              { l: "Followers", v: 83900, i: BarChart3, g: "from-[#8a4f9e] to-[#c1432c]" },
            ].map((k) => (
              <div key={k.l} className="relative overflow-hidden rounded-xl border border-black/10 bg-white p-3">
                <div className={`absolute -right-5 -top-5 h-16 w-16 rounded-full bg-gradient-to-br ${k.g} opacity-15`} />
                <div className={`mb-2 flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${k.g}`}>
                  <k.i className="h-3 w-3 text-white" />
                </div>
                <div className="font-[var(--font-display)] text-xl font-bold leading-none">
                  <CountUp to={k.v} />
                </div>
                <div className="mt-1 text-[10px] text-black/50">{k.l}</div>
              </div>
            ))}
          </div>

          <div ref={chartRef} className="grid grid-cols-1 gap-2.5 lg:grid-cols-5">
            <div className="rounded-xl border border-black/10 bg-white p-3 lg:col-span-3">
              <div className="mb-1 text-xs font-bold">Publishing activity</div>
              <div className="h-36">
                {chartsVisible && (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={TIMELINE} margin={{ left: 0, right: 4, top: 6, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lp-s" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#b5701f" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#b5701f" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="lp-p" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2f8a54" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#2f8a54" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="w" tick={{ fontSize: 9, fill: "#948d7d" }} axisLine={false} tickLine={false} />
                      <Area type="monotone" dataKey="s" stroke="#b5701f" strokeWidth={2} fill="url(#lp-s)" animationDuration={1600} />
                      <Area type="monotone" dataKey="p" stroke="#2f8a54" strokeWidth={2} fill="url(#lp-p)" animationDuration={1900} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-white p-3 lg:col-span-2">
              <div className="relative h-32 w-32 shrink-0">
                {chartsVisible && (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={STATUS} dataKey="value" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none" animationDuration={1500}>
                        {STATUS.map((s) => (
                          <Cell key={s.name} fill={s.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-[var(--font-display)] text-lg font-bold leading-none">93</span>
                  <span className="text-[9px] text-black/45">posts</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {STATUS.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5 text-[10px]">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className="text-black/55">{s.name}</span>
                    <span className="font-bold">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {PLATFORMS.map((p) => (
              <div key={p.label} className="relative overflow-hidden rounded-xl border border-black/10 bg-white p-3">
                <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: p.color }} />
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="flex h-5 w-6 items-center justify-center">
                    <p.logo className={p.wide ? "h-4 w-5" : "h-5 w-5"} />
                  </span>
                  <span className="text-[11px] font-bold">{p.label}</span>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="font-[var(--font-display)] text-lg font-bold leading-none">
                      <CountUp to={p.followers} />
                    </div>
                    <div className="text-[9px] text-black/45">Followers</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold" style={{ color: p.color }}>
                      {p.rate}
                    </div>
                    <div className="text-[9px] text-black/45">Engagement</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
