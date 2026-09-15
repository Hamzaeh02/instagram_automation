import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, ApiError } from "../api/client"

export interface CurrentUser {
  id: number
  email: string
}

interface AuthState {
  status: "loading" | "authed" | "anon"
  user: CurrentUser | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading")
  const [user, setUser] = useState<CurrentUser | null>(null)

  const check = useCallback(async () => {
    try {
      const me = await api.get<CurrentUser>("/auth/me")
      setUser(me)
      setStatus("authed")
    } catch {
      setUser(null)
      setStatus("anon")
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const me = await api.post<CurrentUser>("/auth/login", { email, password })
      setUser(me)
      setStatus("authed")
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new Error("Login failed")
    }
  }, [])

  const signup = useCallback(async (email: string, password: string) => {
    try {
      const me = await api.post<CurrentUser>("/auth/signup", { email, password })
      setUser(me)
      setStatus("authed")
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new Error("Signup failed")
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post("/auth/logout")
    setUser(null)
    setStatus("anon")
  }, [])

  return (
    <AuthContext.Provider value={{ status, user, login, signup, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
