import { Save } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "../api/client"
import { Button, Card, FadeIn, Input, Label, PageHeader, Spinner, Textarea } from "../components/ui"
import { TagList } from "../components/TagList"
import { CredentialGroup } from "../components/CredentialGroup"
import type { BrandProfile, CredentialGroups } from "../lib/types"

export function Settings() {
  const [brand, setBrand] = useState<BrandProfile | null>(null)
  const [savingBrand, setSavingBrand] = useState(false)
  const [groups, setGroups] = useState<CredentialGroups | null>(null)

  async function loadBrand() {
    const res = await api.get<{ exists: boolean; brand: BrandProfile | null }>("/brand")
    setBrand(res.brand)
  }

  async function loadCredentials() {
    const res = await api.get<{ groups: CredentialGroups }>("/credentials")
    setGroups(res.groups)
  }

  useEffect(() => {
    loadBrand()
    loadCredentials()
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

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Brand & integrations" description="Everything that powers your automation, in one place." />

      <section className="mb-10">
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

      <section>
        <h2 className="mb-4 font-[var(--font-display)] text-lg font-bold">Integrations</h2>
        {!groups ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5 text-[var(--color-text-faint)]" />
          </div>
        ) : (
          <div className="space-y-5">
            <FadeIn delay={0.02}>
              <CredentialGroup
                title="Content strategy (LLM)"
                description="Generates the 90-day calendar, scripts, captions, and hashtags."
                fields={groups.llm}
                testKey="llm"
                onSaved={loadCredentials}
              />
            </FadeIn>
            <FadeIn delay={0.04}>
              <CredentialGroup
                title="Video engine"
                description="Turns each script into a Reel."
                fields={groups.video}
                testKey="video"
                onSaved={loadCredentials}
              />
            </FadeIn>
            <FadeIn delay={0.06}>
              <CredentialGroup
                title="Instagram"
                description="Publishes approved Reels to your account."
                fields={groups.instagram}
                testKey="instagram"
                onSaved={loadCredentials}
              />
            </FadeIn>
            <FadeIn delay={0.1}>
              <CredentialGroup
                title="Storage"
                description="Hosts generated videos so Instagram can fetch them."
                fields={groups.storage}
                testKey="storage"
                onSaved={loadCredentials}
              />
            </FadeIn>
            <FadeIn delay={0.12}>
              <CredentialGroup
                title="Dashboard access"
                description="Your login password for this dashboard."
                fields={groups.dashboard}
                onSaved={loadCredentials}
              />
            </FadeIn>
          </div>
        )}
      </section>
    </div>
  )
}
