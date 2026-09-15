import { motion } from "framer-motion"
import clsx from "clsx"
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react"

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("glass-card p-6", className)} {...rest}>
      {children}
    </div>
  )
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: {
  children: ReactNode
  variant?: "primary" | "ghost" | "danger" | "outline"
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none"
  const variants: Record<string, string> = {
    primary: "btn-primary shadow-lg shadow-violet-900/30",
    ghost: "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5",
    outline:
      "border border-[var(--color-border-strong)] text-[var(--color-text)] hover:bg-white/5",
    danger: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30",
  }
  return (
    <button className={clsx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-xl border border-[var(--color-border)] bg-white/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none transition focus:border-[var(--color-primary)] focus:bg-white/[0.05] focus:ring-2 focus:ring-violet-500/20",
        props.className,
      )}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-xl border border-[var(--color-border)] bg-white/[0.03] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none transition focus:border-[var(--color-primary)] focus:bg-white/[0.05] focus:ring-2 focus:ring-violet-500/20",
        props.className,
      )}
    />
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
      {children}
    </label>
  )
}

/** Same as Label, but with room for a trailing action (e.g. an AI-improve button). */
export function FieldLabelRow({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </label>
      {action}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            {eyebrow}
          </div>
        )}
        <h1 className="font-[var(--font-display)] text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-sm text-[var(--color-text-muted)]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}

export function FadeIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
