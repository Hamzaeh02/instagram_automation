import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, ApiError } from "../api/client"
import { Button, FieldLabelRow, Input, Label, Textarea } from "../components/ui"
import { TagList } from "../components/TagList"
import { AiImproveButton } from "../components/AiImproveButton"
import type { BrandProfile } from "../lib/types"

function brandContext(form: BrandProfile): Record<string, string> {
  return { brand_name: form.brand_name, niche: form.niche, audience: form.audience, tone: form.tone }
}

const VOICES = [
  { id: "en-US-GuyNeural", label: "Guy — US, confident male" },
  { id: "en-US-JennyNeural", label: "Jenny — US, warm female" },
  { id: "en-US-AriaNeural", label: "Aria — US, upbeat female" },
  { id: "en-GB-RyanNeural", label: "Ryan — UK, calm male" },
  { id: "en-GB-SoniaNeural", label: "Sonia — UK, bright female" },
  { id: "en-AU-NatashaNeural", label: "Natasha — AU, energetic female" },
]

const EMPTY: BrandProfile = {
  brand_name: "",
  niche: "",
  audience: "",
  tone: "",
  content_pillars: [],
  banned_topics: [],
  posting_cadence_per_week: 3,
  cta_style: "",
  hashtag_style: "",
  tts_voice: "en-US-GuyNeural",
  heygen_avatar_id: "",
  heygen_voice_id: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
}

const STEPS = ["Brand", "Audience", "Content", "Cadence", "Voice", "Review"]

export function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<BrandProfile>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState(1)

  function update<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function go(delta: number) {
    setDirection(delta)
    setStep((s) => Math.min(Math.max(s + delta, 0), STEPS.length - 1))
  }

  const canAdvance = (() => {
    if (step === 0) return form.brand_name.trim() && form.niche.trim()
    if (step === 1) return form.audience.trim() && form.tone.trim()
    if (step === 2) return form.content_pillars.length > 0
    return true
  })()

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.put("/brand", form)
      navigate("/")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save your profile")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-0 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-[var(--color-accent-from)]/15 blur-[140px]" />
        <div className="absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full bg-[var(--color-accent-to)]/12 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-2xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)] shadow-lg shadow-violet-900/40">
            <Sparkles className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="font-[var(--font-display)] text-3xl font-bold tracking-tight">
            Let's set up your <span className="gradient-text">content engine</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
            Tell us about your brand once — Reelmind uses this to plan, write, and produce every
            post automatically.
          </p>
        </div>

        <StepProgress steps={STEPS} current={step} />

        <div className="glass-card relative mt-6 overflow-hidden p-8">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: 24 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {step === 0 && (
                <StepBrand form={form} update={update} />
              )}
              {step === 1 && <StepAudience form={form} update={update} />}
              {step === 2 && <StepContent form={form} update={update} />}
              {step === 3 && <StepCadence form={form} update={update} />}
              {step === 4 && <StepVoice form={form} update={update} />}
              {step === 5 && <StepReview form={form} />}
            </motion.div>
          </AnimatePresence>

          {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

          <div className="mt-8 flex items-center justify-between border-t border-[var(--color-border)] pt-6">
            <Button variant="ghost" onClick={() => go(-1)} disabled={step === 0}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button onClick={() => go(1)} disabled={!canAdvance}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : "Launch my content engine"} <Check className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col items-center gap-2">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/8">
            {i <= current && (
              <motion.div
                layoutId={`bar-${i}`}
                className="absolute inset-0 rounded-full bg-gradient-to-r from-[var(--color-accent-from)] to-[var(--color-accent-to)]"
              />
            )}
          </div>
          <span
            className={
              "hidden text-[11px] font-medium sm:block " +
              (i <= current ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-faint)]")
            }
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

type StepProps = {
  form: BrandProfile
  update: <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => void
}

function StepBrand({ form, update }: StepProps) {
  return (
    <div className="space-y-5">
      <h2 className="font-[var(--font-display)] text-lg font-bold">What's your brand?</h2>
      <div>
        <FieldLabelRow
          label="Brand name"
          action={
            <AiImproveButton
              field="brand_name"
              text={form.brand_name}
              context={brandContext(form)}
              onImproved={(v) => update("brand_name", v)}
            />
          }
        />
        <Input
          autoFocus
          placeholder="e.g. Canvas Digital"
          value={form.brand_name}
          onChange={(e) => update("brand_name", e.target.value)}
        />
      </div>
      <div>
        <FieldLabelRow
          label="Niche / topic"
          action={
            <AiImproveButton
              field="niche"
              text={form.niche}
              context={brandContext(form)}
              onImproved={(v) => update("niche", v)}
            />
          }
        />
        <Textarea
          rows={3}
          placeholder="Describe what this account is about in a sentence or two — e.g. sustainable home products for eco-conscious millennials"
          value={form.niche}
          onChange={(e) => update("niche", e.target.value)}
        />
      </div>
    </div>
  )
}

function StepAudience({ form, update }: StepProps) {
  return (
    <div className="space-y-5">
      <h2 className="font-[var(--font-display)] text-lg font-bold">Who are you talking to?</h2>
      <div>
        <FieldLabelRow
          label="Target audience"
          action={
            <AiImproveButton
              field="audience"
              text={form.audience}
              context={brandContext(form)}
              onImproved={(v) => update("audience", v)}
            />
          }
        />
        <Textarea
          rows={3}
          placeholder="Age range, interests, pain points — e.g. busy professionals aged 25-40 who care about sustainability but don't have time to research it"
          value={form.audience}
          onChange={(e) => update("audience", e.target.value)}
        />
      </div>
      <div>
        <FieldLabelRow
          label="Brand voice / tone"
          action={
            <AiImproveButton
              field="tone"
              text={form.tone}
              context={brandContext(form)}
              onImproved={(v) => update("tone", v)}
            />
          }
        />
        <Input
          placeholder="e.g. energetic and funny, or calm and authoritative"
          value={form.tone}
          onChange={(e) => update("tone", e.target.value)}
        />
      </div>
    </div>
  )
}

function StepContent({ form, update }: StepProps) {
  return (
    <div className="space-y-5">
      <h2 className="font-[var(--font-display)] text-lg font-bold">What will you post about?</h2>
      <div>
        <Label>Content pillars</Label>
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Recurring themes the calendar rotates through. Add a few, press Enter after each.
        </p>
        <TagList
          values={form.content_pillars}
          onChange={(v) => update("content_pillars", v)}
          placeholder="e.g. educational tips"
        />
      </div>
      <div>
        <Label>Banned topics (optional)</Label>
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Anything the AI should never mention.
        </p>
        <TagList
          values={form.banned_topics}
          onChange={(v) => update("banned_topics", v)}
          placeholder="e.g. politics"
        />
      </div>
    </div>
  )
}

function StepCadence({ form, update }: StepProps) {
  return (
    <div className="space-y-6">
      <h2 className="font-[var(--font-display)] text-lg font-bold">How often, and how should it read?</h2>
      <div>
        <Label>Posts per week: {form.posting_cadence_per_week}</Label>
        <input
          type="range"
          min={1}
          max={7}
          value={form.posting_cadence_per_week}
          onChange={(e) => update("posting_cadence_per_week", Number(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
        />
        <div className="mt-1 flex justify-between text-[11px] text-[var(--color-text-faint)]">
          <span>1</span>
          <span>7 (daily)</span>
        </div>
      </div>
      <div>
        <FieldLabelRow
          label="Call-to-action style"
          action={
            <AiImproveButton
              field="cta_style"
              text={form.cta_style}
              context={brandContext(form)}
              onImproved={(v) => update("cta_style", v)}
            />
          }
        />
        <Input
          placeholder="e.g. encourage comments and shares"
          value={form.cta_style}
          onChange={(e) => update("cta_style", e.target.value)}
        />
      </div>
      <div>
        <FieldLabelRow
          label="Hashtag style"
          action={
            <AiImproveButton
              field="hashtag_style"
              text={form.hashtag_style}
              context={brandContext(form)}
              onImproved={(v) => update("hashtag_style", v)}
            />
          }
        />
        <Input
          placeholder="e.g. 8-12 tags: 2 broad, 5-7 niche, 1-2 branded"
          value={form.hashtag_style}
          onChange={(e) => update("hashtag_style", e.target.value)}
        />
      </div>
    </div>
  )
}

function StepVoice({ form, update }: StepProps) {
  return (
    <div className="space-y-5">
      <h2 className="font-[var(--font-display)] text-lg font-bold">Pick a voiceover</h2>
      <p className="text-xs text-[var(--color-text-muted)]">Used for every generated video's narration.</p>
      <div className="grid grid-cols-2 gap-3">
        {VOICES.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => update("tts_voice", v.id)}
            className={
              "rounded-xl border p-3.5 text-left text-sm transition " +
              (form.tts_voice === v.id
                ? "border-[var(--color-primary)] bg-violet-500/10 text-[var(--color-text)]"
                : "border-[var(--color-border)] bg-white/[0.02] text-[var(--color-text-muted)] hover:bg-white/5")
            }
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepReview({ form }: { form: BrandProfile }) {
  const rows: [string, string][] = [
    ["Brand", form.brand_name],
    ["Niche", form.niche],
    ["Audience", form.audience],
    ["Tone", form.tone],
    ["Pillars", form.content_pillars.join(", ") || "—"],
    ["Cadence", `${form.posting_cadence_per_week}x / week`],
    ["Voice", form.tts_voice],
  ]
  return (
    <div className="space-y-5">
      <h2 className="font-[var(--font-display)] text-lg font-bold">Review your profile</h2>
      <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 px-4 py-3 text-sm">
            <span className="w-28 shrink-0 text-[var(--color-text-faint)]">{label}</span>
            <span className="text-[var(--color-text)]">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        You can change all of this later from Settings.
      </p>
    </div>
  )
}
