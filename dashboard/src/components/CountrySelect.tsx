import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown, Globe2, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "../api/client"
import { useOnClickOutside } from "../lib/useOnClickOutside"

export interface Country {
  code: string
  name: string
  flag: string
}

let cached: Country[] | null = null

export function useCountries() {
  const [countries, setCountries] = useState<Country[]>(cached ?? [])
  useEffect(() => {
    if (cached) return
    api.get<{ countries: Country[] }>("/events/countries").then((r) => {
      cached = r.countries
      setCountries(r.countries)
    })
  }, [])
  return countries
}

/** Best guess from the browser locale (en-US -> US), if that country is supported. */
export function guessCountry(countries: Country[]): string {
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase()
  return countries.some((c) => c.code === region) ? region : ""
}

export function CountrySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const countries = useCountries()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useOnClickOutside(ref, () => setOpen(false))
  const selected = countries.find((c) => c.code === value)
  const filtered = useMemo(
    () => countries.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.code.toLowerCase() === query.toLowerCase()),
    [countries, query],
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-md border border-[var(--color-border)] bg-black/[0.03] px-3.5 py-2.5 text-left text-sm transition hover:border-[var(--color-border-strong)]"
      >
        {selected ? <span className="text-lg leading-none">{selected.flag}</span> : <Globe2 className="h-4 w-4 text-[var(--color-text-faint)]" />}
        <span className={"flex-1 " + (selected ? "" : "text-[var(--color-text-faint)]")}>{selected?.name ?? "Select the country you target"}</span>
        <ChevronDown className={"h-4 w-4 text-[var(--color-text-faint)] transition " + (open ? "rotate-180" : "")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-white shadow-xl"
          >
            <div className="relative border-b border-[var(--color-border)] p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries"
                className="w-full rounded-md bg-black/[0.03] py-2 pl-8 pr-3 text-sm outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    onChange(c.code)
                    setOpen(false)
                    setQuery("")
                  }}
                  className={"flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-black/5 " + (c.code === value ? "font-semibold" : "")}
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className="flex-1">{c.name}</span>
                  {c.code === value && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-[var(--color-text-faint)]">No match</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
