import { useEffect, useState } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { api } from "./api/client"
import { Spinner } from "./components/ui"
import { Shell } from "./components/Shell"
import { AuthProvider, useAuth } from "./lib/auth"
import { Login } from "./pages/Login"
import { Onboarding } from "./pages/Onboarding"
import { Dashboard } from "./pages/Dashboard"
import { Calendar } from "./pages/Calendar"
import { PostDetail } from "./pages/PostDetail"
import { Settings } from "./pages/Settings"

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
    </div>
  )
}

function AuthedApp() {
  const location = useLocation()
  const [brandExists, setBrandExists] = useState<boolean | null>(null)

  useEffect(() => {
    api.get<{ exists: boolean }>("/brand/exists").then((r) => setBrandExists(r.exists))
  }, [location.pathname === "/onboarding"])

  if (brandExists === null) return <FullScreenSpinner />

  if (!brandExists && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route
        path="/*"
        element={
          <Shell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/posts/:id" element={<PostDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        }
      />
    </Routes>
  )
}

function Root() {
  const { status } = useAuth()

  if (status === "loading") return <FullScreenSpinner />
  if (status === "anon") return <Login />
  return <AuthedApp />
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
