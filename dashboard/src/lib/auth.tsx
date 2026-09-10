import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, ApiError } from "../api/client"

interface AuthState {
  status: "loading" | "authed" | "anon"
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading")

  const check = useCallback(async () => {
    try {
      await api.get("/auth/me")
      setStatus("authed")
    } catch {
      setStatus("anon")
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const login = useCallback(async (password: string) => {
    try {
      await api.post("/auth/login", { password })
      setStatus("authed")
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new Error("Login failed")
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post("/auth/logout")
    setStatus("anon")
  }, [])

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
