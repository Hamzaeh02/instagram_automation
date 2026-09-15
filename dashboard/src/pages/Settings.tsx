import { Camera, CheckCircle2, Save, UserCircle, Unlink, XCircle } from "lucide-react"
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

export function Settings() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [ig, setIg] = useState<InstagramStatus | null>(null)

  async function loadBrand() {
    const res = await api.get<{ exists: boolean; brand: BrandProfile | null }>("/brand")
    setBrand(res.brand)
  }

  async function loadInstagram() {
    const res = await api.get<InstagramStatus>("/instagram/status")
    setIg(res)
  }

  useEffect(() => {
    loadBrand()
    loadInstagram()
  }, [])

  function update<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setBrand((b) => (b ? { ...b, [key]: value } : b))
  }

  async function saveBrand() {
    if (!brand) return
    setSavingBrand(true)
    try {
      await api.put("/brand", brand)
    } finally {
      setSavingBrand(false)
    }
  }

  async function disconnectInstagram() {
    await api.delete("/instagram/connection")
    await loadInstagram()
  }

  const oauthResult = searchParams.get("instagram")

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Brand & account" description="Everything that powers your automation." />

      {oauthResult === "connected" && (
        <FadeIn>
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Instagram connected successfully.
          </div>
        </FadeIn>
      )}
      {oauthResult === "denied" && (
        <FadeIn>
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            <XCircle className="h-4 w-4" /> Instagram connection was cancelled.
          </div>
        </FadeIn>
      )}

      <section className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                <p className="text-sm text-[var(--color-text)]">
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

        <FadeIn delay={0.05}>
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <UserCircle className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-[var(--font-display)] font-bold">Account</h3>
            </div>
            <p className="text-sm text-[var(--color-text)]">{user?.email}</p>
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
              <div className="flex justify-end">
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
