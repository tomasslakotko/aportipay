import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAdminUser, listAdminUsers, resetAdminUserPassword, updateAdminUserRole } from '../persistence/adminUserApi'
import {
  ensureAuthRole,
  fetchRoleFromRoleTable,
  getAuthRole,
  saveRoleToRoleTable,
  signInWithEmail,
  signOutAuth,
  signUpWithEmail,
} from '../persistence/authApi'
import { publishChatMessage, sendChatMessage, useLiveChat } from '../persistence/chatApi'
import { reopenFlightGlobally, useLiveFlightClosures } from '../persistence/flightClosureApi'
import { playNotificationSound, type NotificationSoundPreset } from '../persistence/notificationSound'
import { calculateBalance } from '../engine/simulatorEngine'
import type { AdminFlight, NewAdminFlight } from '../persistence/flightApi'
import {
  loadAaLidsPassengerState,
  resolveAaLidsFlightId,
} from '../persistence/aaLidsPassengerSync'
import {
  fetchPassengerAcceptanceFinalised,
  setPassengerAcceptanceFinalised,
  subscribePassengerAcceptanceFinalised,
} from '../persistence/passengerAcceptance'
import { isFirebaseConfigured, subscribeCollection, FIRESTORE_COLLECTIONS } from '../persistence/firebaseClient'
import { createFlight as createAdminFlight, deleteFlight, useLiveFlights } from '../persistence/flightApi'
import { createFlightState, createPassengerState, useSimulatorStore } from '../store/useSimulatorStore'

const loginRoles = [
  'Ramp Agent',
  'Passenger Agent',
  'Freight Agent',
  'Fuel Agent',
  'Load Controller',
  'Check-in',
  'Supervisor',
  'Admin',
]
const messageRecipients = ['Ramp', 'Check-in', 'Supervisor', 'Load Controller']
const defaultChatShortCommands = [
  { label: 'PLS', text: 'PLEASE SEND NEW LOADSHEET.' },
  { label: 'ETD?', text: 'PLEASE CONFIRM ETD.' },
  { label: 'STBY', text: 'STANDBY. WILL UPDATE SHORTLY.' },
  { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
]
const roleChatShortcuts: Record<string, { label: string; text: string }[]> = {
  'ramp agent': [
    { label: 'PLS', text: 'PLEASE SEND NEW LOADSHEET.' },
    { label: 'CLR?', text: 'PLEASE CONFIRM RAMP CLEAR STATUS.' },
    { label: 'OFF', text: 'OFFLOAD ITEM CONFIRMED.' },
    { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
  ],
  'load controller': [
    { label: 'LSENT', text: 'NEW LOADSHEET SENT.' },
    { label: 'TRIM', text: 'TRIM UPDATE APPLIED. PLEASE REVIEW.' },
    { label: 'HOLD', text: 'HOLD POSITION UPDATE REQUIRED.' },
    { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
  ],
  'freight agent': [
    { label: 'FRT', text: 'FREIGHT ACCEPTANCE UPDATED.' },
    { label: 'ULD', text: 'ULD POSITION CONFIRMED.' },
    { label: 'WT', text: 'WEIGHT UPDATED IN SYSTEM.' },
    { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
  ],
  'fuel agent': [
    { label: 'FUEL', text: 'FUEL FIGURES UPDATED.' },
    { label: 'DENS', text: 'FUEL DENSITY CONFIRMED.' },
    { label: 'DONE', text: 'FUELING COMPLETE.' },
    { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
  ],
  'passenger agent': [
    { label: 'PAX', text: 'PASSENGER COUNT UPDATED.' },
    { label: 'BAGS', text: 'BAGGAGE COUNT UPDATED.' },
    { label: 'FINAL', text: 'PASSENGER ACCEPTANCE FINALIZED.' },
    { label: 'RCVD', text: 'RECEIVED. THANK YOU.' },
  ],
}
const priorityForRecipient = (recipient: string) => {
  if (recipient === 'Ramp' || recipient === 'Supervisor') return 'high'
  if (recipient === 'Check-in') return 'low'
  return 'medium'
}
const priorityLabel = (priority = 'medium') => `${priority.toUpperCase()} PRIORITY`
const formatMessageTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const getShortCommandsForRole = (role: string) => roleChatShortcuts[role.toLowerCase()] ?? defaultChatShortCommands
const DEFAULT_REGISTER_ROLE = 'Ramp Agent'

export function LoginModule() {
  const navigate = useNavigate()
  const { isLoggedIn, login } = useSimulatorStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isLoggedIn) navigate('/search', { replace: true })
  }, [isLoggedIn, navigate])

  const completeLocalLogin = (resolvedRole: string) => {
    const fallbackName = email.split('@')[0] || 'User'
    login(fallbackName, resolvedRole)
    navigate('/search', { replace: true })
  }

  const submitLogin = async () => {
    if (!email.trim() || !password.trim()) return
    setBusy(true)
    setError('')
    try {
      const signInData = await signInWithEmail(email.trim(), password)
      let resolvedRole: string | null = null
      try {
        resolvedRole = await fetchRoleFromRoleTable(email.trim())
      } catch {
        resolvedRole = null
      }
      if (!resolvedRole) resolvedRole = getAuthRole(signInData.user)
      if (!resolvedRole) resolvedRole = await ensureAuthRole(DEFAULT_REGISTER_ROLE)
      try {
        resolvedRole = await saveRoleToRoleTable(email.trim(), resolvedRole)
      } catch {
        // Keep login working even if role table API is temporarily unavailable.
      }
      completeLocalLogin(resolvedRole)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const submitSignup = async () => {
    if (!email.trim() || !password.trim()) return
    setBusy(true)
    setError('')
    try {
      await signUpWithEmail(email.trim(), password, DEFAULT_REGISTER_ROLE)
      const signInData = await signInWithEmail(email.trim(), password)
      let resolvedRole = getAuthRole(signInData.user) || DEFAULT_REGISTER_ROLE
      try {
        resolvedRole = await saveRoleToRoleTable(email.trim(), resolvedRole)
      } catch {
        // Keep signup/login working even if role table API is temporarily unavailable.
      }
      completeLocalLogin(resolvedRole)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span>a</span>
          <div>
            <strong>Ramp Training System</strong>
            <p>iPad simulator login</p>
          </div>
        </div>
        <div className="login-form">
          <label>
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              type="email"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="At least 6 characters"
              type="password"
            />
          </label>
          {error ? <p className="login-note">{error}</p> : null}
          <button type="button" disabled={busy || !email.trim() || !password.trim()} onClick={() => void submitLogin()}>
            {busy ? 'Please wait...' : 'Login'}
          </button>
          <button type="button" disabled={busy || !email.trim() || !password.trim()} onClick={() => void submitSignup()}>
            {busy ? 'Please wait...' : 'Create account'}
          </button>
        </div>
        <p className="login-note">Account role is fixed at registration by system policy.</p>
      </section>
    </main>
  )
}

export function LogoutModule() {
  const navigate = useNavigate()
  const logout = useSimulatorStore((store) => store.logout)

  useEffect(() => {
    const run = async () => {
      try {
        await signOutAuth()
      } catch {}
      logout()
      navigate('/login', { replace: true })
    }
    void run()
  }, [logout, navigate])

  return null
}

export function RampModule() {
  const { state, openFlights, moveCommodity, offloadCommodity, onloadCommodity, clearHold, addFreight } = useSimulatorStore()
  const [mode, setMode] = useState('Move')
  const [zoom, setZoom] = useState(false)
  const [dialog, setDialog] = useState<'bagVar' | 'modify' | 'move' | 'swap' | 'offload' | 'dgsl' | null>(null)
  const [offloadPanelOpen, setOffloadPanelOpen] = useState(false)
  const [offloadedItems, setOffloadedItems] = useState<string[]>([])
  const [rampAddOpen, setRampAddOpen] = useState(false)
  const [rampAddHoldId, setRampAddHoldId] = useState('cpt1')
  const [rampBulkId, setRampBulkId] = useState('AKE987656X')
  const [rampCommodityType, setRampCommodityType] = useState('FRT')
  const [rampDestination, setRampDestination] = useState(state.route.split('-')[1] ?? 'LAX')
  const [rampWeight, setRampWeight] = useState(80)
  const [rampDescription, setRampDescription] = useState('')
  const lastHoldTap = useRef<{ holdId: string; time: number } | null>(null)
  const loadLongPressTimer = useRef<number | undefined>(undefined)
  const [selectedCommodityId, setSelectedCommodityId] = useState<string | null>(
    state.commodities[0]?.id ?? null,
  )
  const byHold = state.holds.map((hold) => ({
    hold,
    items: state.commodities.filter((item) => item.locationId === hold.id && item.status === 'loaded'),
  }))
  const totalLoaded = state.commodities
    .filter((item) => item.status === 'loaded')
    .reduce((sum, item) => sum + item.weightKg, 0)
  const totalCapacity = state.holds.reduce((sum, hold) => sum + hold.maxWeightKg, 0)
  const selectedCommodity = state.commodities.find(
    (commodity) => commodity.id === selectedCommodityId,
  )
  const balance = calculateBalance(state)

  useEffect(() => {
    return () => window.clearTimeout(loadLongPressTimer.current)
  }, [])

  const openRampAddDialog = (holdId: string) => {
    setRampAddHoldId(holdId)
    setRampAddOpen(true)
  }

  const handleHoldTap = (holdId: string) => {
    const now = Date.now()
    if (lastHoldTap.current?.holdId === holdId && now - lastHoldTap.current.time < 360) {
      openRampAddDialog(holdId)
      lastHoldTap.current = null
      return
    }
    lastHoldTap.current = { holdId, time: now }
  }

  const saveRampFreight = () => {
    addFreight(`${rampCommodityType} ${rampBulkId} ${rampDestination} ${rampDescription}`.trim(), rampWeight, rampAddHoldId)
    setRampAddOpen(false)
    setMode('Move')
  }

  if (openFlights.length === 0) {
    return (
      <section className="module-card ramp-screen no-active-flight">
        <h3>No Active Flight</h3>
        <p>Open a real flight from Search first. Ramp data will appear only for the selected flight.</p>
      </section>
    )
  }

  return (
    <section className={zoom ? 'module-card ramp-screen zoomed' : 'module-card ramp-screen'}>
      <div className="ramp-topline">
        <span>AFT ({totalLoaded} of {totalCapacity} kg)</span>
        <span className="ramp-divider" />
        <span>FWD ({byHold[1]?.items.reduce((sum, item) => sum + item.weightKg, 0) ?? 0} kg planned)</span>
        <span className={`balance-pill ${balance.status}`}>{balance.label}: {balance.index.toFixed(2)}</span>
        <span>Mode: {mode}</span>
      </div>
      <div className="ramp-board">
        <div className="ramp-area">
          <div className="ramp-group-grid">
            <div className="ramp-group aft-group">AFT Holds</div>
            <div className="ramp-group fwd-group">FWD Holds</div>
          </div>
          <div className={zoom ? 'ramp-columns ramp-zoom-grid' : 'ramp-columns'}>
          {byHold.map(({ hold, items }) => {
            const totalWeight = items.reduce((sum, item) => sum + item.weightKg, 0)
            const percent = Math.min(100, Math.round((totalWeight / hold.maxWeightKg) * 100))
            return (
              <article
                key={hold.id}
                className={[
                  zoom ? 'hold-column zoom-hold' : 'hold-column',
                  mode === 'Ramp Clear' ? 'clearable-hold' : '',
                  state.rampClearedHoldIds.includes(hold.id) ? 'ramp-cleared-hold' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  if (mode === 'Ramp Clear') clearHold(hold.id)
                }}
                onDoubleClick={() => openRampAddDialog(hold.id)}
                onTouchEnd={() => handleHoldTap(hold.id)}
              >
                <header className="hold-header">
                  <h4>{hold.name}</h4>
                  <p>
                    {totalWeight} / {hold.maxWeightKg} kg
                  </p>
                </header>
                <div className="hold-meter">
                  <div className="hold-meter-fill" style={{ width: `${percent}%` }} />
                </div>
                <div className="hold-items">
                  {items.length === 0 ? (
                    <div className="hold-empty" />
                  ) : (
                    items.map((item) => (
                      <div
                        className={selectedCommodity?.id === item.id ? 'hold-item selected-load' : 'hold-item'}
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (mode === 'Ramp Clear') return
                          window.clearTimeout(loadLongPressTimer.current)
                          setSelectedCommodityId(item.id)
                        }}
                        onTouchStart={(event) => {
                          event.stopPropagation()
                          window.clearTimeout(loadLongPressTimer.current)
                          loadLongPressTimer.current = window.setTimeout(() => {
                            if (mode === 'Ramp Clear') return
                            setSelectedCommodityId(item.id)
                            setDialog('modify')
                          }, 650)
                        }}
                        onTouchEnd={() => window.clearTimeout(loadLongPressTimer.current)}
                        onTouchMove={() => window.clearTimeout(loadLongPressTimer.current)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && mode !== 'Ramp Clear') setSelectedCommodityId(item.id)
                        }}
                      >
                        <div>
                          <strong>{item.code}</strong> {item.weightKg} kg
                          <span className="dest-flag">LAX</span>
                          <span className="priority-pill">45</span>
                          <p>{item.label}</p>
                        </div>
                        <div className="row-actions">
                          <button onClick={() => moveCommodity(item.id, 'cpt1')}>CPT1</button>
                          <button onClick={() => moveCommodity(item.id, 'cpt2')}>CPT2</button>
                          <button onClick={() => moveCommodity(item.id, 'cpt3')}>CPT3</button>
                          <button onClick={() => moveCommodity(item.id, 'cpt4')}>CPT4</button>
                          <button onClick={() => offloadCommodity(item.id)}>Off</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {state.rampClearedHoldIds.includes(hold.id) ? (
                  <span className="ramp-clear-mark">✓</span>
                ) : null}
              </article>
            )
          })}
          </div>
        </div>
        <aside className="ramp-actions">
          {['Move', 'Ramp Clear', 'Add', 'Zoom', `Off (${offloadedItems.length})`, 'Swap (0)', 'SI (1)', 'Bag Var', 'Ramp Summ'].map((tab) => (
            <button
              key={tab}
              className={mode === tab ? 'active-tab' : ''}
              onClick={() => {
                setMode(tab)
                if (tab === 'Zoom') setZoom((current) => !current)
                if (tab === 'Bag Var') setDialog('bagVar')
                if (tab === 'Swap (0)') setDialog('swap')
                if (tab.startsWith('Off')) setOffloadPanelOpen((open) => !open)
                if (tab === 'SI (1)') setDialog('dgsl')
              }}
            >
              {tab}
            </button>
          ))}
          <div className="ramp-note">
            <p>Tip: use move buttons inside each cargo card to rebalance holds.</p>
          </div>
          {mode === 'Ramp Clear' ? (
            <button className="save-clear-button" type="button">
              Save
            </button>
          ) : null}
        </aside>
      </div>
      {selectedCommodity ? (
        <aside className="deadload-panel">
          <header>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setSelectedCommodityId(null)
              }}
            >
              ×
            </button>
            <strong>{selectedCommodity.locationId.toUpperCase()}</strong>
          </header>
          <div className="deadload-uld">AKE{selectedCommodity.id.slice(-3).toUpperCase()}76X</div>
          <dl>
            <dt>Gross Weight</dt>
            <dd>{selectedCommodity.weightKg + 70}</dd>
            <dt>Tare Weight</dt>
            <dd>70</dd>
            <dt>Net Weight</dt>
            <dd>{selectedCommodity.weightKg}</dd>
          </dl>
          <textarea aria-label="Deadload description" placeholder="Description" />
          <div className="deadload-item-row">
            <span className="commodity-badge">{selectedCommodity.code}</span>
            <span>{selectedCommodity.weightKg} kg</span>
            <span className="dest-flag">LAX</span>
            <span>Priority <b>45</b></span>
          </div>
          <button className="deadload-edit" type="button" onClick={() => setDialog('modify')}>
            Modify
          </button>
          <button className="deadload-move" type="button" onClick={() => setDialog('move')}>
            Move
          </button>
          <button className="deadload-offload" type="button" onClick={() => setDialog('offload')}>
            Offload
          </button>
          <button className="deadload-add" type="button">+</button>
        </aside>
      ) : null}
      {rampAddOpen ? (
        <div className="modal-backdrop" role="dialog" aria-label="Add freight from ramp">
          <div className="freight-modal ramp-add-freight-modal">
            <header><strong>Add ULD / Bulk to {rampAddHoldId.toUpperCase()}</strong><button type="button" onClick={() => setRampAddOpen(false)}>×</button></header>
            <label className="bulk-id-row">Bulk/ULD ID<input value={rampBulkId} onChange={(event) => setRampBulkId(event.target.value.toUpperCase())} /><span>{rampAddHoldId.toUpperCase()} selected</span></label>
            <div className="location-picks">
              {state.holds.map((hold) => (
                <button key={hold.id} type="button" className={rampAddHoldId === hold.id ? 'selected' : ''} onClick={() => setRampAddHoldId(hold.id)}>{hold.name}</button>
              ))}
            </div>
            <div className="modify-grid">
              <label>Type<input value={rampCommodityType} onChange={(event) => setRampCommodityType(event.target.value.toUpperCase())} /></label>
              <label>Destination<input value={rampDestination} onChange={(event) => setRampDestination(event.target.value.toUpperCase())} /></label>
              <label>Gross Weight<input type="number" value={rampWeight} onChange={(event) => setRampWeight(Number(event.target.value))} /></label>
              <label>Description<textarea value={rampDescription} onChange={(event) => setRampDescription(event.target.value)} /></label>
            </div>
            <footer><button type="button" onClick={() => setRampAddOpen(false)}>Cancel</button><button type="button" onClick={saveRampFreight}>Save</button></footer>
          </div>
        </div>
      ) : null}
      {offloadPanelOpen ? (
        <aside className="offload-panel">
          <header>
            <button type="button" onClick={() => setOffloadPanelOpen(false)}>×</button>
            <strong>OFFLOADED</strong>
          </header>
          {offloadedItems.length === 0 ? (
            <p className="empty-offload">No offloaded items.</p>
          ) : (
            offloadedItems.map((itemId) => {
              const item = state.commodities.find((commodity) => commodity.id === itemId)
              if (!item) return null
              return (
                <div className="offload-card" key={itemId}>
                  <strong>Standby</strong>
                  <p>Awaiting confirmation</p>
                  <span className="commodity-badge">{item.code}</span>
                  <span>{item.weightKg} kg</span>
                  <span className="dest-flag">SIN</span>
                  <button
                    type="button"
                    onClick={() => {
                      onloadCommodity(item.id)
                      setOffloadedItems((items) => items.filter((id) => id !== item.id))
                    }}
                  >
                    Onload
                  </button>
                </div>
              )
            })
          )}
        </aside>
      ) : null}
      {dialog === 'bagVar' ? (
        <div className="ramp-modal small-modal">
          <header>
            <button onClick={() => setDialog(null)}>×</button>
            <strong>Baggage Variation</strong>
          </header>
          <table>
            <thead>
              <tr><th>Item</th><th>FM Recorded</th><th>Accepted</th><th>Variation</th></tr>
            </thead>
            <tbody>
              <tr><td>Total Baggage</td><td>484 pcs<br />9981 kg</td><td>496 pcs<br />10276 kg</td><td>-12 pcs<br />-245 kg</td></tr>
              <tr><td>BKO</td><td>433 pcs</td><td>443 pcs</td><td>-10 pcs</td></tr>
              <tr><td>BT1</td><td>0 pcs</td><td>0 pcs</td><td>0 pcs</td></tr>
              <tr><td>BB</td><td>352 pcs</td><td>358 pcs</td><td>-6 pcs</td></tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {dialog === 'modify' && selectedCommodity ? (
        <div className="ramp-modal modify-modal">
          <header>
            <strong>Modify Commodity</strong>
            <button onClick={() => setDialog(null)}>×</button>
          </header>
          <label>Type <span className="commodity-badge">{selectedCommodity.code}</span></label>
          <label>Destination <select defaultValue="LAX"><option>LAX</option><option>SIN</option></select></label>
          <label>Weight <input type="number" defaultValue={selectedCommodity.weightKg} /></label>
          <label><input type="checkbox" /> Estimated</label>
          <label><input type="checkbox" defaultChecked /> Finalized</label>
          <textarea placeholder="Description" />
          <footer>
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button onClick={() => setDialog(null)}>Update</button>
          </footer>
        </div>
      ) : null}
      {dialog === 'offload' && selectedCommodity ? (
        <div className="ramp-modal offload-modal">
          <header>
            <strong>Offload {selectedCommodity.id.toUpperCase()}</strong>
            <button onClick={() => setDialog(null)}>×</button>
          </header>
          <p>This item will be offloaded. Select a reason and add a short comment.</p>
          <label>
            Reason
            <select defaultValue="weight">
              <option value="weight">Due to weight restrictions</option>
              <option value="missing">Missing at aircraft side</option>
              <option value="damaged">Damaged ULD / pallet insecure</option>
              <option value="standby">Standby, awaiting confirmation</option>
            </select>
          </label>
          <label>
            Comments
            <textarea defaultValue="Offload action" />
          </label>
          <footer>
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button
              onClick={() => {
                offloadCommodity(selectedCommodity.id)
                setOffloadedItems((items) => [selectedCommodity.id, ...items])
                setSelectedCommodityId(null)
                setOffloadPanelOpen(true)
                setDialog(null)
              }}
            >
              Offload
            </button>
          </footer>
        </div>
      ) : null}
      {dialog === 'move' && selectedCommodity ? (
        <div className="ramp-modal move-modal">
          <header>
            <strong>Move Load</strong>
            <button onClick={() => setDialog(null)}>×</button>
          </header>
          <div className="move-cols">
            <div>
              <h4>Items to Move</h4>
              <p><span className="commodity-badge">{selectedCommodity.code}</span> {selectedCommodity.weightKg} kg <span className="dest-flag">LAX</span></p>
            </div>
            <div>
              <h4>Move To</h4>
              {state.holds.map((hold) => (
                <button key={hold.id} onClick={() => { moveCommodity(selectedCommodity.id, hold.id); setDialog(null) }}>
                  {hold.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {dialog === 'swap' ? (
        <div className="ramp-modal swap-modal">
          <header>
            <button onClick={() => setDialog(null)}>×</button>
            <strong>Swap List</strong>
          </header>
          {state.commodities.slice(0, 4).map((commodity) => (
            <div className="swap-row" key={commodity.id}>
              <span className="commodity-badge">{commodity.code}</span>
              <span>{commodity.weightKg} kg</span>
              <span className="dest-flag">LAX</span>
              <button onClick={() => setSelectedCommodityId(commodity.id)}>Select</button>
            </div>
          ))}
        </div>
      ) : null}
      {dialog === 'dgsl' ? (
        <div className="ramp-modal dgsl-modal">
          <header>
            <button onClick={() => setDialog(null)}>×</button>
            <strong>DG/SL Information</strong>
          </header>
          <table>
            <thead>
              <tr><th>Position</th><th>ULD/Bulk</th><th>Detailed Data</th><th>By Commodity</th></tr>
            </thead>
            <tbody>
              <tr><td>21L</td><td>AKE102X</td><td>RRY / RPB / RCM / 10.5</td><td><span className="commodity-badge">C</span> 200</td></tr>
              <tr><td>23P</td><td>PLP72X</td><td>ELI / 5 / 20</td><td><span className="commodity-badge">C</span> 250</td></tr>
              <tr><td>BLK</td><td>Bulk</td><td>AVI / 1 / 2</td><td><span className="commodity-badge">M</span> 30</td></tr>
            </tbody>
          </table>
          <footer>
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button onClick={() => setDialog(null)}>Update</button>
          </footer>
        </div>
      ) : null}
    </section>
  )
}

export function ClearanceModule() {
  const { state, clearHold } = useSimulatorStore()
  const [showSummary, setShowSummary] = useState(false)
  const [acceptedRows, setAcceptedRows] = useState<string[]>([])
  const clearedCount = state.rampClearedHoldIds.length
  return (
    <section className="module-card">
      <h3>Ramp Clearance</h3>
      <p>Ramp-cleared positions are shown with a green tick marker.</p>
      {state.holds.map((hold) => (
        <div className={state.rampClearedHoldIds.includes(hold.id) ? 'row cleared-row' : 'row'} key={hold.id}>
          <span>{hold.name}</span>
          <button onClick={() => clearHold(hold.id)}>
            {state.rampClearedHoldIds.includes(hold.id) ? 'Cleared' : 'Clear Hold'}
          </button>
        </div>
      ))}
      <div className="row">
        <strong>Cleared: {clearedCount}/{state.holds.length}</strong>
        <button onClick={() => setShowSummary((open) => !open)}>Ramp Summary</button>
      </div>
      {showSummary ? (
        <div className="ramp-summary-panel">
          <h4>Ramp Summary</h4>
          <table>
            <thead>
              <tr><th>Location</th><th>Commodity</th><th>Planned</th><th>Reported</th><th>Accepted</th></tr>
            </thead>
            <tbody>
              {state.commodities.slice(0, 4).map((commodity) => (
                <tr key={commodity.id}>
                  <td>{commodity.locationId.toUpperCase()}</td>
                  <td>{commodity.code}</td>
                  <td>{commodity.weightKg} kg</td>
                  <td>{commodity.weightKg + 20} kg</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={acceptedRows.includes(commodity.id)}
                      onChange={() =>
                        setAcceptedRows((rows) =>
                          rows.includes(commodity.id)
                            ? rows.filter((id) => id !== commodity.id)
                            : [...rows, commodity.id],
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => setAcceptedRows([])}>Reset</button>
            <button>Confirm</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function DocumentsModule() {
  const { state, profile } = useSimulatorStore()
  const [activeDocId, setActiveDocId] = useState('lir')
  const [sendPanelOpen, setSendPanelOpen] = useState(false)
  const [siPanelOpen, setSiPanelOpen] = useState(false)
  const [sentNote, setSentNote] = useState('')
  const [siText, setSiText] = useState('DANGEROUS GOODS / SPECIAL LOAD COMMENTS\nRCK/PTR, RFL/2')
  const activeDocTitle = activeDocId === 'fcs'
    ? 'Final Cargo Summary Message'
    : activeDocId === 'glir'
      ? 'Graphical LIR'
      : activeDocId === 'vlir'
        ? 'Vertical Graphical LIR'
        : 'Load Instruction Report'
  const totalFreight = state.commodities.reduce((sum, item) => sum + item.weightKg, 0)
  const reportText = `LOADING INSTRUCTION/REPORT   PREPARED BY ${profile.firstName} ${profile.surname}      EDNO
ALL WEIGHTS IN KG                                             2
FROM/TO FLIGHT  A/C REG   VERSION   GATE TARMAC   DATE     TIME
${state.route.padEnd(12)} ${state.flightNo.padEnd(8)} 747-438ER GTE B27     01JAN18  1045
PLANNED JOINING LOAD
${state.route.split('-')[1] ?? 'LAX'}    P 0      J 11      Y 90       C ${Math.max(totalFreight, 0)}    M 70
JOINING SPECS:   SEE SUMMARY
TRANSIT SPECS:   SEE SUMMARY
RELOADS:

                                             ACTUAL
LOADING INSTRUCTION                          WEIGHT
************************************************************
CPT 1     MAX 08798
:${state.commodities.filter((item) => item.locationId === 'cpt1').map((item) => `${item.code} ${item.weightKg}KG ${item.label}`).join('\n:') || 'NO FIT'}
:
:
------------------------------------------------------------
:13L                         :13R                         : D
:NO FIT                      :NO FIT                      : O
:                            :                            : O
:                            :                CPT  1 TOTAL: R
************************************************************
CPT 2     MAX 12696
${state.commodities.filter((item) => item.locationId === 'cpt2').map((item) => `:${item.code.padEnd(4)} ${item.weightKg}KG ${item.label}`).join('\n') || ':NOLOAD: LAX C/420'}
:
************************************************************
CPT 3     MAX 13600
${state.commodities.filter((item) => item.locationId === 'cpt3').map((item) => `:${item.code.padEnd(4)} ${item.weightKg}KG ${item.label}`).join('\n') || ':NO FIT'}
:
************************************************************
CPT 4     MAX 0700
${state.commodities.filter((item) => item.locationId === 'cpt4').map((item) => `:${item.code.padEnd(4)} ${item.weightKg}KG ${item.label}`).join('\n') || ':NO FIT'}
:
${siText}`

  return (
    <section className="module-card documents-module">
      <div className="docs-workspace">
        <article className="doc-report">
          <pre>{activeDocId === 'lir' ? reportText : `${activeDocTitle}\n\n${reportText}`}</pre>
        </article>
        <aside className={sendPanelOpen ? 'doc-side-panel send-open' : 'doc-side-panel'}>
          <button className="doc-close" type="button" onClick={() => { setSendPanelOpen(false); setSiPanelOpen(false) }}>×</button>
          {sendPanelOpen ? (
            <div className="send-to-panel">
              <h4>{activeDocTitle}</h4>
              <label><input type="checkbox" defaultChecked /> Location <select defaultValue="Airpc"><option>Airpc</option><option>Terminal</option></select><input defaultValue="LHR" /></label>
              <label><input type="checkbox" defaultChecked /> TTY <input defaultValue="LHRKLXH" /></label>
              <label><input type="checkbox" /> Printer <input disabled /></label>
              <label><input type="checkbox" defaultChecked /> Email <input defaultValue="ops@6x.com" /></label>
              <button
                type="button"
                onClick={() => {
                  setSentNote(`${activeDocTitle} sent.`)
                  setSendPanelOpen(false)
                }}
              >
                Send
              </button>
            </div>
          ) : siPanelOpen ? (
            <div className="send-to-panel">
              <h4>Supplementary Information</h4>
              <textarea value={siText} onChange={(event) => setSiText(event.target.value)} />
              <button type="button" onClick={() => setSiPanelOpen(false)}>Update</button>
            </div>
          ) : (
            <nav className="doc-selector">
              {[
                ['fcs', 'Final Cargo Summary Message'],
                ['glir', 'Graphical LIR'],
                ['lir', 'Load Instruction Report'],
                ['vlir', 'Vertical Graphical LIR'],
              ].map(([id, label]) => (
                <button key={id} type="button" className={activeDocId === id ? 'active-doc-tab' : ''} onClick={() => setActiveDocId(id)}>
                  {label}
                </button>
              ))}
            </nav>
          )}
        </aside>
        <div className="doc-action-rail">
          <button type="button" className="rail-tab active">Docs</button>
          <button type="button" className="rail-tab" onClick={() => setSendPanelOpen(true)}>Send To</button>
          <button type="button" className="rail-tab" onClick={() => setSiPanelOpen(true)}>SI (4)</button>
          <button type="button" className="rail-back">‹</button>
        </div>
      </div>
      {sentNote ? <p className="docs-sent-note">{sentNote}</p> : null}
    </section>
  )
}

export function MessengerModule() {
  const {
    profile,
    loginRole,
    subscribedFlights,
    openFlights,
    flightStates,
    activeFlightIndex,
  } = useSimulatorStore()
  const [text, setText] = useState('')
  const [recipient, setRecipient] = useState('Ramp')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('high')
  const { flights: liveFlights } = useLiveFlights()
  const { closures } = useLiveFlightClosures()
  const globallyClosedLabels = new Set(closures.map((closure) => closure.flightLabel))
  const liveFlightLabels = liveFlights
    .filter((flight) => !globallyClosedLabels.has(formatSearchFlight(flight)))
    .map(formatSearchFlight)
  const activeFlight = openFlights[activeFlightIndex] ?? ''
  const roleForPermissions = (loginRole || '').toLowerCase()
  const canSeeAllChats = /admin|load control|load controller|supervisor/.test(roleForPermissions)
  const visibleFlights = (canSeeAllChats
    ? [...new Set([...liveFlightLabels, ...openFlights, ...subscribedFlights, ...Object.keys(flightStates)])]
    : activeFlight
      ? [activeFlight]
      : []
  ).filter((flightLabel) => !globallyClosedLabels.has(flightLabel))
  const [selectedFlight, setSelectedFlight] = useState(activeFlight)
  const { messages: selectedMessages, error: chatError, refresh } = useLiveChat(selectedFlight, Boolean(selectedFlight))
  const shortCommands = getShortCommandsForRole(profile.role)
  const lastMessageTap = useRef<{ id: string; time: number } | null>(null)

  useEffect(() => {
    if (!selectedFlight || !visibleFlights.includes(selectedFlight)) {
      setSelectedFlight(visibleFlights[0] ?? '')
    }
  }, [selectedFlight, visibleFlights])

  const selectRecipient = (nextRecipient: string) => {
    setRecipient(nextRecipient)
    setPriority(priorityForRecipient(nextRecipient) as 'low' | 'medium' | 'high')
  }

  const markPublished = (messageId: string) => {
    if (!selectedFlight) return
    void publishChatMessage(messageId)
      .then(() => refresh())
      .catch(() => {})
  }

  const handleMessageTap = (messageId: string) => {
    const now = Date.now()
    if (lastMessageTap.current?.id === messageId && now - lastMessageTap.current.time < 360) {
      markPublished(messageId)
      lastMessageTap.current = null
      return
    }
    lastMessageTap.current = { id: messageId, time: now }
  }

  return (
    <section className="module-card messenger-module">
      <div className="messenger-layout">
        <aside className="messenger-flight-list">
          <button type="button" onClick={() => void refresh()}>
            Live
          </button>
          {visibleFlights.map((flight) => (
            <button
              key={flight}
              className={selectedFlight === flight ? 'active-msg-flight' : ''}
              type="button"
              onClick={() => {
                if (canSeeAllChats) setSelectedFlight(flight)
              }}
            >
              {flight}
            </button>
          ))}
          {visibleFlights.length === 0 ? <p>No active flight</p> : null}
        </aside>
        <div className="messenger-main">
          <div className="message-list">
            {selectedMessages.length === 0 ? (
              <div className="empty-message-state">No real messages for this flight yet.</div>
            ) : (
              selectedMessages.map((message) => (
                <div
                  key={message.id}
                  className={message.status === 'published' ? 'msg-row published' : 'msg-row'}
                  onDoubleClick={() => markPublished(message.id)}
                  onTouchEnd={() => handleMessageTap(message.id)}
                >
                  <span className="msg-flight">{selectedFlight}</span>
                  <span className="msg-type">{message.status === 'published' ? 'PUBLISHED' : 'SENT'}</span>
                  <strong className="msg-text">{message.text}</strong>
                  <span className="msg-meta">{message.author} → {message.recipient ?? 'Ramp'}</span>
                  <span className={`msg-priority ${message.priority ?? 'medium'}`}>{priorityLabel(message.priority)}</span>
                  <time>{formatMessageTime(message.createdAt)}</time>
                </div>
              ))
            )}
          </div>
          {chatError ? <div className="empty-message-state">{chatError}</div> : null}
          <div className="recipient-row">
            {messageRecipients.map((item) => (
              <label key={item}>
                <input
                  type="radio"
                  name="recipient"
                  checked={recipient === item}
                  onChange={() => selectRecipient(item)}
                /> {item}
              </label>
            ))}
            <label>
              Priority
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high')}
                disabled={recipient === 'Ramp'}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="message-compose">
            <div className="chat-shortcuts">
              {shortCommands.map((command) => (
                <button
                  key={command.label}
                  type="button"
                  className="shortcut-chip"
                  onClick={() => {
                    setText((current) => (current.trim() ? `${current.trim()} ${command.text}` : command.text))
                  }}
                >
                  {command.label}
                </button>
              ))}
            </div>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Write message here"
            />
            <button
              disabled={!selectedFlight}
              onClick={async () => {
                if (!text.trim() || !selectedFlight) return
                const author = `${profile.firstName} ${profile.surname} - ${profile.role}`
                await sendChatMessage({
                  flightLabel: selectedFlight,
                  author,
                  text: text.trim(),
                  recipient,
                  priority: recipient === 'Ramp' ? 'high' : priority,
                })
                await refresh()
                setText('')
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function PassengerModule() {
  const { state, setPassenger, openFlights, activeFlightIndex } = useSimulatorStore()
  const { flights: adminFlights } = useLiveFlights()
  const [draft, setDraft] = useState(() => createPassengerState(state.passenger))
  const [activeSection, setActiveSection] = useState('Booked Passengers')
  const [aaLidsSyncNote, setAaLidsSyncNote] = useState('')
  const activeFlightLabel = openFlights[Math.max(0, Math.min(activeFlightIndex, openFlights.length - 1))] ?? ''
  const aaLidsFlightId = resolveAaLidsFlightId(activeFlightLabel, adminFlights)
  const destination = state.route.split('-')[1] || state.route || 'Not set'
  const bookedTotal = draft.booked.first + draft.booked.business + draft.booked.economy
  const transitTotal = draft.transit.first + draft.transit.business + draft.transit.economy
  const acceptedBreakdownTotal = draft.accepted.male + draft.accepted.female + draft.accepted.child
  const baggagePiecesTotal = draft.baggage.reduce((total, entry) => total + entry.pieces, 0)

  useEffect(() => {
    setDraft(createPassengerState(state.passenger))
  }, [state.passenger])

  useEffect(() => {
    if (!aaLidsFlightId || !isFirebaseConfigured()) {
      setAaLidsSyncNote('')
      return
    }

    let cancelled = false
    const syncFromAaLids = async () => {
      try {
        const synced = await loadAaLidsPassengerState(aaLidsFlightId)
        if (cancelled || !synced) {
          if (!cancelled) setAaLidsSyncNote('No passengers found in aa-lids for this flight.')
          return
        }
        const finalised = await fetchPassengerAcceptanceFinalised(activeFlightLabel, aaLidsFlightId)
        const merged = createPassengerState({ ...synced, finalised })
        setDraft(merged)
        setPassenger(merged)
        setAaLidsSyncNote('Passenger and baggage counts loaded from aa-lids.')
      } catch (error) {
        if (!cancelled) {
          setAaLidsSyncNote(error instanceof Error ? error.message : 'Could not load aa-lids passengers.')
        }
      }
    }

    void syncFromAaLids()
    const unsubscribe = subscribeCollection(
      FIRESTORE_COLLECTIONS.aaLidsPassengers,
      () => { void syncFromAaLids() },
      { field: 'flightId', value: aaLidsFlightId },
    )

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [aaLidsFlightId, setPassenger])

  const updateCabin = (section: 'booked' | 'transit', key: 'first' | 'business' | 'economy', value: number) => {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }))
  }

  const updateAccepted = (key: 'male' | 'female' | 'child' | 'infant' | 'cbbgExst', value: number) => {
    setDraft((current) => {
      const accepted = { ...current.accepted, [key]: value }
      return {
        ...current,
        accepted,
        acceptedPax: accepted.male + accepted.female + accepted.child,
      }
    })
  }

  const updateBaggage = (code: string, key: 'pieces' | 'weightKg', value: number) => {
    setDraft((current) => {
      const baggage = current.baggage.map((entry) => (entry.code === code ? { ...entry, [key]: value } : entry))
      return {
        ...current,
        baggage,
        acceptedBags: key === 'pieces' ? baggage.reduce((total, entry) => total + entry.pieces, 0) : current.acceptedBags,
      }
    })
  }

  const persistAcceptanceStatus = async (finalised: boolean) => {
    if (!activeFlightLabel) return
    try {
      await setPassengerAcceptanceFinalised({
        flightLabel: activeFlightLabel,
        aaLidsFlightId,
        finalised,
      })
    } catch (error) {
      console.warn('Unable to sync passenger acceptance status', error)
    }
  }

  const savePassenger = (finalised = draft.finalised) => {
    const next = createPassengerState({ ...draft, finalised })
    setDraft(next)
    setPassenger(next)
    void persistAcceptanceStatus(finalised)
  }

  useEffect(() => {
    if (!activeFlightLabel) return
    let cancelled = false

    const applyFinalised = (finalised: boolean) => {
      if (cancelled) return
      setDraft((current) => createPassengerState({ ...current, finalised }))
      const store = useSimulatorStore.getState()
      store.setPassenger(createPassengerState({ ...store.state.passenger, finalised }))
    }

    void fetchPassengerAcceptanceFinalised(activeFlightLabel, aaLidsFlightId)
      .then(applyFinalised)
      .catch(() => {})

    const unsubscribe = subscribePassengerAcceptanceFinalised(
      activeFlightLabel,
      aaLidsFlightId,
      applyFinalised,
    )

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [activeFlightLabel, aaLidsFlightId])

  return (
    <section className="module-card passenger-screen">
      <aside className="passenger-left">
        <div className="passenger-box">
          <h4>Acceptance Status</h4>
          <label><input type="radio" name="acceptance" checked={!draft.finalised} onChange={() => savePassenger(false)} /> Open</label>
          <label><input type="radio" name="acceptance" checked={draft.finalised} onChange={() => savePassenger(true)} /> Finalize</label>
        </div>
        <div className="passenger-box">
          <h4>Saleable Configuration</h4>
          <input
            type="text"
            value={draft.saleableConfiguration}
            placeholder="e.g. 12F/24J/180Y"
            onChange={(event) => setDraft((current) => ({ ...current, saleableConfiguration: event.target.value }))}
          />
        </div>
        <nav className="passenger-nav">
          <strong>Passengers</strong>
          {['Booked Passengers', 'Accepted Passengers', 'Seating Conditions', 'Passengers in Crew Seats'].map((item, index) => (
            <button
              key={item}
              className={activeSection === item ? 'active-passenger-section' : ''}
              onClick={() => setActiveSection(item)}
            >
              <span>{index === 2 ? '✖' : index < 2 ? '✓' : '⚠'}</span>
              {item}
            </button>
          ))}
          <strong>Baggage</strong>
          {['Accepted Joining Baggage', 'Total Rush Bags'].map((item) => (
            <button
              key={item}
              className={activeSection === item ? 'active-passenger-section' : ''}
              onClick={() => setActiveSection(item)}
            >
              <span>⚠</span>
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <div className="passenger-main">
        {aaLidsSyncNote ? <p className="search-note">{aaLidsSyncNote}</p> : null}
        {draft.finalised ? (
          <p className="search-note">Passenger acceptance is finalised. Agents cannot add new passengers in aa-lids.</p>
        ) : null}
        <fieldset className="passenger-fields" disabled={draft.finalised}>
        <div className="passenger-summary-grid">
          <section>
            <h4>Total Accepted Passenger</h4>
            <table><tbody><tr><th>Destination</th><th>M</th><th>F</th><th>C</th><th>Total</th></tr><tr><td>{destination}</td><td>{draft.accepted.male}</td><td>{draft.accepted.female}</td><td>{draft.accepted.child}</td><td><input type="number" value={draft.acceptedPax} onChange={(event) => setDraft((current) => ({ ...current, acceptedPax: Number(event.target.value) }))} /></td></tr></tbody></table>
          </section>
          <section>
            <h4>Total Accepted Baggage</h4>
            <table><tbody><tr><th>Destination</th><th>Pieces</th></tr><tr><td>{destination}</td><td><input type="number" value={draft.acceptedBags} onChange={(event) => setDraft((current) => ({ ...current, acceptedBags: Number(event.target.value) }))} /></td></tr></tbody></table>
          </section>
        </div>
        <section className="passenger-panel">
          <h4>Booked Passengers</h4>
          <table>
            <tbody>
              <tr><th>Destination</th><th>P</th><th>J</th><th>Y</th><th>Total</th></tr>
              <tr><td>{destination}</td><td><input type="number" value={draft.booked.first} onChange={(event) => updateCabin('booked', 'first', Number(event.target.value))} /></td><td><input type="number" value={draft.booked.business} onChange={(event) => updateCabin('booked', 'business', Number(event.target.value))} /></td><td><input type="number" value={draft.booked.economy} onChange={(event) => updateCabin('booked', 'economy', Number(event.target.value))} /></td><td>{bookedTotal}</td></tr>
              <tr><td>Transit</td><td><input type="number" value={draft.transit.first} onChange={(event) => updateCabin('transit', 'first', Number(event.target.value))} /></td><td><input type="number" value={draft.transit.business} onChange={(event) => updateCabin('transit', 'business', Number(event.target.value))} /></td><td><input type="number" value={draft.transit.economy} onChange={(event) => updateCabin('transit', 'economy', Number(event.target.value))} /></td><td>{transitTotal}</td></tr>
            </tbody>
          </table>
        </section>
        <section className="passenger-panel">
          <h4>Accepted Passengers</h4>
          <table>
            <tbody>
              <tr><th>Destination</th><th>M</th><th>F</th><th>C</th><th>Total</th><th>I</th><th>CBBG/EXST</th></tr>
              <tr><td>{destination}</td><td><input type="number" value={draft.accepted.male} onChange={(event) => updateAccepted('male', Number(event.target.value))} /></td><td><input type="number" value={draft.accepted.female} onChange={(event) => updateAccepted('female', Number(event.target.value))} /></td><td><input type="number" value={draft.accepted.child} onChange={(event) => updateAccepted('child', Number(event.target.value))} /></td><td>{acceptedBreakdownTotal}</td><td><input type="number" value={draft.accepted.infant} onChange={(event) => updateAccepted('infant', Number(event.target.value))} /></td><td><input type="number" value={draft.accepted.cbbgExst} onChange={(event) => updateAccepted('cbbgExst', Number(event.target.value))} /></td></tr>
            </tbody>
          </table>
        </section>
        <section className="passenger-panel">
          <h4>Seating Conditions / Crew Seats</h4>
          <div className="passenger-detail-grid">
            <label>
              Seating Conditions
              <input
                type="text"
                value={draft.seatingConditions}
                placeholder="Enter restrictions or notes"
                onChange={(event) => setDraft((current) => ({ ...current, seatingConditions: event.target.value }))}
              />
            </label>
            <label>
              Passengers in Crew Seats
              <input
                type="number"
                value={draft.passengersInCrewSeats}
                onChange={(event) => setDraft((current) => ({ ...current, passengersInCrewSeats: Number(event.target.value) }))}
              />
            </label>
          </div>
        </section>
        <section className="passenger-panel baggage-grid-panel">
          <h4>Accepted Joining Baggage</h4>
          <div className="baggage-grid">
            {draft.baggage.map((entry) => (
              <label key={entry.code}>
                Commodity {entry.code}
                <input type="number" value={entry.pieces} onChange={(event) => updateBaggage(entry.code, 'pieces', Number(event.target.value))} />
                <input type="number" value={entry.weightKg} onChange={(event) => updateBaggage(entry.code, 'weightKg', Number(event.target.value))} />
              </label>
            ))}
          </div>
          <div className="passenger-detail-grid">
            <label>
              Total Rush Bags
              <input
                type="number"
                value={draft.rushBags}
                onChange={(event) => setDraft((current) => ({ ...current, rushBags: Number(event.target.value) }))}
              />
            </label>
            <label>
              Baggage Pieces Total
              <input type="number" value={baggagePiecesTotal} readOnly />
            </label>
          </div>
        </section>
        </fieldset>
        <div className="passenger-actions">
          <button onClick={() => savePassenger()} disabled={draft.finalised}>Save</button>
          <button onClick={() => savePassenger(true)} disabled={draft.finalised}>Finalise Acceptance</button>
        </div>
      </div>
    </section>
  )
}

export function FuelModule() {
  const { state, setFuel } = useSimulatorStore()
  const [actualKg, setActualKg] = useState(state.fuel.actualKg)
  const [density, setDensity] = useState(state.fuel.density)
  const [confirmed, setConfirmed] = useState(state.fuel.status === 'confirmed')

  useEffect(() => {
    setActualKg(state.fuel.actualKg)
    setDensity(state.fuel.density)
    setConfirmed(state.fuel.status === 'confirmed')
  }, [state.fuel.actualKg, state.fuel.density, state.fuel.status])

  return (
    <section className="module-card">
      <h3>Fuel</h3>
      <div className="row">
        <label>Planned</label>
        <strong>{state.fuel.plannedKg}kg</strong>
      </div>
      <div className="row">
        <label>Actual</label>
        <input type="number" value={actualKg} onChange={(event) => setActualKg(Number(event.target.value))} />
      </div>
      <div className="row">
        <label>Density</label>
        <input type="number" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
      </div>
      <div className="row">
        <label>Confirmed</label>
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      </div>
      <button onClick={() => setFuel(actualKg, density, confirmed)}>Save Fuel Data</button>
    </section>
  )
}

export function FreightModule() {
  const { state, openFlights, activeFlightIndex, addFreight, updateFreight, deleteFreight } = useSimulatorStore()
  const [searchType, setSearchType] = useState<'flight' | 'port'>('flight')
  const [searchDone, setSearchDone] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(state.commodities[0]?.id ?? null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [modifyOpen, setModifyOpen] = useState(false)
  const [bulkId, setBulkId] = useState('AKE987656X')
  const [newType, setNewType] = useState('C')
  const [newDestination, setNewDestination] = useState(state.route.split('-')[1] ?? 'LAX')
  const [newWeight, setNewWeight] = useState(220)
  const [newHold, setNewHold] = useState(state.holds[0]?.id ?? 'cpt1')
  const [newDescription, setNewDescription] = useState('')

  const activeFlight = openFlights[activeFlightIndex]
  const activeRows = state.commodities.filter((item) => item.status === 'loaded')
  const selectedCommodity = activeRows.find((item) => item.id === selectedId) ?? activeRows[0]
  const totalWeight = activeRows.reduce((sum, item) => sum + item.weightKg, 0)
  const freightUldCount = activeRows.length
  const destination = state.route.split('-')[1] ?? state.route

  useEffect(() => {
    if (!selectedId || !state.commodities.some((item) => item.id === selectedId)) {
      setSelectedId(state.commodities[0]?.id ?? null)
    }
  }, [selectedId, state.commodities])

  const [editType, setEditType] = useState(selectedCommodity?.code ?? 'C')
  const [editDestination, setEditDestination] = useState(destination)
  const [editWeight, setEditWeight] = useState(selectedCommodity?.weightKg ?? 0)
  const [editHold, setEditHold] = useState(selectedCommodity?.locationId ?? state.holds[0]?.id ?? 'cpt1')
  const [editDescription, setEditDescription] = useState(selectedCommodity?.label ?? '')

  useEffect(() => {
    if (!selectedCommodity) return
    setEditType(selectedCommodity.code)
    setEditDestination(destination)
    setEditWeight(selectedCommodity.weightKg)
    setEditHold(selectedCommodity.locationId)
    setEditDescription(selectedCommodity.label)
  }, [destination, selectedCommodity])

  if (openFlights.length === 0) {
    return (
      <section className="module-card freight-screen no-active-flight">
        <h3>No Active Flight</h3>
        <p>Open a real flight from Search first. Freight deadload will be shown for that exact flight.</p>
      </section>
    )
  }

  const saveNewFreight = () => {
    addFreight(`${newType} ${bulkId} ${newDestination} ${newDescription}`.trim(), newWeight, newHold)
    setAddOpen(false)
    setDetailsOpen(true)
  }

  const saveModifiedFreight = () => {
    if (!selectedCommodity) return
    updateFreight(selectedCommodity.id, {
      code: editType,
      label: editDescription || `${editType} ${editDestination}`,
      weightKg: editWeight,
      locationId: editHold,
    })
    setModifyOpen(false)
    setDetailsOpen(true)
  }

  return (
    <section className="module-card freight-screen">
      <header className="freight-status-bar">
        <button type="button">×</button>
        <strong>{activeFlight}</strong>
        <span>Status {state.status.toUpperCase()}</span>
        <span>Registration TRAIN</span>
        <span>Predicted Underload {Math.max(0, state.fuel.plannedKg - totalWeight)} kg</span>
        <span>Joining Freight {totalWeight} kg</span>
        <span>Freight ULDs {freightUldCount}</span>
      </header>

      <div className="freight-search-panel">
        <label><input type="radio" checked={searchType === 'flight'} onChange={() => setSearchType('flight')} /> Flight</label>
        <label><input type="radio" checked={searchType === 'port'} onChange={() => setSearchType('port')} /> Port</label>
        <label>Carrier<input value={state.flightNo.split(' ')[0] ?? '6X'} readOnly /></label>
        <label>Flight Number<input value={state.flightNo.split(' ')[1] ?? state.flightNo} readOnly /></label>
        <label>Date<input value={new Date().toISOString().slice(0, 10)} readOnly /></label>
        <label>Port<input value={searchType === 'port' ? state.route.split('-')[0] : destination} readOnly /></label>
        <button type="button" onClick={() => setSearchDone(true)}>Find</button>
      </div>

      <div className="freight-layout">
        <div className="freight-table-wrap">
          <div className="freight-tools">
            <span>Assigned deadload for selected {searchType}</span>
            <label>Sort by <select defaultValue="none"><option value="none">No sorting</option><option>Weight</option><option>Destination</option></select></label>
            <label>Order <select defaultValue="asc"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          </div>
          {searchDone ? (
            <table className="freight-table">
              <thead>
                <tr>
                  <th />
                  <th>ULD/Bulk</th>
                  <th>Dest</th>
                  <th>Gross Weight</th>
                  <th>Tare Weight</th>
                  <th>Info</th>
                  <th>Commodity</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((item, index) => (
                  <tr key={item.id} className={selectedCommodity?.id === item.id ? 'freight-selected' : ''}>
                    <td><input type="checkbox" checked={selectedCommodity?.id === item.id} onChange={() => setSelectedId(item.id)} /></td>
                    <td><button type="button" onClick={() => { setSelectedId(item.id); setDetailsOpen(true) }}>{index === 0 ? 'AKE123456X' : `BULK-${index + 1}`}</button></td>
                    <td><span className="dest-chip">{destination}</span></td>
                    <td>{item.weightKg}</td>
                    <td>{item.code === 'BAG' ? 70 : 50}</td>
                    <td>{item.isDangerousGoods ? 'DG' : 'OK'}</td>
                    <td><span className="commodity-chip">{item.code}</span> {item.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <footer className="freight-actions">
            <button type="button" onClick={() => setAddOpen(true)}>Add</button>
            <button type="button" disabled={!selectedCommodity} onClick={() => selectedCommodity && deleteFreight(selectedCommodity.id)}>Delete</button>
            <button type="button">Message to Load Controller</button>
          </footer>
        </div>

        <aside className={detailsOpen && selectedCommodity ? 'deadload-details open' : 'deadload-details'}>
          <header>
            <button type="button" onClick={() => setDetailsOpen(false)}>×</button>
            <strong>{selectedCommodity ? 'AKE123456X' : 'No Deadload'}</strong>
          </header>
          {selectedCommodity ? (
            <>
              <div className="deadload-fields">
                <label>Destination<input value={destination} readOnly /></label>
                <label>Gross Weight<input value={selectedCommodity.weightKg} readOnly /></label>
                <label>Tare Weight<input value={selectedCommodity.code === 'BAG' ? 70 : 50} readOnly /></label>
                <label>ROB<input value="0" readOnly /></label>
              </div>
              <textarea readOnly value={selectedCommodity.label} />
              <div className="deadload-card selected">
                <span className="commodity-chip">{selectedCommodity.code}</span>
                <strong>{selectedCommodity.weightKg} kg</strong>
                <span className="dest-chip">{destination}</span>
              </div>
              <button type="button" onClick={() => setModifyOpen(true)}>Modify Commodity</button>
              <button type="button" onClick={() => deleteFreight(selectedCommodity.id)}>Delete Deadload</button>
            </>
          ) : <p>Select a deadload row.</p>}
        </aside>
      </div>

      {addOpen ? (
        <div className="modal-backdrop" role="dialog" aria-label="Add ULD or bulk">
          <div className="freight-modal">
            <header><strong>Add ULD / Bulk</strong><button type="button" onClick={() => setAddOpen(false)}>×</button></header>
            <label className="bulk-id-row">Bulk/ULD ID<input value={bulkId} onChange={(event) => setBulkId(event.target.value)} /><span>10 identified location(s)</span></label>
            <div className="location-picks">
              {state.holds.map((hold) => (
                <button key={hold.id} type="button" className={newHold === hold.id ? 'selected' : ''} onClick={() => setNewHold(hold.id)}>{hold.name}</button>
              ))}
            </div>
            <div className="modify-grid">
              <label>Type<input value={newType} onChange={(event) => setNewType(event.target.value.toUpperCase())} /></label>
              <label>Destination<input value={newDestination} onChange={(event) => setNewDestination(event.target.value.toUpperCase())} /></label>
              <label>Gross Weight<input type="number" value={newWeight} onChange={(event) => setNewWeight(Number(event.target.value))} /></label>
              <label>Description<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></label>
            </div>
            <footer><button type="button" onClick={() => setAddOpen(false)}>Cancel</button><button type="button" onClick={saveNewFreight}>Save</button></footer>
          </div>
        </div>
      ) : null}

      {modifyOpen && selectedCommodity ? (
        <div className="modal-backdrop" role="dialog" aria-label="Modify commodity">
          <div className="freight-modal modify-commodity-modal">
            <header><strong>Modify Commodity</strong><button type="button" onClick={() => setModifyOpen(false)}>×</button></header>
            <div className="modify-grid">
              <label>Type<input value={editType} onChange={(event) => setEditType(event.target.value.toUpperCase())} /></label>
              <label>Destination<input value={editDestination} onChange={(event) => setEditDestination(event.target.value.toUpperCase())} /></label>
              <label>Priority<input defaultValue="0" /></label>
              <label>Gross Weight<input type="number" value={editWeight} onChange={(event) => setEditWeight(Number(event.target.value))} /></label>
              <label>Hold<select value={editHold} onChange={(event) => setEditHold(event.target.value)}>{state.holds.map((hold) => <option key={hold.id} value={hold.id}>{hold.name}</option>)}</select></label>
              <label>Description<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
            </div>
            <footer><button type="button" onClick={() => setModifyOpen(false)}>Cancel</button><button type="button" onClick={saveModifiedFreight}>Update</button></footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

const emptyAdminFlight: NewAdminFlight = {
  carrier: '6X',
  flightNo: '',
  date: new Date().toISOString().slice(0, 10),
  dep: 'SIN',
  arr: 'PER',
  time: '14:15',
  status: 'GO-RO-LI-AN-BN',
  aircraft: '319-ALD',
  controller: 'Load Controller',
}

export function AdminModule() {
  const { unlockFlight } = useSimulatorStore()
  const [form, setForm] = useState<NewAdminFlight>(emptyAdminFlight)
  const [status, setStatus] = useState('Ready')
  const { flights, error: flightsError, refresh: refreshFlights } = useLiveFlights()
  const { closures } = useLiveFlightClosures()

  const updateField = (field: keyof NewAdminFlight, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const submitFlight = async () => {
    setStatus('Saving...')
    try {
      const saved = await createAdminFlight(form)
      await refreshFlights()
      setForm({ ...emptyAdminFlight, date: form.date })
      setStatus(`Saved ${saved.carrier} ${saved.flightNo}`)
    } catch {
      setStatus('Could not save flight. Check that simulator-api is running.')
    }
  }

  const removeFlight = async (id: string) => {
    setStatus('Deleting...')
    try {
      await deleteFlight(id)
      await refreshFlights()
      setStatus('Deleted')
    } catch {
      setStatus('Could not delete flight.')
    }
  }

  return (
    <section className="module-card admin-module">
      <h3>Admin Control</h3>
      <p className="search-note">
        Add flights here. They are saved in Firebase and become available in Search.
      </p>
      <div className="admin-grid">
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitFlight()
          }}
        >
          <label>Carrier<input value={form.carrier} onChange={(event) => updateField('carrier', event.target.value)} /></label>
          <label>Flight No<input value={form.flightNo} onChange={(event) => updateField('flightNo', event.target.value)} required /></label>
          <label>Date<input type="date" value={form.date} onChange={(event) => updateField('date', event.target.value)} required /></label>
          <label>Departure<input value={form.dep} onChange={(event) => updateField('dep', event.target.value)} required /></label>
          <label>Arrival<input value={form.arr} onChange={(event) => updateField('arr', event.target.value)} required /></label>
          <label>Time<input type="time" value={form.time} onChange={(event) => updateField('time', event.target.value)} required /></label>
          <label>Status<input value={form.status} onChange={(event) => updateField('status', event.target.value)} /></label>
          <label>Aircraft<input value={form.aircraft} onChange={(event) => updateField('aircraft', event.target.value)} /></label>
          <label>Load Controller<input value={form.controller} onChange={(event) => updateField('controller', event.target.value)} /></label>
          <button type="submit">Add Flight</button>
          <p>{status}</p>
        </form>
        <div className="admin-list">
          {flightsError ? <p>{flightsError}</p> : null}
          <h4>Saved Flights</h4>
          {flights.length === 0 ? (
            <p>No admin flights yet.</p>
          ) : (
            <table className="search-table">
              <thead>
                <tr><th>Flight</th><th>Date</th><th>Route</th><th>Time</th><th>Status</th><th>Aircraft</th><th /></tr>
              </thead>
              <tbody>
                {flights.map((flight) => (
                  <tr key={flight.id}>
                    <td>{flight.carrier} {flight.flightNo}</td>
                    <td>{flight.date}</td>
                    <td>{flight.dep}-{flight.arr}</td>
                    <td>{flight.time}</td>
                    <td>{flight.status}</td>
                    <td>{flight.aircraft}</td>
                    <td><button type="button" onClick={() => void removeFlight(flight.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Closed Flights</h4>
          {closures.length === 0 ? (
            <p>No closed flights.</p>
          ) : (
            <table className="search-table">
              <thead>
                <tr><th>Flight</th><th>Signature</th><th>Closed By</th><th>Device</th><th>Closed At</th><th /></tr>
              </thead>
              <tbody>
                {closures.map((closed) => (
                  <tr key={`${closed.flightLabel}-${closed.closedAt}`}>
                    <td>{closed.flightLabel}</td>
                    <td>
                      {closed.signatureData.startsWith('data:image/') ? (
                        <img
                          src={closed.signatureData}
                          alt="Signature preview"
                          style={{ width: '96px', height: '32px', objectFit: 'contain', background: '#f8fafc' }}
                        />
                      ) : (
                        closed.signatureData
                      )}
                    </td>
                    <td>{closed.closedBy ?? 'Unknown'}</td>
                    <td title={closed.closedDevice ?? 'Unknown device'}>
                      {(closed.closedDevice ?? 'Unknown device').slice(0, 44)}
                    </td>
                    <td>{closed.closedAt}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          void reopenFlightGlobally(closed.flightLabel)
                            .then(() => unlockFlight(closed.flightLabel))
                            .catch(() => {})
                        }}
                      >
                        Unlock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

export function AccountsModule() {
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('Ramp Agent')
  const [newUserAutoConfirm, setNewUserAutoConfirm] = useState(true)
  const [userStatus, setUserStatus] = useState('')
  const [users, setUsers] = useState<Array<{ email: string; role: string; updatedAt: string }>>([])
  const [usersStatus, setUsersStatus] = useState('')
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({})
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})

  const refreshUsers = async () => {
    try {
      const rows = await listAdminUsers()
      setUsers(rows)
      setUsersStatus('')
      setRoleDrafts(Object.fromEntries(rows.map((row) => [row.email, row.role])))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load users.'
      setUsersStatus(message)
    }
  }

  useEffect(() => {
    void refreshUsers()
  }, [])

  const submitUser = async () => {
    if (!newUserEmail.trim() || !newUserPassword.trim()) return
    setUserStatus('Creating account...')
    try {
      const created = await createAdminUser({
        email: newUserEmail.trim().toLowerCase(),
        password: newUserPassword,
        role: newUserRole,
        autoConfirmEmail: newUserAutoConfirm,
      })
      setNewUserPassword('')
      setUserStatus(`Created ${created.email} (${created.role})`)
      await refreshUsers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create account.'
      setUserStatus(message)
    }
  }

  return (
    <section className="module-card admin-module">
      <h3>Account Management</h3>
      <p className="search-note">Create user accounts with predefined role and optional auto email confirmation.</p>
      <div className="admin-grid">
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitUser()
          }}
        >
          <h4>Create Account</h4>
          <label>Email<input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} type="email" required /></label>
          <label>Password<input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} type="password" minLength={6} required /></label>
          <label>
            Role
            <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}>
              {loginRoles.map((roleOption) => (
                <option key={roleOption}>{roleOption}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={newUserAutoConfirm}
              onChange={(event) => setNewUserAutoConfirm(event.target.checked)}
            />
            Auto-confirm email
          </label>
          <button type="submit">Create User</button>
          <p>{userStatus}</p>
        </form>
        <div className="admin-list">
          <h4>Existing Accounts</h4>
          {usersStatus ? <p>{usersStatus}</p> : null}
          <button type="button" onClick={() => void refreshUsers()}>Refresh Users</button>
          {users.length === 0 ? (
            <p>No users yet.</p>
          ) : (
            <table className="search-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Updated</th><th>Password Reset</th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.email}>
                    <td>{user.email}</td>
                    <td>
                      <select
                        value={roleDrafts[user.email] ?? user.role}
                        onChange={(event) => {
                          const next = event.target.value
                          setRoleDrafts((current) => ({ ...current, [user.email]: next }))
                        }}
                      >
                        {loginRoles.map((roleOption) => (
                          <option key={roleOption}>{roleOption}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          void updateAdminUserRole(user.email, roleDrafts[user.email] ?? user.role)
                            .then(() => {
                              setUserStatus(`Role updated for ${user.email}`)
                              return refreshUsers()
                            })
                            .catch((error) => {
                              const message = error instanceof Error ? error.message : 'Could not update role.'
                              setUserStatus(message)
                            })
                        }}
                      >
                        Save Role
                      </button>
                    </td>
                    <td>{user.updatedAt}</td>
                    <td>
                      <input
                        type="password"
                        minLength={6}
                        placeholder="new password"
                        value={passwordDrafts[user.email] ?? ''}
                        onChange={(event) => {
                          const next = event.target.value
                          setPasswordDrafts((current) => ({ ...current, [user.email]: next }))
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const password = (passwordDrafts[user.email] ?? '').trim()
                          if (!password) return
                          void resetAdminUserPassword(user.email, password)
                            .then(() => {
                              setUserStatus(`Password updated for ${user.email}`)
                              setPasswordDrafts((current) => ({ ...current, [user.email]: '' }))
                            })
                            .catch((error) => {
                              const message = error instanceof Error ? error.message : 'Could not reset password.'
                              setUserStatus(message)
                            })
                        }}
                      >
                        Set Password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

const formatSearchFlight = (row: AdminFlight) =>
  `${row.carrier} ${row.flightNo} ${row.date} ${row.dep}-${row.arr} ${row.aircraft} ${row.time} ${row.status}`

export function SearchModule() {
  const navigate = useNavigate()
  const { openFlight, subscribeFlight, assignRampAgentToFlight } = useSimulatorStore()
  const { flights: rows, error: flightsError } = useLiveFlights()
  const { closures } = useLiveFlightClosures()
  const closedFlightLabels = new Set(closures.map((closure) => closure.flightLabel))
  const [carrier, setCarrier] = useState('6X')
  const [flightNo, setFlightNo] = useState('')
  const [date, setDate] = useState('')
  const [depPort, setDepPort] = useState('RIX')
  const [arrPort, setArrPort] = useState('')
  const [reg, setReg] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchDone, setSearchDone] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [allocated, setAllocated] = useState(false)

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedIds([])
      return
    }
    setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)))
  }, [rows])

  const normalizedCarrier = carrier.trim().toUpperCase()
  const normalizedFlightNo = flightNo.trim().toUpperCase()
  const normalizedDate = date.trim().toUpperCase()
  const normalizedDep = depPort.trim().toUpperCase()
  const normalizedArr = arrPort.trim().toUpperCase()
  const filteredRows = rows.filter((row) => {
    const matchesCarrier = !normalizedCarrier || row.carrier.includes(normalizedCarrier)
    const matchesFlight = !normalizedFlightNo || row.flightNo.includes(normalizedFlightNo.replace(/\s/g, ''))
    const matchesDate = !normalizedDate || row.date.toUpperCase().includes(normalizedDate)
    const matchesDep = !normalizedDep || row.dep.includes(normalizedDep)
    const matchesArr = !normalizedArr || row.arr.includes(normalizedArr)
    const matchesReg = !reg.trim() || row.aircraft.toUpperCase().includes(reg.trim().toUpperCase())
    return matchesCarrier && matchesFlight && matchesDate && matchesDep && matchesArr && matchesReg
  })
  const visibleRows = searchDone ? filteredRows : []
  const selectedRows = visibleRows.filter((row) => selectedIds.includes(row.id))
  const selected = selectedRows[0] ?? visibleRows[0]
  const selectedFlightLabel = selected ? formatSearchFlight(selected) : ''
  const toggleSelectedFlight = (flightId: string) => {
    setSelectedIds((current) =>
      current.includes(flightId) ? current.filter((id) => id !== flightId) : [...current, flightId],
    )
  }
  const selectedFlightLabels = selectedRows.map(formatSearchFlight)

  return (
    <section className="module-card search-module">
      <h3>How to Find a Flight</h3>
      <p className="search-note">
        Enter flight details, run search, then select a result and subscribe before opening Ramp.
      </p>

      <div className="search-bar">
        <label className="search-flight-number">
          Flight Number
          <span>
            <input value={carrier} onChange={(event) => setCarrier(event.target.value.toUpperCase())} aria-label="Carrier" />
            <input value={flightNo} onChange={(event) => setFlightNo(event.target.value)} aria-label="Flight number" />
          </span>
        </label>
        <label>
          Date
          <input value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Departure Port
          <input value={depPort} onChange={(event) => setDepPort(event.target.value)} />
        </label>
        <label>
          Arrival Port
          <input value={arrPort} onChange={(event) => setArrPort(event.target.value)} />
        </label>
        <label>
          Registration
          <input value={reg} onChange={(event) => setReg(event.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            setSearchDone(true)
            setSelectedIds(filteredRows[0]?.id ? [filteredRows[0].id] : [])
            setSubscribed(false)
            setAllocated(false)
          }}
        >
          Search
        </button>
      </div>

      {searchDone ? (
        <>
          {flightsError ? <p className="search-note">{flightsError}</p> : null}
          <table className="search-table">
            <thead>
              <tr>
                <th />
                <th>Flight</th>
                <th>Date</th>
                <th>Dep</th>
                <th>Arr</th>
                <th>Time</th>
                <th>Status</th>
                <th>Aircraft</th>
                <th>Load Controller</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9}>No flights match the search. Add flights in Admin or create them in aa-lids.</td>
                </tr>
              ) : visibleRows.map((row) => (
                <tr key={row.id} className={selectedIds.includes(row.id) ? 'selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={() => toggleSelectedFlight(row.id)}
                    />
                  </td>
                  <td>{row.carrier} {row.flightNo}</td>
                  <td>{row.date}</td>
                  <td>{row.dep}</td>
                  <td>{row.arr}</td>
                  <td>{row.time}</td>
                  <td>{closedFlightLabels.has(formatSearchFlight(row)) ? 'CLOSED' : row.status}</td>
                  <td>{row.aircraft}</td>
                  <td>{row.controller}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="search-actions">
            <button
              onClick={() => {
                if (selectedFlightLabels.length === 0) return
                selectedFlightLabels.forEach((flightLabel) => subscribeFlight(flightLabel))
                setSubscribed(true)
              }}
            >
              Subscribe
            </button>
            <button
              onClick={() => {
                if (selectedFlightLabels.length === 0) return
                selectedFlightLabels.forEach((flightLabel) => {
                  subscribeFlight(flightLabel)
                  assignRampAgentToFlight(flightLabel)
                })
                setAllocated(true)
              }}
            >
              Add & Subscribe
            </button>
            <button
              onClick={() => {
                if (!subscribed && !allocated) return
                if (selectedRows.length > 0) {
                  [...selectedRows].reverse().forEach((row) => {
                    openFlight(formatSearchFlight(row), createFlightState({
                      flightNo: `${row.carrier} ${row.flightNo}`,
                      route: `${row.dep}-${row.arr}`,
                    }))
                  })
                } else if (selectedFlightLabel) {
                  openFlight(selectedFlightLabel, createFlightState({
                    flightNo: `${selected.carrier} ${selected.flightNo}`,
                    route: `${selected.dep}-${selected.arr}`,
                  }))
                }
                navigate('/')
              }}
            >
              Open Flight
            </button>
          </div>
          <p className="search-summary">
            Selected: {selectedRows.length > 0 ? `${selectedRows.length} flights` : selected ? `${selected.carrier} ${selected.flightNo} ${selected.date}` : 'none'} •
            Subscribed: {subscribed ? 'Yes' : 'No'} • Added: {allocated ? 'Yes' : 'No'}
          </p>
        </>
      ) : null}
    </section>
  )
}

export function ProfileModule() {
  const { profile, setProfile, loginRole } = useSimulatorStore()
  const [firstName, setFirstName] = useState(profile.firstName)
  const [surname, setSurname] = useState(profile.surname)
  const [phoneCountry, setPhoneCountry] = useState(profile.phoneCountry)
  const [phoneArea, setPhoneArea] = useState(profile.phoneArea)
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber)
  const [faxCountry, setFaxCountry] = useState(profile.faxCountry)
  const [faxArea, setFaxArea] = useState(profile.faxArea)
  const [faxNumber, setFaxNumber] = useState(profile.faxNumber)
  const [printer, setPrinter] = useState(profile.printer)
  const [radioId, setRadioId] = useState(profile.radioId)
  const [role] = useState(profile.role)
  const [notificationSound, setNotificationSound] = useState<NotificationSoundPreset>(profile.notificationSound)
  const [saved, setSaved] = useState(false)

  const saveProfile = () => {
    setProfile({
      firstName,
      surname,
      phoneCountry,
      phoneArea,
      phoneNumber,
      faxCountry,
      faxArea,
      faxNumber,
      printer,
      radioId,
      role: loginRole || role,
      notificationSound,
    })
    setSaved(true)
  }

  return (
    <section className="module-card profile-screen">
      <h3>Profile</h3>
      <div className="profile-card">
        <header>Contact Details for APICKUP</header>
        <div className="profile-form">
          <label>First Name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label>Surname<input value={surname} onChange={(event) => setSurname(event.target.value)} /></label>
          <label className="phone-row">
            Phone
            <span>
              <input value={phoneCountry} onChange={(event) => setPhoneCountry(event.target.value)} />
              <input value={phoneArea} onChange={(event) => setPhoneArea(event.target.value)} />
              <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
            </span>
          </label>
          <label className="phone-row">
            Fax
            <span>
              <input value={faxCountry} onChange={(event) => setFaxCountry(event.target.value)} />
              <input value={faxArea} onChange={(event) => setFaxArea(event.target.value)} />
              <input value={faxNumber} onChange={(event) => setFaxNumber(event.target.value)} />
            </span>
          </label>
          <label>Printer<input value={printer} onChange={(event) => setPrinter(event.target.value)} /></label>
          <label>Radio ID<input value={radioId} onChange={(event) => setRadioId(event.target.value)} /></label>
          <label>
            Role
            <select value={loginRole || role} disabled>
              {loginRoles.map((roleOption) => (
                <option key={roleOption}>{roleOption}</option>
              ))}
            </select>
          </label>
          <label>
            Notification Sound
            <select
              value={notificationSound}
              onChange={(event) => setNotificationSound(event.target.value as NotificationSoundPreset)}
            >
              <option value="soft">Soft chime</option>
              <option value="classic">Classic beep</option>
              <option value="loud">Loud alert</option>
            </select>
          </label>
          <div className="sound-preview-row">
            <button type="button" onClick={() => playNotificationSound('soft')}>Play Soft</button>
            <button type="button" onClick={() => playNotificationSound('classic')}>Play Classic</button>
            <button type="button" onClick={() => playNotificationSound('loud')}>Play Loud</button>
          </div>
          <button className="profile-save-button" type="button" onClick={saveProfile}>Done</button>
        </div>
      </div>
      {saved ? <p className="profile-save-note">Contact details updated for this login.</p> : null}
    </section>
  )
}

export function PlaceholderModule({ title, description }: { title: string; description: string }) {
  return (
    <section className="module-card">
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  )
}

const commodityCodeRows = [
  ['B', 'Baggage.'],
  ['C', 'Cargo or mixed.'],
  ['D', 'Crew baggage.'],
  ['E', 'Equipment.'],
  ['L', 'Mixed load by destination.'],
  ['M', 'Mail.'],
  ['Q', 'Courier baggage.'],
  ['S', 'Sort on arrival.'],
  ['U', 'Unserviceable. Note: Commodity code U does not support subtype codes.'],
  ['W', 'Secure cargo.'],
  ['X', 'Empty ULD.'],
  ['Z', 'Mixed load by destination.'],
]

export function CommodityCodesModule() {
  return (
    <section className="module-card commodity-codes-screen">
      <h3>Commodity Codes</h3>
      <div className="commodity-codes-card">
        <p>Table: Commodity Codes</p>
        <table>
          <thead>
            <tr><th>Code</th><th>Description</th></tr>
          </thead>
          <tbody>
            {commodityCodeRows.map(([code, description]) => (
              <tr key={code}>
                <td>{code}</td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Commodity subtype codes are created per airline in DBM.</p>
        <div className="commodity-example">
          Example: BY (economy baggage), BG (gate baggage), BT (transfer baggage).
        </div>
      </div>
    </section>
  )
}

const parseFlightLabel = (label: string) => {
  const parts = label.split(' ')
  const route = parts.find((part) => part.includes('-')) ?? ''
  const time = parts.find((part) => /^\d{2}:\d{2}$/.test(part)) ?? ''
  const aircraft = parts.find((part) => /^[A-Z0-9]{2,3}-[A-Z0-9]{2,}$/.test(part)) ?? ''
  const date = parts.find((part) => /\d{2}-[A-Z]{3}|\d{4}-\d{2}-\d{2}/.test(part)) ?? ''
  const status = parts.find((part) => part.includes('GO-') || part.includes('LIR')) ?? ''

  return {
    carrier: parts[0] ?? '',
    flightNo: parts[1] ?? '',
    date,
    route,
    aircraft,
    time,
    status,
  }
}

export function FlightInfoModule() {
  const { state, openFlights, activeFlightIndex, subscribedFlights, flightAssignments } = useSimulatorStore()
  const [gatePrefix, setGatePrefix] = useState('GTE')
  const [gateNumber, setGateNumber] = useState('B27')
  const [savedAt, setSavedAt] = useState<string>('')
  const activeFlightLabel = openFlights[activeFlightIndex] ?? ''
  const activeFlight = parseFlightLabel(activeFlightLabel)
  const assignedRampAgent = flightAssignments[activeFlightLabel]
  const isSubscribed = subscribedFlights.includes(activeFlightLabel)
  const balance = calculateBalance(state)
  const actualBalancePosition = Math.max(12, Math.min(88, 50 + balance.index * 28))
  const zfwMarkers = [
    { label: 'AFT LIMIT', position: 18 },
    { label: 'ACTUAL', position: actualBalancePosition },
    { label: 'FWD LIMIT', position: 84 },
  ]
  const towMarkers = [
    { label: 'AFT LIMIT', position: 20 },
    { label: 'ACTUAL', position: actualBalancePosition },
    { label: 'FWD LIMIT', position: 86 },
  ]
  const totalFreight = state.commodities
    .filter((item) => item.status === 'loaded')
    .reduce((sum, item) => sum + item.weightKg, 0)
  const predictedUnderload = Math.max(0, state.fuel.plannedKg - totalFreight)

  return (
    <section className="module-card flight-info-module">
      <div className="fi-dashboard">
        <article className="fi-box fi-flight-box">
          <h4>Flight</h4>
          <dl>
            <dt>Flight Number:</dt>
            <dd>{activeFlight.carrier} {activeFlight.flightNo}</dd>
            <dt>Flight Date:</dt>
            <dd>{activeFlight.date}</dd>
            <dt>Routing:</dt>
            <dd>{activeFlight.route}</dd>
            <dt>STD:</dt>
            <dd>{activeFlight.time}</dd>
            <dt>Status:</dt>
            <dd>{state.status.toUpperCase()}</dd>
            <dt>Subscription:</dt>
            <dd>{isSubscribed ? 'Subscribed' : 'Not subscribed'}</dd>
            <dt>Ramp Agent:</dt>
            <dd>{assignedRampAgent?.name ?? 'Not assigned'}</dd>
            <dt>Ramp Contact:</dt>
            <dd>{assignedRampAgent?.phone ?? 'Not set'}</dd>
            <dt>Ramp Radio ID:</dt>
            <dd>{assignedRampAgent?.radioId ?? 'Not set'}</dd>
          </dl>
        </article>

        <article className="fi-box fi-aircraft-box">
          <h4>Aircraft</h4>
          <dl>
            <dt>Registration:</dt>
            <dd>{activeFlight.aircraft}</dd>
            <dt>Subtype:</dt>
            <dd>{activeFlight.aircraft ? activeFlight.aircraft.split('-')[0] : 'Not set'}</dd>
            <dt>Aircraft Location:</dt>
            <dd className="inline-location">
              <input value={gatePrefix} onChange={(event) => setGatePrefix(event.target.value.toUpperCase())} />
              <input value={gateNumber} onChange={(event) => setGateNumber(event.target.value.toUpperCase())} />
              <button type="button" onClick={() => setSavedAt(new Date().toLocaleTimeString())}>
                Save
              </button>
            </dd>
          </dl>
          {savedAt ? <p className="save-note">Saved {savedAt}</p> : null}
        </article>

        <article className="fi-box fi-water-box">
          <h4>Potable Water</h4>
          <dl>
            <dt>Weight:</dt>
            <dd>{state.fuel.plannedKg > 0 ? Math.round(state.fuel.plannedKg * 0.1) : 0} kg</dd>
          </dl>
        </article>

        <article className="fi-box fi-load-box">
          <h4>Load</h4>
          <dl>
            <dt>Predicted Underload:</dt>
            <dd>{predictedUnderload.toLocaleString()} kg</dd>
          </dl>
        </article>

        <article className="fi-box fi-docs-box">
          <h4>Documents</h4>
          <p>LIR {state.documents.length} · MSG {state.messages.length} · FRT {state.commodities.length}</p>
        </article>

        <article className="fi-box fi-pax-box">
          <h4>Passenger</h4>
          <dl>
            <dt>Accepted:</dt>
            <dd>{state.passenger.acceptedPax} / {state.passenger.acceptedBags}</dd>
            <dt>Saleable Config:</dt>
            <dd>{state.passenger.saleableConfiguration || 'Not set'}</dd>
          </dl>
        </article>

        <article className="fi-box fi-balance-box">
          <h4>Balance Conditions</h4>
          <div className={`balance-summary-card ${balance.status}`}>
            <strong>{balance.label}</strong>
            <span>Index {balance.index.toFixed(2)}</span>
            <p>{balance.detail}</p>
          </div>
          <div className="fi-balance-head">
            <strong>AFT</strong>
            <strong>FORWARD</strong>
          </div>
          <div className="balance-row">
            <span>LIZFW</span>
            <div className="balance-track">
              {zfwMarkers.map((marker) => (
                <span key={marker.label} className="balance-marker" style={{ left: `${marker.position}%` }}>
                  <i />
                  <em>{marker.label}</em>
                </span>
              ))}
            </div>
          </div>
          <div className="balance-row">
            <span>LITOW</span>
            <div className="balance-track">
              {towMarkers.map((marker) => (
                <span key={marker.label} className="balance-marker" style={{ left: `${marker.position}%` }}>
                  <i />
                  <em>{marker.label}</em>
                </span>
              ))}
            </div>
          </div>
        </article>
      </div>
      <div className="fi-footer-actions">
        <button type="button" onClick={() => window.history.back()}>
          Back
        </button>
        <button type="button">
          Refresh Data
        </button>
        <button type="button">
          Save Snapshot
        </button>
      </div>
    </section>
  )
}
