import { motion, useScroll, useTransform } from "framer-motion"
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Globe,
  Layers,
  Link2,
  Lock,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { BRAND_PLATFORMS, YouTubeBrand } from "../components/BrandLogos"
import { CountUp, DashboardPreview } from "../components/landing/DashboardPreview"
import {
  AnalyticsVisual,
  ApproveVisual,
  CalendarVisual,
  PublishVisual,
  TypingVisual,
  VideoVisual,
} from "../components/landing/FeatureVisuals"

const HeroScene = lazy(() => import("../components/landing/HeroScene").then((m) => ({ default: m.HeroScene })))

const ease = [0.16, 1, 0.3, 1] as const

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function SectionHeading({ eyebrow, title, sub, dark }: { eyebrow: string; title: ReactNode; sub?: string; dark?: boolean }) {
  return (
    <Reveal className="mx-auto mb-14 max-w-2xl text-center">
      <div className={"mb-3 text-xs font-bold uppercase tracking-[0.2em] " + (dark ? "text-[#a9c95e]" : "text-[#5f8a2c]")}>{eyebrow}</div>
      <h2 className={"font-[var(--font-display)] text-3xl font-bold leading-tight tracking-tight sm:text-5xl " + (dark ? "text-white" : "")}>{title}</h2>
      {sub && <p className={"mt-4 text-base sm:text-lg " + (dark ? "text-white/60" : "text-[#6b6558]")}>{sub}</p>}
    </Reveal>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return (
    <header
      className={
        "fixed inset-x-0 top-0 z-50 transition-all duration-300 " +
        (scrolled ? "border-b border-black/[0.06] bg-[#faf9f5]/80 backdrop-blur-xl" : "bg-transparent")
      }
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6a8f2e] to-[#b5701f] shadow-md">
            <Zap className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </span>
          <span className="font-[var(--font-display)] text-lg font-bold">Reelmind</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-[#6b6558] md:flex">
          {[
            ["Features", "#features"],
            ["How it works", "#how"],
            ["Platforms", "#platforms"],
            ["Dashboard", "#dashboard"],
          ].map(([label, href]) => (
            <a key={href} href={href} className="transition hover:text-[#211f1a]">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login" className="rounded-lg px-3.5 py-2 text-sm font-bold text-[#211f1a] transition hover:bg-black/5">
            Sign in
          </Link>
          <Link
            to="/signup"
            className="group inline-flex items-center gap-1.5 rounded-lg bg-[#211f1a] px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-[#5f8a2c]"
          >
            Get started <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 sm:pt-32">
      {/* soft background glows */}
      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-[#a9c95e]/25 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 top-40 h-[420px] w-[420px] rounded-full bg-[#d9a441]/20 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(28,26,20,0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-6 px-5 sm:px-8 lg:grid-cols-2">
        <div className="relative z-10 py-8 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#6a8f2e]/25 bg-white/70 px-3 py-1.5 text-xs font-bold text-[#4f7523] shadow-sm backdrop-blur"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6a8f2e] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6a8f2e]" />
            </span>
            AI content engine for every platform
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.08, ease }}
            className="font-[var(--font-display)] text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl xl:text-7xl"
          >
            Plan, create &amp; publish{" "}
            <span className="bg-gradient-to-r from-[#5f8a2c] via-[#8aa83a] to-[#b5701f] bg-clip-text text-transparent">everywhere</span>
            <br />
            on autopilot.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.16, ease }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-[#6b6558]"
          >
            Reelmind turns your brand into a ready-to-post content calendar - AI-written scripts, captions and hashtags,
            generated videos, one-click approval, and automatic publishing to YouTube, Instagram, TikTok, Facebook,
            LinkedIn and X. Then it shows you exactly what's working.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.24, ease }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#5f8a2c] to-[#7a9a32] px-6 py-3.5 text-base font-bold text-white shadow-[0_12px_32px_-8px_rgba(95,138,44,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-8px_rgba(95,138,44,0.75)]"
            >
              Get started <ArrowRight className="h-4.5 w-4.5 transition group-hover:translate-x-1" />
            </Link>
            <a
              href="#dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/80 px-6 py-3.5 text-base font-bold shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              <BarChart3 className="h-4.5 w-4.5 text-[#5f8a2c]" /> See the dashboard
            </a>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-[#6b6558]"
          >
            {["6 platforms, one calendar", "Every post reviewed by you", "Separate workspace per brand"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[#5f8a2c]" /> {t}
              </span>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.1, ease }}
          className="relative h-[420px] sm:h-[520px] lg:h-[620px]"
        >
          <Suspense fallback={null}>
            <HeroScene />
          </Suspense>
        </motion.div>
      </div>
    </section>
  )
}

function Marquee() {
  const items = [...BRAND_PLATFORMS, ...BRAND_PLATFORMS, ...BRAND_PLATFORMS, ...BRAND_PLATFORMS]
  return (
    <section className="relative border-y border-black/[0.06] bg-white/60 py-6">
      <div className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#948d7d]">Publishes natively to</div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="flex w-max animate-[marquee_32s_linear_infinite] gap-4">
          {items.map((p, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-2xl border border-black/[0.06] bg-white px-5 py-3 shadow-sm">
              <span className="flex h-7 w-8 items-center justify-center">
                <p.logo className={p.key === "youtube" ? "h-6 w-8" : "h-7 w-7"} />
              </span>
              <span className="font-bold">{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  visual,
  className = "",
  delay = 0,
}: {
  icon: typeof Zap
  title: string
  body: string
  visual: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <Reveal delay={delay} className={className}>
      <motion.div
        whileHover={{ y: -6 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-black/[0.07] bg-white/80 p-6 shadow-[0_1px_2px_rgba(28,26,20,0.05)] backdrop-blur transition-shadow hover:shadow-[0_24px_60px_-20px_rgba(28,26,20,0.25)]"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-[#a9c95e]/30 to-[#d9a441]/20 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#6a8f2e] to-[#b5701f] shadow-md">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <h3 className="font-[var(--font-display)] text-xl font-bold">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#6b6558]">{body}</p>
        <div className="mt-6 flex-1 rounded-2xl bg-[#f3f1ea] p-4">{visual}</div>
      </motion.div>
    </Reveal>
  )
}

function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading
        eyebrow="Everything in one place"
        title={
          <>
            From idea to published post -
            <br className="hidden sm:block" /> without the busywork
          </>
        }
        sub="Every step a social media team does by hand, done for you - and you stay in control of what goes live."
      />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={CalendarDays}
          title="AI content calendar"
          body="Describe your brand or upload a brief, and get a day-by-day plan matched to your posting cadence - then amend it with a simple prompt."
          visual={<CalendarVisual />}
        />
        <FeatureCard
          icon={Wand2}
          title="Scripts, captions & hashtags"
          body="Hooks that stop the scroll, captions in your brand's voice, and hashtag sets tuned for reach - with one-click Optimize on anything you write."
          visual={<TypingVisual />}
          delay={0.06}
        />
        <FeatureCard
          icon={Clapperboard}
          title="On-brand from day one"
          body="Your brand profile drives everything - niche, audience, pillars, tone and market - so every caption, hashtag set and image fits your brand, not a template."
          visual={<VideoVisual />}
          delay={0.12}
        />
        <FeatureCard
          icon={ShieldCheck}
          title="You approve everything"
          body="Nothing is ever published without your OK. Edit, approve or reject with feedback - rejected posts are rewritten from your notes."
          visual={<ApproveVisual />}
        />
        <FeatureCard
          icon={Send}
          title="Auto-publish to 6 platforms"
          body="Approved posts go out at their scheduled time to every platform you've connected - each tracked separately, so one failure never blocks the rest."
          visual={<PublishVisual />}
          delay={0.06}
        />
        <FeatureCard
          icon={BarChart3}
          title="Real performance analytics"
          body="Followers, reach, views, likes, comments and engagement rate pulled live from each platform - in one dashboard."
          visual={<AnalyticsVisual />}
          delay={0.12}
        />
      </div>
    </section>
  )
}

const STEPS = [
  { icon: Sparkles, title: "Describe your brand", body: "Niche, audience, tone and content pillars - or just upload a document." },
  { icon: Bot, title: "AI plans & creates", body: "A full calendar of scripts, captions, hashtags and videos is generated." },
  { icon: CheckCircle2, title: "Review & approve", body: "Tweak anything, approve what you love, reject with feedback." },
  { icon: Send, title: "Publish & measure", body: "Posts go live automatically and results land in your dashboard." },
]

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 60%"] })
  const lineWidth = useTransform(scrollYProgress, [0, 1], ["0%", "100%"])
  return (
    <section id="how" className="relative overflow-hidden bg-white/60 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading eyebrow="How it works" title="Four steps. Then it runs itself." />
        <div ref={ref} className="relative grid grid-cols-1 gap-10 md:grid-cols-4 md:gap-6">
          <div className="absolute left-[12.5%] right-[12.5%] top-8 hidden h-0.5 bg-black/[0.07] md:block">
            <motion.div style={{ width: lineWidth }} className="h-full bg-gradient-to-r from-[#6a8f2e] to-[#b5701f]" />
          </div>
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1} className="relative text-center">
              <motion.div
                whileHover={{ rotate: -6, scale: 1.06 }}
                className="relative z-10 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-black/[0.06] bg-white shadow-[0_12px_30px_-12px_rgba(28,26,20,0.3)]"
              >
                <s.icon className="h-7 w-7 text-[#5f8a2c]" />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#211f1a] text-[11px] font-bold text-white">
                  {i + 1}
                </span>
              </motion.div>
              <h3 className="font-[var(--font-display)] text-lg font-bold">{s.title}</h3>
              <p className="mx-auto mt-2 max-w-[240px] text-sm text-[#6b6558]">{s.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const PLATFORM_DETAILS: Record<string, { color: string; does: string; publishes: string[]; stats: string[] }> = {
  youtube: {
    color: "#e62117",
    does: "Uploads your videos with every YouTube Studio setting applied.",
    publishes: ["Videos & Shorts", "Thumbnails", "Subtitles", "Playlists"],
    stats: ["Subscribers", "Channel views", "Video likes"],
  },
  instagram: {
    color: "#c13584",
    does: "Publishes Reels and photo posts to your professional account.",
    publishes: ["Reels", "Photo posts", "Captions & hashtags"],
    stats: ["Followers", "Reach", "Profile views"],
  },
  tiktok: {
    color: "#111111",
    does: "Posts short videos and photos straight to your TikTok.",
    publishes: ["Videos", "Photo posts", "Captions"],
    stats: ["Publish status", "Queued & failed posts"],
  },
  facebook: {
    color: "#1877f2",
    does: "Publishes to the Facebook Page you choose.",
    publishes: ["Videos", "Photo posts", "Page selection"],
    stats: ["Followers", "Page likes", "Shares"],
  },
  linkedin: {
    color: "#0a66c2",
    does: "Shares posts to your personal LinkedIn profile.",
    publishes: ["Videos", "Image posts", "Captions"],
    stats: ["Publish status", "Queued & failed posts"],
  },
  x: {
    color: "#111111",
    does: "Posts to your X account with media attached.",
    publishes: ["Videos", "Images", "Posts"],
    stats: ["Followers", "Likes", "Reposts"],
  },
}

function Platforms() {
  return (
    <section id="platforms" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading
        eyebrow="Platforms"
        title={
          <>
            Six platforms.
            <br className="hidden sm:block" /> One calendar.
          </>
        }
        sub="Connect each account once per brand. Every approved post goes out to the platforms you pick - each tracked on its own."
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {BRAND_PLATFORMS.map((p, i) => {
          const d = PLATFORM_DETAILS[p.key]
          return (
            <Reveal key={p.key} delay={(i % 3) * 0.07}>
              <motion.div
                whileHover={{ y: -6 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className="group relative h-full overflow-hidden rounded-3xl border border-black/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(28,26,20,0.05)] transition-shadow hover:shadow-[0_24px_60px_-20px_rgba(28,26,20,0.25)]"
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: d.color }} />
                <div
                  className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-25"
                  style={{ background: d.color }}
                />
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white shadow-md">
                    <p.logo className={p.key === "youtube" ? "h-6 w-8" : "h-8 w-8"} />
                  </span>
                  <h3 className="font-[var(--font-display)] text-xl font-bold">{p.label}</h3>
                </div>
                <p className="text-sm leading-relaxed text-[#6b6558]">{d.does}</p>
                <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.15em] text-[#948d7d]">Publishes</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.publishes.map((t) => (
                    <span key={t} className="rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-semibold">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.15em] text-[#948d7d]">On your dashboard</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.stats.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full border border-black/[0.07] px-2.5 py-1 text-xs font-medium text-[#6b6558]">
                      <BarChart3 className="h-3 w-3" style={{ color: d.color }} /> {t}
                    </span>
                  ))}
                </div>
              </motion.div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}

function DashboardShowcase() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] })
  const rotateX = useTransform(scrollYProgress, [0, 1], [32, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [0.86, 1])
  const y = useTransform(scrollYProgress, [0, 1], [80, 0])
  return (
    <section id="dashboard" className="relative overflow-hidden bg-[#13150f] py-24 sm:py-32">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[#6a8f2e]/25 blur-[140px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          dark
          eyebrow="Your dashboard"
          title={
            <>
              Every platform's numbers,
              <br className="hidden sm:block" /> finally in one place
            </>
          }
          sub="Followers, reach, engagement rate, publishing activity and content status - live from each connected account, per brand."
        />
        <div ref={ref} style={{ perspective: 1600 }}>
          <motion.div style={{ rotateX, scale, y, transformOrigin: "center top" }}>
            <DashboardPreview />
          </motion.div>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
          {[
            { v: 6, s: "", l: "Platforms connected per brand" },
            { v: 90, s: "-day", l: "Content calendars, generated" },
            { v: 100, s: "%", l: "Of posts approved by you first" },
            { v: 1, s: "-click", l: "Approve & schedule" },
          ].map((m) => (
            <Reveal key={m.l}>
              <div className="font-[var(--font-display)] text-4xl font-bold text-white sm:text-5xl">
                <CountUp to={m.v} />
                <span className="text-[#a9c95e]">{m.s}</span>
              </div>
              <div className="mt-2 text-sm text-white/55">{m.l}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function YouTubeSection() {
  return (
    <section id="youtube" className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-2">
      <Reveal>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e62117]/20 bg-white px-3 py-1.5 text-xs font-bold shadow-sm">
          <YouTubeBrand className="h-3.5 w-5" /> YouTube Studio-level uploads
        </div>
        <h2 className="font-[var(--font-display)] text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Upload to YouTube with every setting - without opening Studio
        </h2>
        <p className="mt-5 text-lg text-[#6b6558]">
          Title, description, tags, custom thumbnail, subtitles, playlist, category, visibility and audience - set them once
          in Reelmind and they're applied the moment your video publishes.
        </p>
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            "Custom thumbnails",
            "Subtitles in any language",
            "Playlists - pick or create",
            "Public, unlisted or private",
            "AI-optimized titles & tags",
            "Made-for-kids compliance",
          ].map((t, i) => (
            <motion.li
              key={t}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07 }}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-[#5f8a2c]" /> {t}
            </motion.li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={0.1}>
        <motion.div
          whileHover={{ rotateY: -6, rotateX: 4 }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
          style={{ transformPerspective: 1200 }}
          className="relative rounded-3xl border border-black/[0.07] bg-white p-6 shadow-[0_40px_100px_-40px_rgba(28,26,20,0.45)]"
        >
          <div className="mb-5 flex items-center gap-2.5">
            <YouTubeBrand className="h-6 w-8" />
            <div className="font-[var(--font-display)] text-lg font-bold">YouTube details</div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-black/10 px-3.5 py-2.5">
              <div className="text-[10px] font-semibold text-black/45">Title</div>
              <div className="text-sm font-semibold">How to Pour Perfect Latte Art (60-Second Guide)</div>
            </div>
            <div className="flex gap-3">
              <div className="aspect-video w-36 shrink-0 rounded-xl bg-gradient-to-br from-[#b5701f] via-[#c98a3a] to-[#6a8f2e] shadow-inner" />
              <div className="flex-1 space-y-2">
                <div className="text-[10px] font-semibold text-black/45">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {["latte art", "barista tips", "coffee at home"].map((t) => (
                    <span key={t} className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "Public", i: Globe, on: false },
                { l: "Unlisted", i: Link2, on: true },
                { l: "Private", i: Lock, on: false },
              ].map((v) => (
                <div key={v.l} className={"rounded-xl border-2 p-2.5 " + (v.on ? "border-[#5f8a2c] bg-[#5f8a2c]/5" : "border-black/[0.07]")}>
                  <v.i className={"mb-1 h-4 w-4 " + (v.on ? "text-[#5f8a2c]" : "text-black/40")} />
                  <div className="text-xs font-bold">{v.l}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#f3f1ea] px-3.5 py-2.5 text-xs">
              <span className="font-semibold">Subtitles · English</span>
              <span className="font-bold text-[#2f8a54]">Added</span>
            </div>
          </div>
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -right-4 -top-5 rounded-2xl border border-black/[0.06] bg-white px-3.5 py-2.5 shadow-xl"
          >
            <div className="text-[10px] font-semibold text-black/45">Scheduled</div>
            <div className="text-sm font-bold">Tue · 9:00 AM</div>
          </motion.div>
        </motion.div>
      </Reveal>
    </section>
  )
}

function Workspaces() {
  const brands = [
    { name: "Demo Coffee Co.", color: "from-[#6a8f2e] to-[#2f8a54]", platforms: ["youtube", "instagram", "tiktok"] },
    { name: "Northside Fitness", color: "from-[#2f7680] to-[#3f6fa0]", platforms: ["instagram", "facebook", "x"] },
    { name: "Studio Lumen", color: "from-[#b5701f] to-[#c1432c]", platforms: ["youtube", "linkedin", "instagram"] },
  ]
  return (
    <section className="relative overflow-hidden bg-white/60 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <div className="relative mx-auto h-[340px] max-w-md">
            {brands.map((b, i) => (
              <motion.div
                key={b.name}
                initial={{ opacity: 0, y: 40, rotate: 0 }}
                whileInView={{ opacity: 1, y: i * 70, rotate: (i - 1) * -3 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15, type: "spring", stiffness: 90, damping: 14 }}
                whileHover={{ scale: 1.03, zIndex: 10 }}
                className="absolute inset-x-0 top-0 rounded-3xl border border-black/[0.07] bg-white p-5 shadow-[0_24px_60px_-24px_rgba(28,26,20,0.35)]"
                style={{ zIndex: 3 - i }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${b.color} font-bold text-white`}>
                      {b.name[0]}
                    </span>
                    <div>
                      <div className="font-bold">{b.name}</div>
                      <div className="text-xs text-[#6b6558]">Own brand profile · own calendar</div>
                    </div>
                  </div>
                  <div className="flex -space-x-1.5">
                    {b.platforms.map((k) => {
                      const p = BRAND_PLATFORMS.find((x) => x.key === k)!
                      return (
                        <span key={k} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-white shadow">
                          <p.logo className={k === "youtube" ? "h-3.5 w-5" : "h-5 w-5"} />
                        </span>
                      )
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#5f8a2c]">Workspaces</div>
          <h2 className="font-[var(--font-display)] text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            Run every brand from one login
          </h2>
          <p className="mt-5 text-lg text-[#6b6558]">
            Each workspace is fully separate - its own brand voice, connected accounts, calendar, posts and analytics.
            Switch between brands in one click; nothing ever leaks between them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {[
              { i: Layers, t: "Unlimited workspaces" },
              { i: ShieldCheck, t: "Fully isolated data" },
              { i: Zap, t: "One-click switching" },
            ].map((f) => (
              <span key={f.t} className="inline-flex items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold shadow-sm">
                <f.i className="h-4 w-4 text-[#5f8a2c]" /> {f.t}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#4f7523] via-[#5f8a2c] to-[#8a6a1f] px-6 py-16 text-center shadow-[0_40px_100px_-30px_rgba(95,138,44,0.6)] sm:px-12 sm:py-20">
          {[
            "left-[8%] top-[18%] h-16 w-16 rotate-12",
            "right-[10%] top-[24%] h-20 w-20 -rotate-12",
            "bottom-[14%] left-[18%] h-12 w-12 rotate-45",
            "bottom-[18%] right-[20%] h-14 w-14 rotate-6",
          ].map((pos, i) => (
            <motion.div
              key={i}
              animate={{ y: [0, -14, 0], rotate: [0, 8, 0] }}
              transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut" }}
              className={`absolute rounded-2xl border border-white/25 bg-white/10 backdrop-blur-sm ${pos}`}
            />
          ))}
          <h2 className="relative font-[var(--font-display)] text-3xl font-bold leading-tight text-white sm:text-5xl">
            Your next 90 days of content,
            <br className="hidden sm:block" /> planned before lunch.
          </h2>
          <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/80">
            Connect your platforms, describe your brand, and let Reelmind handle the rest.
          </p>
          <Link
            to="/signup"
            className="group relative mt-9 inline-flex items-center gap-2 rounded-xl bg-white px-7 py-4 text-base font-bold text-[#211f1a] shadow-xl transition hover:-translate-y-0.5"
          >
            Create your account <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
          </Link>
        </div>
      </Reveal>
    </section>
  )
}

function Footer() {
  const columns: { title: string; links: [string, string][] }[] = [
    {
      title: "Product",
      links: [
        ["Features", "#features"],
        ["How it works", "#how"],
        ["Platforms", "#platforms"],
        ["Dashboard", "#dashboard"],
      ],
    },
    {
      title: "Account",
      links: [
        ["Sign in", "/login"],
        ["Create account", "/signup"],
      ],
    },
    {
      title: "Legal",
      links: [
        ["Terms of Service", "/terms"],
        ["Privacy Policy", "/privacy"],
      ],
    },
  ]
  return (
    <footer className="border-t border-black/[0.06] bg-white/70">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6a8f2e] to-[#b5701f]">
              <Zap className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
            </span>
            <span className="font-[var(--font-display)] text-lg font-bold">Reelmind</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-[#6b6558]">
            Plan, create and publish content to every platform - from one calendar, for every brand you run.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {BRAND_PLATFORMS.map((p) => (
              <span
                key={p.key}
                title={p.label}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.06] bg-white shadow-sm transition hover:-translate-y-0.5"
              >
                <p.logo className={p.key === "youtube" ? "h-4 w-6" : "h-5 w-5"} />
              </span>
            ))}
          </div>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#948d7d]">{col.title}</div>
            <ul className="space-y-2.5">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("/") && !["/terms", "/privacy"].includes(href) ? (
                    <Link to={href} className="text-sm font-semibold text-[#6b6558] transition hover:text-[#211f1a]">
                      {label}
                    </Link>
                  ) : (
                    <a href={href} className="text-sm font-semibold text-[#6b6558] transition hover:text-[#211f1a]">
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-black/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-[#948d7d] sm:px-8 md:flex-row md:items-start md:justify-between md:gap-8">
          <span className="shrink-0">© 2026 Hamza Ehsan. All rights reserved.</span>
          <span className="md:text-right">
            Reelmind uses YouTube API Services. YouTube is a trademark of Google LLC. Instagram and Facebook are trademarks
            of Meta Platforms, Inc. TikTok is a trademark of ByteDance Ltd. LinkedIn is a trademark of LinkedIn Corporation.
            X is a trademark of X Corp. Reelmind is not affiliated with or endorsed by these companies.
          </span>
        </div>
      </div>
    </footer>
  )
}

export function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#faf9f5] text-[#211f1a]">
      <Nav />
      <Hero />
      <Marquee />
      <Features />
      <HowItWorks />
      <Platforms />
      <DashboardShowcase />
      <YouTubeSection />
      <Workspaces />
      <FinalCta />
      <Footer />
    </div>
  )
}
