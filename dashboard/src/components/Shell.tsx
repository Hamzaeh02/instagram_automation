import { motion } from "framer-motion"
import { LayoutDashboard, CalendarDays, Settings, LogOut, Sparkles, UploadCloud, Wand2 } from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { useAuth } from "../lib/auth"

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: UploadCloud },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/create", label: "Create with AI", icon: Wand2 },
  { to: "/settings", label: "Settings", icon: Settings },
]

export function Shell({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const location = useLocation()

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]/80 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)] shadow-lg shadow-violet-900/40">
            <Sparkles className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-[var(--font-display)] text-[15px] font-bold leading-tight">Reelmind</div>
            <div className="text-[11px] text-[var(--color-text-faint)]">Content Automation</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = location.pathname === item.to
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              >
                {active && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/10"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <item.icon className={"relative h-[18px] w-[18px] " + (active ? "text-[var(--color-primary)]" : "")} strokeWidth={2} />
                <span className="relative">{item.label}</span>
                {active && (
                  <span className="relative ml-auto h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-[var(--color-border)] p-3">
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-text)]"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
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
