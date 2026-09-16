import { AnimatePresence, motion } from "framer-motion"
import { Briefcase, Camera, Check, CheckCircle2, Globe, Music2, Save, UserCircle, Unlink, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { api } from "../api/client"
import { Button, Card, FadeIn, Input, Label, PageHeader, Spinner, Textarea } from "../components/ui"
import { TagList } from "../components/TagList"
import { useAuth } from "../lib/auth"
import type { BrandProfile } from "../lib/types"

interface InstagramStatus {
  connected: boolean
  username?: string
  connected_at?: string
}

interface FacebookStatus {
  connected: boolean
  needs_page?: boolean
  page_name?: string
  connected_at?: string
}

interface LinkedInStatus {
  connected: boolean
  person_name?: string
  connected_at?: string
}

interface TikTokStatus {
  connected: boolean
  username?: string
  connected_at?: string
}

interface FacebookPage {
  id: string
  name: string
}

export function Settings() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandSaved, setBrandSaved] = useState(false)
  const [ig, setIg] = useState<InstagramStatus | null>(null)
  const [fb, setFb] = useState<FacebookStatus | null>(null)
  const [li, setLi] = useState<LinkedInStatus | null>(null)
  const [tt, setTt] = useState<TikTokStatus | null>(null)
  const [fbPages, setFbPages] = useState<FacebookPage[] | null>(null)

  async function loadBrand() {
    const res = await api.get<{ exists: boolean; brand: BrandProfile | null }>("/brand")
    setBrand(res.brand)
  }

  async function loadInstagram() {
    setIg(await api.get<InstagramStatus>("/instagram/status"))
  }

  async function loadFacebook() {
    const res = await api.get<FacebookStatus>("/facebook/status")
    setFb(res)
    if (res.connected && res.needs_page) {
      setFbPages((await api.get<{ pages: FacebookPage[] }>("/facebook/pages")).pages)
    }
  }

  async function loadLinkedIn() {
    setLi(await api.get<LinkedInStatus>("/linkedin/status"))
  }

  async function loadTikTok() {
    setTt(await api.get<TikTokStatus>("/tiktok/status"))
  }

  useEffect(() => {
    loadBrand()
    loadInstagram()
    loadFacebook()
    loadLinkedIn()
    loadTikTok()
  }, [])

  function update<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setBrand((b) => (b ? { ...b, [key]: value } : b))
  }

  async function saveBrand() {
    if (!brand) return
    setSavingBrand(true)
    setBrandSaved(false)
    try {
      await api.put("/brand", brand)
      setBrandSaved(true)
      setTimeout(() => setBrandSaved(false), 3000)
    } finally {
      setSavingBrand(false)
    }
  }

  async function disconnectInstagram() {
    await api.delete("/instagram/connection")
    await loadInstagram()
  }

  async function disconnectFacebook() {
    await api.delete("/facebook/connection")
    setFbPages(null)
    await loadFacebook()
  }

  async function chooseFacebookPage(pageId: string) {
    await api.post("/facebook/page", { page_id: pageId })
    setFbPages(null)
    await loadFacebook()
  }

  async function disconnectLinkedIn() {
    await api.delete("/linkedin/connection")
    await loadLinkedIn()
  }

  async function disconnectTikTok() {
    await api.delete("/tiktok/connection")
    await loadTikTok()
  }

  const notice = (platform: string, result: string | null) => {
    if (!result) return null
    if (result === "connected") return { tone: "ok" as const, text: `${platform} connected successfully.` }
    if (result === "choose") return { tone: "ok" as const, text: `${platform} connected — pick which page below.` }
    if (result === "denied") return { tone: "err" as const, text: `${platform} connection was cancelled.` }
    if (result === "no_pages") return { tone: "err" as const, text: `No ${platform} Pages found for that account.` }
    return null
  }

  const notices = [
    notice("Instagram", searchParams.get("instagram")),
    notice("Facebook", searchParams.get("facebook")),
    notice("LinkedIn", searchParams.get("linkedin")),
    notice("TikTok", searchParams.get("tiktok")),
  ].filter((n): n is { tone: "ok" | "err"; text: string } => Boolean(n))

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Brand & account" description="Everything that powers your automation." />

      {notices.map((n, i) => (
        <FadeIn key={i}>
          <div
            className={
              "mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm " +
              (n.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300")
            }
          >
            {n.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {n.text}
          </div>
        </FadeIn>
      ))}

      <section className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <FadeIn>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Camera className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">Instagram</h3>
            </div>
            {ig === null ? (
              <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
            ) : ig.connected ? (
              <div>
                <p className="truncate text-sm text-[var(--color-text)]">
                  Connected as <span className="font-semibold">@{ig.username}</span>
                </p>
                <Button variant="outline" onClick={disconnectInstagram} className="mt-4 !px-3 !py-1.5 text-xs">
                  <Unlink className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                  Connect your Instagram account so Reelmind can publish on your behalf.
                </p>
                <a href="/api/instagram/connect">
                  <Button className="!px-4 !py-2 text-sm">Connect Instagram</Button>
                </a>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.03}>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Globe className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">Facebook</h3>
            </div>
            {fb === null ? (
              <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
            ) : fb.connected && !fb.needs_page ? (
              <div>
                <p className="truncate text-sm text-[var(--color-text)]">
                  Posting to <span className="font-semibold">{fb.page_name}</span>
                </p>
                <Button variant="outline" onClick={disconnectFacebook} className="mt-4 !px-3 !py-1.5 text-xs">
                  <Unlink className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            ) : fb.connected && fb.needs_page ? (
              <div>
                <p className="mb-3 text-sm text-[var(--color-text-muted)]">Which Page should Reelmind post to?</p>
                {fbPages === null ? (
                  <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
                ) : fbPages.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-faint)]">No manageable Pages found.</p>
                ) : (
                  <div className="space-y-1.5">
                    {fbPages.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => chooseFacebookPage(p.id)}
                        className="block w-full truncate rounded-lg border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:border-[var(--color-border-strong)] hover:bg-white/5"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                  Connect a Facebook Page so Reelmind can post there too.
                </p>
                <a href="/api/facebook/connect">
                  <Button className="!px-4 !py-2 text-sm">Connect Facebook</Button>
                </a>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.06}>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">LinkedIn</h3>
            </div>
            {li === null ? (
              <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
            ) : li.connected ? (
              <div>
                <p className="truncate text-sm text-[var(--color-text)]">
                  Connected as <span className="font-semibold">{li.person_name}</span>
                </p>
                <Button variant="outline" onClick={disconnectLinkedIn} className="mt-4 !px-3 !py-1.5 text-xs">
                  <Unlink className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                  Connect your LinkedIn profile so Reelmind can post there too.
                </p>
                <a href="/api/linkedin/connect">
                  <Button className="!px-4 !py-2 text-sm">Connect LinkedIn</Button>
                </a>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.09}>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Music2 className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">TikTok</h3>
            </div>
            {tt === null ? (
              <Spinner className="h-4 w-4 text-[var(--color-text-faint)]" />
            ) : tt.connected ? (
              <div>
                <p className="truncate text-sm text-[var(--color-text)]">
                  {tt.username ? (
                    <>Connected as <span className="font-semibold">@{tt.username}</span></>
                  ) : (
                    "Connected"
                  )}
                </p>
                <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                  Posts are private until your app passes TikTok's audit.
                </p>
                <Button variant="outline" onClick={disconnectTikTok} className="mt-4 !px-3 !py-1.5 text-xs">
                  <Unlink className="h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                  Connect your TikTok account so Reelmind can post there too.
                </p>
                <a href="/api/tiktok/connect">
                  <Button className="!px-4 !py-2 text-sm">Connect TikTok</Button>
                </a>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.12}>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <UserCircle className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">Account</h3>
            </div>
            <p className="truncate text-sm text-[var(--color-text)]" title={user?.email}>{user?.email}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Full access to uploads, scheduling, and AI content creation.
            </p>
          </Card>
        </FadeIn>
      </section>

      <section>
        <h2 className="mb-4 font-[var(--font-display)] text-lg font-bold">Brand profile</h2>
        {!brand ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
          </div>
        ) : (
          <FadeIn>
            <Card className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Brand name</Label>
                  <Input value={brand.brand_name} onChange={(e) => update("brand_name", e.target.value)} />
                </div>
                <div>
                  <Label>Posts per week</Label>
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    value={brand.posting_cadence_per_week}
                    onChange={(e) => update("posting_cadence_per_week", Number(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <Label>Niche</Label>
                <Textarea rows={2} value={brand.niche} onChange={(e) => update("niche", e.target.value)} />
              </div>
              <div>
                <Label>Audience</Label>
                <Textarea rows={2} value={brand.audience} onChange={(e) => update("audience", e.target.value)} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Tone</Label>
                  <Input value={brand.tone} onChange={(e) => update("tone", e.target.value)} />
                </div>
                <div>
                  <Label>Voice</Label>
                  <Input value={brand.tts_voice} onChange={(e) => update("tts_voice", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Content pillars</Label>
                <TagList values={brand.content_pillars} onChange={(v) => update("content_pillars", v)} />
              </div>
              <div>
                <Label>Banned topics</Label>
                <TagList values={brand.banned_topics} onChange={(v) => update("banned_topics", v)} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Call-to-action style</Label>
                  <Input value={brand.cta_style} onChange={(e) => update("cta_style", e.target.value)} />
                </div>
                <div>
                  <Label>Hashtag style</Label>
                  <Input value={brand.hashtag_style} onChange={(e) => update("hashtag_style", e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <AnimatePresence>
                  {brandSaved && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
                    >
                      <Check className="h-3.5 w-3.5" /> Profile updated successfully
                    </motion.div>
                  )}
                </AnimatePresence>
                <Button onClick={saveBrand} disabled={savingBrand}>
                  <Save className="h-4 w-4" /> {savingBrand ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </Card>
          </FadeIn>
        )}
      </section>
    </div>
  )
}
