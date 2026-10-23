import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, ApiError } from "../api/client"
import type { Workspace } from "./types"

export interface CurrentUser {
  id: number
  email: string
}

interface AuthState {
  status: "loading" | "authed" | "anon"
  user: CurrentUser | null
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  switchWorkspace: (id: number) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  renameWorkspace: (id: number, name: string) => Promise<void>
  deleteWorkspace: (id: number) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading")
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  const refreshWorkspaces = useCallback(async () => {
    const data = await api.get<{ workspaces: Workspace[] }>("/workspaces")
    setWorkspaces(data.workspaces)
  }, [])

  const check = useCallback(async () => {
    try {
      const me = await api.get<CurrentUser>("/auth/me")
      setUser(me)
      setStatus("authed")
      await refreshWorkspaces()
    } catch {
      setUser(null)
      setWorkspaces([])
      setStatus("anon")
    }
  }, [refreshWorkspaces])

  useEffect(() => {
    check()
  }, [check])

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const me = await api.post<CurrentUser>("/auth/login", { email, password })
        setUser(me)
        setStatus("authed")
        await refreshWorkspaces()
      } catch (err) {
        if (err instanceof ApiError) throw err
        throw new Error("Login failed")
      }
    },
    [refreshWorkspaces],
  )

  const signup = useCallback(
    async (email: string, password: string) => {
      try {
        const me = await api.post<CurrentUser>("/auth/signup", { email, password })
        setUser(me)
        setStatus("authed")
        await refreshWorkspaces()
      } catch (err) {
        if (err instanceof ApiError) throw err
        throw new Error("Signup failed")
      }
    },
    [refreshWorkspaces],
  )

  const logout = useCallback(async () => {
    await api.post("/auth/logout")
    setUser(null)
    setWorkspaces([])
    setStatus("anon")
  }, [])

  // Which workspace is active lives in a cookie the server reads on every
  // request - the only way the rest of the app (posts, brand, connections,
  // activity) sees the new workspace's data is a full reload after
  // switching, rather than trying to invalidate every page's own fetches.
  const switchWorkspace = useCallback(async (id: number) => {
    await api.post(`/workspaces/${id}/activate`)
    window.location.reload()
  }, [])

  const createWorkspace = useCallback(async (name: string) => {
    await api.post("/workspaces", { name })
    window.location.reload()
  }, [])

  const renameWorkspace = useCallback(
    async (id: number, name: string) => {
      await api.patch(`/workspaces/${id}`, { name })
      await refreshWorkspaces()
    },
    [refreshWorkspaces],
  )

  const deleteWorkspace = useCallback(async (id: number) => {
    await api.delete(`/workspaces/${id}`)
    window.location.reload()
  }, [])

  const currentWorkspace = workspaces.find((w) => w.active) ?? null

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        workspaces,
        currentWorkspace,
        login,
        signup,
        logout,
        refreshWorkspaces,
        switchWorkspace,
        createWorkspace,
        renameWorkspace,
        deleteWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
