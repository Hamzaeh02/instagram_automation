import { motion } from "framer-motion"
import { LayoutDashboard, CalendarDays, Settings, LogOut, Zap, UploadCloud, Wand2 } from "lucide-react"
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
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b-2 border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border-2 border-[var(--color-border-strong)] bg-[var(--color-primary)]">
              <Zap className="h-4.5 w-4.5 text-[var(--color-on-primary)]" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-[var(--font-display)] text-[15px] font-bold leading-tight">Reelmind</div>
              <div className="text-[11px] text-[var(--color-text-faint)]">Content Automation</div>
            </div>
          </div>

          <nav className="flex flex-1 items-center gap-1">
            {NAV.map((item) => {
              const active = location.pathname === item.to
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                >
                  {active && (
                    <motion.div
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-md border-2 border-[var(--color-border-strong)] bg-[var(--color-primary)]"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    />
                  )}
                  <item.icon
                    className={"relative h-[16px] w-[16px] " + (active ? "text-[var(--color-on-primary)]" : "")}
                    strokeWidth={2.25}
                  />
                  <span className={"relative " + (active ? "text-[var(--color-on-primary)]" : "")}>
                    {item.label}
                  </span>
                </NavLink>
              )
            })}
          </nav>

          <button
            onClick={() => logout()}
            className="flex items-center gap-2 rounded-md border-2 border-transparent px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            <LogOut className="h-[16px] w-[16px]" strokeWidth={2.25} />
            Sign out
          </button>
        </div>
      </header>

      <main className="px-6 py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
