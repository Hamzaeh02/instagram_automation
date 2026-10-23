import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { api } from "./api/client"
import { Spinner } from "./components/ui"
import { Shell } from "./components/Shell"
import { AuthProvider, useAuth } from "./lib/auth"

// Route-level code splitting: Login/Signup pull in a full Three.js scene
// (Scene3D) that was previously bundled into the app's single main chunk -
// meaning every authenticated user paid for loading Three.js on every page
// load even though it's only ever rendered on the two auth pages. Splitting
// every page keeps that (and any future heavy page) out of the initial
// payload entirely; each page's JS loads only when actually navigated to.
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })))
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })))
const Signup = lazy(() => import("./pages/Signup").then((m) => ({ default: m.Signup })))
const Onboarding = lazy(() => import("./pages/Onboarding").then((m) => ({ default: m.Onboarding })))
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })))
const Analytics = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.Analytics })))
const ContentInsights = lazy(() => import("./pages/ContentInsights").then((m) => ({ default: m.ContentInsights })))
const Messages = lazy(() => import("./pages/Messages").then((m) => ({ default: m.Messages })))
const Competitors = lazy(() => import("./pages/Competitors").then((m) => ({ default: m.Competitors })))
const Calendar = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.Calendar })))
const Upload = lazy(() => import("./pages/Upload").then((m) => ({ default: m.Upload })))
const PostDetail = lazy(() => import("./pages/PostDetail").then((m) => ({ default: m.PostDetail })))
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })))

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-6 w-6 text-[var(--color-text-faint)]" />
    </div>
  )
}

function AnonRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
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
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          path="/*"
          element={
            <Shell>
              <Suspense fallback={<FullScreenSpinner />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/overview" element={<Dashboard />} />
                  <Route path="/dashboard" element={<Analytics />} />
                  <Route path="/insights" element={<ContentInsights />} />
                  <Route path="/messages" element={<Messages />} />
                  <Route path="/competitors" element={<Competitors />} />
                  <Route path="/upload" element={<Upload />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/posts/:id" element={<PostDetail />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Suspense>
            </Shell>
          }
        />
      </Routes>
    </Suspense>
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
