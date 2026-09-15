import { motion } from "framer-motion"
import { Lock, Mail, Sparkles } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { ApiError } from "../api/client"
import { Button, Input, Label } from "../components/ui"
import { Scene3D } from "../components/Scene3D"
import { useAuth } from "../lib/auth"

export function Signup() {
  const { signup } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signup(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <Scene3D />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card relative w-full max-w-sm p-8"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-from)] to-[var(--color-accent-to)] shadow-lg shadow-violet-900/40">
            <Sparkles className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="font-[var(--font-display)] text-2xl font-bold">
            Create your <span className="gradient-text">Reelmind</span> account
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Upload &amp; schedule your own content, or generate it with AI — all included.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label>Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
              <Input
                type="email"
                autoFocus
                className="pl-10"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
              <Input
                type="password"
                className="pl-10"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-rose-400">
              {error}
            </motion.p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-[var(--color-primary)] hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
