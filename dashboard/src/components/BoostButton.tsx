import { AnimatePresence, motion } from "framer-motion"
import { ArrowUpRight, Rocket, X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BRAND_PLATFORMS } from "./BrandLogos"

interface BoostGuide {
  action: string
  steps: string[]
  primary: { label: string; href: string | "post" }
  secondary?: { label: string; href: string | "post" }
}

const META_AD_CENTER = "https://business.facebook.com/latest/ad_center"

const GUIDES: Record<string, BoostGuide> = {
  instagram: {
    action: "Boost post",
    steps: [
      "Open the post and tap Boost post (or pick it in Meta Ad Center).",
      "Choose a goal - more profile visits, website visits or messages.",
      "Pick your audience: automatic, or by location, age and interests.",
      "Set a daily budget and how many days it runs, then confirm payment.",
    ],
    primary: { label: "Open Meta Ad Center", href: META_AD_CENTER },
    secondary: { label: "Open post on Instagram", href: "post" },
  },
  facebook: {
    action: "Boost post",
    steps: [
      "Open Meta Ad Center and select this Page post, or click Boost post under it.",
      "Choose a goal - engagement, website visits or messages.",
      "Pick your audience: automatic, or by location, age and interests.",
      "Set a daily budget and duration, then confirm payment.",
    ],
    primary: { label: "Open Meta Ad Center", href: META_AD_CENTER },
    secondary: { label: "Open post on Facebook", href: "post" },
  },
  tiktok: {
    action: "Promote",
    steps: [
      "Open the video in the TikTok app, tap ••• then Promote.",
      "Choose a goal - more video views, profile views or website visits.",
      "Pick an audience, budget and duration, then pay with TikTok coins or card.",
    ],
    primary: { label: "Open post on TikTok", href: "post" },
    secondary: { label: "TikTok Ads Manager", href: "https://ads.tiktok.com/" },
  },
  youtube: {
    action: "Promote",
    steps: [
      "In YouTube Studio, open Promotions and choose this video.",
      "Choose a goal - more views or more subscribers.",
      "Pick where it shows, your audience and a daily budget.",
    ],
    primary: { label: "Open YouTube Studio", href: "https://studio.youtube.com/" },
    secondary: { label: "Open video on YouTube", href: "post" },
  },
  x: {
    action: "Boost",
    steps: [
      "Open X Ads and choose Boost a post, then pick this post.",
      "Choose your audience and a total budget.",
      "Set how long it runs and confirm payment.",
    ],
    primary: { label: "Open X Ads", href: "https://ads.x.com/" },
    secondary: { label: "Open post on X", href: "post" },
  },
  linkedin: {
    action: "Boost",
    steps: [
      "Personal-profile posts are boosted through a company Page as a Thought Leader ad.",
      "In Campaign Manager, create a campaign and select this post.",
      "Pick your audience, budget and schedule.",
    ],
    primary: { label: "Open Campaign Manager", href: "https://www.linkedin.com/campaignmanager/" },
    secondary: { label: "Open post on LinkedIn", href: "post" },
  },
}

export function BoostButton({
  platform,
  permalink,
  caption,
  thumbnail,
  size = "md",
}: {
  platform: string
  permalink: string
  caption: string
  thumbnail?: string
  size?: "sm" | "md"
}) {
  const [open, setOpen] = useState(false)
  const guide = GUIDES[platform]
  const brand = BRAND_PLATFORMS.find((p) => p.key === platform)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!guide) return null
  const resolve = (href: string) => (href === "post" ? permalink : href)
  const links = [guide.primary, guide.secondary].filter((l): l is NonNullable<typeof l> => Boolean(l) && Boolean(resolve(l!.href)))

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={
          "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#5f8a2c] to-[#b5701f] font-bold text-white shadow-sm transition hover:-translate-y-px hover:shadow-md " +
          (size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-xs")
        }
      >
        <Rocket className="h-3.5 w-3.5" /> {guide.action}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
              >
                <div className="relative bg-gradient-to-br from-[#5f8a2c] to-[#b5701f] px-6 pb-5 pt-6 text-white">
                  <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/80">
                    <Rocket className="h-3.5 w-3.5" /> {guide.action}
                  </div>
                  <h3 className="mt-1 font-[var(--font-display)] text-xl font-bold">Get this post in front of more people</h3>
                </div>

                <div className="space-y-5 px-6 py-5">
                  <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-2.5">
                    <div className="relative h-14 w-14 shrink-0">
                      {thumbnail ? (
                        <img src={thumbnail} className="h-14 w-14 rounded-lg object-cover" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-black/[0.06]" />
                      )}
                      {brand && (
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white shadow">
                          <brand.logo className={platform === "youtube" ? "h-2.5 w-3.5" : "h-3.5 w-3.5"} />
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-sm font-medium">{caption || "Your post"}</p>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-faint)]">How it works on {brand?.label}</div>
                    <ol className="space-y-2">
                      {guide.steps.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-sm">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/12 text-[11px] font-bold text-[var(--color-primary)]">
                            {i + 1}
                          </span>
                          <span className="text-[var(--color-text-muted)]">{s}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="flex flex-col gap-2">
                    {links.map((l, i) => (
                      <a
                        key={l.label}
                        href={resolve(l.href)}
                        target="_blank"
                        rel="noreferrer"
                        className={
                          "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition " +
                          (i === 0
                            ? "bg-[#211f1a] text-white hover:bg-[var(--color-primary)]"
                            : "border border-[var(--color-border-strong)] hover:bg-black/5")
                        }
                      >
                        {l.label} <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ))}
                  </div>

                  <p className="text-center text-[11px] text-[var(--color-text-faint)]">
                    Boosting is paid and runs on {brand?.label}'s own ad system - you set the budget and payment there.
                  </p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
