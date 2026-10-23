import { ImagePlus, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { api, ApiError } from "../api/client"
import type { BrandProfile } from "../lib/types"
import { Input, Spinner } from "./ui"

const MAX = 6

/** Photos of the creator or real products. The image model keeps that exact
 *  face / product in every generated post image and YouTube thumbnail. */
export function ReferencePhotos({
  photos,
  onChange,
}: {
  photos: { id: string; label: string }[]
  onChange: (photos: { id: string; label: string }[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(file: File) {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("label", label.trim())
      const res = await api.upload<{ brand: BrandProfile }>("/brand/reference-images", fd)
      onChange(res.brand.reference_images ?? [])
      setLabel("")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed - try again.")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      const res = await api.delete<{ brand: BrandProfile }>(`/brand/reference-images/${id}`)
      onChange(res.brand.reference_images ?? [])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that photo.")
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {photos.map((p) => (
          <div key={p.id} className="group relative w-28">
            <div className="aspect-square overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-black/5">
              <img src={`/api/brand/reference-images/${p.id}`} className="h-full w-full object-cover" />
            </div>
            <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]" title={p.label}>
              {p.label || "No description"}
            </p>
            <button
              type="button"
              onClick={() => remove(p.id)}
              title="Remove photo"
              className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {photos.length < MAX && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='What is it? e.g. "Me - the creator" or "Our HE Ferrari bottle"'
            />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] px-3 py-2.5 text-sm font-semibold transition hover:bg-black/5 disabled:opacity-60"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
            {busy ? "Uploading…" : "Add photo"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && add(e.target.files[0])}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
