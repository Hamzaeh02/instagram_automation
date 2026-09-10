import { CheckCircle2, Loader2, PlugZap, XCircle } from "lucide-react"
import { useState } from "react"
import { api, ApiError } from "../api/client"
import { Button, Card, Input, Label } from "./ui"
import type { CredentialField } from "../lib/types"

export function CredentialGroup({
  title,
  description,
  fields,
  testKey,
  onSaved,
}: {
  title: string
  description?: string
  fields: CredentialField[]
  testKey?: string
  onSaved: () => void
}) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function save() {
    const changed = Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== ""))
    if (Object.keys(changed).length === 0) return
    setSaving(true)
    try {
      await api.put("/credentials", changed)
      setEdits({})
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/credentials/test/${testKey}`)
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof ApiError ? err.message : "Test failed" })
    } finally {
      setTesting(false)
    }
  }

  const hasEdits = Object.values(edits).some((v) => v !== "")

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-[var(--font-display)] font-bold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {testKey && (
          <div className="flex flex-col items-end gap-1.5">
            <Button variant="outline" onClick={test} disabled={testing} className="!px-3 !py-1.5 text-xs">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
              Test connection
            </Button>
            {testResult && (
              <span
                className={
                  "flex items-center gap-1 text-[11px] " +
                  (testResult.ok ? "text-emerald-400" : "text-rose-400")
                }
              >
                {testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {testResult.message}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name}>
            <Label>{f.label}</Label>
            <Input
              type={f.secret ? "password" : "text"}
              placeholder={f.secret ? (f.configured ? f.value : "Not set") : f.value || "Not set"}
              value={edits[f.name] ?? ""}
              onChange={(e) => setEdits((s) => ({ ...s, [f.name]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      {hasEdits && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={saving} className="!px-4 !py-2 text-sm">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </Card>
  )
}
