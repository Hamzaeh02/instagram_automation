import { useEffect, useRef, useState } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { api } from "./api/client"
import { Spinner } from "./components/ui"
import { Shell } from "./components/Shell"
import { AuthProvider, useAuth } from "./lib/auth"
import { Login } from "./pages/Login"
import { Signup } from "./pages/Signup"
import { Onboarding } from "./pages/Onboarding"
import { Dashboard } from "./pages/Dashboard"
import { Calendar } from "./pages/Calendar"
import { Upload } from "./pages/Upload"
import { Create } from "./pages/Create"
import { PostDetail } from "./pages/PostDetail"
import { Settings } from "./pages/Settings"

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
    </div>
  )
}

function AnonRoutes() {
  return (
    <Routes>
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

interface BrandCheck {
  forOnboarding: boolean
  exists: boolean
}

function AuthedApp() {
  const location = useLocation()
  const onOnboardingNow = location.pathname === "/onboarding"
  const [check, setCheck] = useState<BrandCheck | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const thisRequest = ++requestId.current
    api.get<{ exists: boolean }>("/brand/exists").then((r) => {
      // Ignore if a newer check has since started, and tag the result with
      // which "side" (onboarding vs. app) it was computed for - the render
      // below only trusts a check computed for the side we're currently on.
      if (thisRequest === requestId.current) setCheck({ forOnboarding: onOnboardingNow, exists: r.exists })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOnboardingNow])

  if (location.pathname === "/login" || location.pathname === "/signup") {
    return <Navigate to="/" replace />
  }

  // A completed check only tells us something trustworthy about the side of
  // the onboarding boundary it was computed for. Right after navigating
  // across that boundary, the last completed check still describes the old
  // side for one render - treat that as "still loading" rather than making a
  // redirect decision on stale data (this previously bounced users back to
  // a blank onboarding form immediately after they'd just completed it).
  if (!check || check.forOnboarding !== onOnboardingNow) {
    return <FullScreenSpinner />
  }

  if (!check.exists && !onOnboardingNow) {
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
              <Route path="/upload" element={<Upload />} />
              <Route path="/create" element={<Create />} />
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
  if (status === "anon") return <AnonRoutes />
  return <AuthedApp />
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
