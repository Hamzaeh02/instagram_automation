import { motion } from "framer-motion"
import { LayoutDashboard, CalendarDays, Settings, LogOut, Zap, UploadCloud } from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { useAuth } from "../lib/auth"

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: UploadCloud },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/settings", label: "Settings", icon: Settings },
]

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
            className="flex w-full items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-text)]"
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
