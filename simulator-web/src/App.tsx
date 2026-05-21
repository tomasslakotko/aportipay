import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { ShellLayout } from './components/ShellLayout'
import {
  AccountsModule,
  AdminModule,
  ClearanceModule,
  CommodityCodesModule,
  DocumentsModule,
  FlightInfoModule,
  FreightModule,
  FuelModule,
  LoginModule,
  LogoutModule,
  MessengerModule,
  PassengerModule,
  PlaceholderModule,
  ProfileModule,
  RampModule,
  SearchModule,
} from './modules/ModuleScreens'
import { SessionPersistence } from './persistence/SessionPersistence'
import { fetchRoleFromRoleTable, getAuthRole, supabaseAuth } from './persistence/authApi'
import { useSimulatorStore } from './store/useSimulatorStore'

const DEFAULT_ROLE = 'Ramp Agent'
const canAccessAdminByRole = (role: string) => /^(supervisor|admin)$/i.test(role.trim())
const resolveRole = (authRole: string) => (authRole || DEFAULT_ROLE).trim()

function RequireLogin() {
  const location = useLocation()
  const isLoggedIn = useSimulatorStore((store) => store.isLoggedIn)

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <ShellLayout />
}

function RequireAdminAccess({ children }: { children: ReactElement }) {
  const loginRole = useSimulatorStore((store) => store.loginRole)
  if (!canAccessAdminByRole(resolveRole(loginRole))) {
    return <Navigate to="/" replace />
  }
  return children
}

function AuthBootstrap() {
  const isLoggedIn = useSimulatorStore((store) => store.isLoggedIn)
  const login = useSimulatorStore((store) => store.login)
  const logout = useSimulatorStore((store) => store.logout)

  useEffect(() => {
    let mounted = true
    const applySession = async () => {
      const { data } = await supabaseAuth.auth.getSession()
      if (!mounted) return
      const user = data.session?.user
      if (user) {
        const fallbackName = user.email?.split('@')[0] || 'User'
        let resolvedRole: string | null = null
        try {
          resolvedRole = user.email ? await fetchRoleFromRoleTable(user.email) : null
        } catch {
          resolvedRole = null
        }
        if (!resolvedRole) resolvedRole = resolveRole(getAuthRole(user))
        login(fallbackName, resolveRole(resolvedRole))
      }
    }
    void applySession()
    const { data: sub } = supabaseAuth.auth.onAuthStateChange((event, session) => {
      const user = session?.user
      if (user) {
        const fallbackName = user.email?.split('@')[0] || 'User'
        const syncRole = async () => {
          let resolvedRole: string | null = null
          try {
            resolvedRole = user.email ? await fetchRoleFromRoleTable(user.email) : null
          } catch {
            resolvedRole = null
          }
          if (!resolvedRole) resolvedRole = resolveRole(getAuthRole(user))
          login(fallbackName, resolveRole(resolvedRole))
        }
        void syncRole()
      } else if (event === 'SIGNED_OUT') {
        logout()
      }
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [isLoggedIn, login, logout])

  return null
}

function App() {
  return (
    <>
      <AuthBootstrap />
      <SessionPersistence />
      <Routes>
        <Route path="/login" element={<LoginModule />} />
        <Route element={<RequireLogin />}>
          <Route path="/" element={<RampModule />} />
          <Route path="/search" element={<SearchModule />} />
          <Route path="/admin" element={<RequireAdminAccess><AdminModule /></RequireAdminAccess>} />
          <Route path="/accounts" element={<RequireAdminAccess><AccountsModule /></RequireAdminAccess>} />
          <Route path="/clearance" element={<ClearanceModule />} />
          <Route path="/documents" element={<DocumentsModule />} />
          <Route path="/messenger" element={<MessengerModule />} />
          <Route path="/passenger" element={<PassengerModule />} />
          <Route path="/fuel" element={<FuelModule />} />
          <Route path="/freight" element={<FreightModule />} />
          <Route path="/commodity-codes" element={<CommodityCodesModule />} />
          <Route path="/info" element={<FlightInfoModule />} />
          <Route path="/profile" element={<ProfileModule />} />
          <Route
            path="/contacts"
            element={
              <PlaceholderModule
                title="Contacts"
                description="Load controller and ramp coordination contact details."
              />
            }
          />
          <Route
            path="/about"
            element={
              <PlaceholderModule
                title="About"
                description="Application version and environment information."
              />
            }
          />
          <Route
            path="/report"
            element={
              <PlaceholderModule
                title="Report Issue"
                description="Capture simulator issue details for instructor review."
              />
            }
          />
          <Route
            path="/logout"
            element={<LogoutModule />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
