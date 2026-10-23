import { AnimatePresence, motion } from "framer-motion"
import { BarChart3, Check, LineChart, MessageCircle, Swords, ChevronsUpDown, LayoutDashboard, CalendarDays, Settings, LogOut, Plus, Zap, UploadCloud } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { useAuth } from "../lib/auth"
import { useOnClickOutside } from "../lib/useOnClickOutside"

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { to: "/insights", label: "Post insights", icon: LineChart },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/competitors", label: "Competitors", icon: Swords },
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: UploadCloud },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/settings", label: "Settings", icon: Settings },
]

function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, switchWorkspace, createWorkspace } = useAuth()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useOnClickOutside(ref, () => {
    setOpen(false)
    setCreating(false)
  })

  async function handleCreate() {
    if (!name.trim()) return
    await createWorkspace(name.trim())
  }

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2.5 text-left transition-colors hover:bg-black/5"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-[11px] font-bold text-[var(--color-on-primary)]">
          {(currentWorkspace?.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <span className="flex-1 truncate text-[13px] font-semibold">
          {currentWorkspace?.name ?? "Loading…"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" strokeWidth={2.5} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-3 right-3 top-full z-30 mt-1.5 overflow-hidden rounded-md border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-lg"
          >
            <div className="max-h-56 overflow-y-auto p-1">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    if (!ws.active) switchWorkspace(ws.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-black/5"
                >
                  <span className="flex-1 truncate">{ws.name}</span>
                  {ws.active && <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" strokeWidth={2.5} />}
                </button>
              ))}
            </div>

            <div className="border-t border-[var(--color-border-strong)] p-1">
              {creating ? (
                <div className="flex items-center gap-1.5 p-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate()
                      if (e.key === "Escape") setCreating(false)
                    }}
                    placeholder="Workspace name"
                    className="min-w-0 flex-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary)]"
                  />
                  <button
                    onClick={handleCreate}
                    className="shrink-0 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--color-on-primary)]"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-text)]"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  New workspace
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const location = useLocation()

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r-2 border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-primary)]">
            <Zap className="h-4.5 w-4.5 text-[var(--color-on-primary)]" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-[var(--font-display)] text-[15px] font-bold leading-tight">Reelmind</div>
            <div className="text-[11px] text-[var(--color-text-faint)]">Content Automation</div>
          </div>
        </div>

        <WorkspaceSwitcher />

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = location.pathname === item.to
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="relative flex items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              >
                {active && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-primary)]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <item.icon
                  className={"relative h-[18px] w-[18px] " + (active ? "text-[var(--color-on-primary)]" : "")}
                  strokeWidth={2.25}
                />
                <span className={"relative " + (active ? "text-[var(--color-on-primary)]" : "")}>
                  {item.label}
                </span>
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t-2 border-[var(--color-border-strong)] p-3">
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-text)]"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={2.25} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="ml-64 flex-1 px-10 py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
