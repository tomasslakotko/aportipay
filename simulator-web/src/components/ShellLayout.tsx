import { useEffect, useRef, useState, type PointerEvent, type TouchEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { publishChatMessage, sendChatMessage, useLiveChat } from '../persistence/chatApi'
import { closeFlightGlobally, useLiveFlightClosures } from '../persistence/flightClosureApi'
import { playNotificationSound } from '../persistence/notificationSound'
import { resolveSnappFlightId } from '../persistence/snappPassengerSync'
import { useLiveSnappFlights } from '../persistence/snappFlightApi'
import { SESSION_SAVE_EVENT } from '../persistence/SessionPersistence'
import { saveWorkspaceSession } from '../persistence/sessionApi'
import { createSimulatorSnapshot, useSimulatorStore } from '../store/useSimulatorStore'

const allTabs = [
  { to: '/', label: 'Ramp' },
  { to: '/admin', label: 'Admin' },
  { to: '/clearance', label: 'Clearance' },
  { to: '/documents', label: 'Documents' },
  { to: '/messenger', label: 'Messenger' },
  { to: '/passenger', label: 'Passenger' },
  { to: '/fuel', label: 'Fuel' },
  { to: '/freight', label: 'Freight' },
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
const getShortCommandsForRole = (role: string) => roleChatShortcuts[role.toLowerCase()] ?? defaultChatShortCommands
const getDeviceLabel = () => {
  const platform = navigator.platform || 'Unknown platform'
  const language = navigator.language || 'unknown-lang'
  const userAgent = navigator.userAgent || 'unknown-agent'
  return `${platform} | ${language} | ${userAgent.slice(0, 120)}`
}
const canAccessAdminByRole = (role: string) => /^(supervisor|admin)$/i.test(role.trim())

type MenuTile =
  | { to: string; label: string; icon: string; light?: boolean; type?: never }
  | { type: 'section'; label: string }
  | { type: 'spacer' }
  | { type: 'blank' }

const menuTiles: MenuTile[] = [
  { to: '/profile', label: 'Profile', icon: 'PR' },
  { to: '/admin', label: 'Admin', icon: 'AD', light: true },
  { to: '/accounts', label: 'Accounts', icon: 'AC', light: true },
  { to: '/search', label: 'Search', icon: 'SR' },
  { to: '/messenger', label: 'Messenger', icon: 'MS' },
  { to: '/freight', label: 'Freight', icon: 'FR', light: true },
  { to: '/commodity-codes', label: 'Commodity Codes', icon: 'CC', light: true },
  { type: 'section', label: 'Flight' },
  { to: '/', label: 'Ramp', icon: 'RA' },
  { to: '/fuel', label: 'Fuel', icon: 'FU' },
  { to: '/passenger', label: 'Passenger', icon: 'PA' },
  { to: '/documents', label: 'Documents', icon: 'DO' },
  { to: '/info', label: 'Flight Info', icon: 'FI' },
  { to: '/contacts', label: 'Contacts', icon: 'CO' },
  { type: 'spacer' },
  { to: '/about', label: 'About', icon: 'AB' },
  { type: 'blank' },
  { to: '/report', label: 'Report Issue', icon: 'RI' },
  { to: '/logout', label: 'Logout', icon: 'LO' },
]

export function ShellLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showOpenFlights, setShowOpenFlights] = useState(false)
  const [flightMessengerOpen, setFlightMessengerOpen] = useState(false)
  const [lastSeenByFlight, setLastSeenByFlight] = useState<Record<string, number>>({})
  const [flightMessageText, setFlightMessageText] = useState('')
  const [flightMessageRecipient, setFlightMessageRecipient] = useState('Ramp')
  const [flightMessagePriority, setFlightMessagePriority] = useState<'low' | 'medium' | 'high'>('high')
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveDialogMessage, setSaveDialogMessage] = useState('Saving information...')
  const [gestureMessage, setGestureMessage] = useState('')
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false)
  const [finalizeSignature, setFinalizeSignature] = useState('')
  const [finalizeStatus, setFinalizeStatus] = useState<'idle' | 'closing' | 'success' | 'error'>('idle')
  const saveDialogTimer = useRef<number | undefined>(undefined)
  const gestureTimer = useRef<number | undefined>(undefined)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const popupMessageTap = useRef<{ id: string; time: number } | null>(null)
  const prevUnreadCount = useRef(0)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingSignature = useRef(false)
  const lastSignaturePoint = useRef<{ x: number; y: number } | null>(null)
  const {
    state,
    profile,
    loginName,
    loginRole,
    openFlights,
    activeFlightIndex,
    finalizedFlights,
    finalizeActiveFlight,
    closeActiveFlight,
    setActiveFlightIndex,
  } = useSimulatorStore()
  const { closures } = useLiveFlightClosures()
  const canAccessAdmin = canAccessAdminByRole((loginRole || '').trim())
  const tabs = canAccessAdmin ? allTabs : allTabs.filter((tab) => tab.to !== '/admin')
  const visibleMenuTiles = canAccessAdmin
    ? menuTiles
    : menuTiles.filter((tile) => !('to' in tile && (tile.to === '/admin' || tile.to === '/accounts')))
  const globallyClosedLabels = new Set(closures.map((closure) => closure.flightLabel))
  const activeFlight = openFlights[activeFlightIndex]
  const { flights: snappFlights } = useLiveSnappFlights(Boolean(activeFlight))
  const activeSnappFlightId = activeFlight ? resolveSnappFlightId(activeFlight, snappFlights) : null
  const { messages: liveMessages, refresh: refreshLiveMessages } = useLiveChat(
    activeFlight ?? '',
    Boolean(activeFlight),
    activeSnappFlightId,
  )
  const shortCommands = getShortCommandsForRole(loginRole || 'ramp agent')
  const currentSeenTs = activeFlight ? (lastSeenByFlight[activeFlight] ?? 0) : 0
  const unreadCount = activeFlight
    ? liveMessages.filter((message) => {
        const createdTs = new Date(message.createdAt).getTime()
        if (Number.isNaN(createdTs) || createdTs <= currentSeenTs) return false
        if (!loginName) return true
        return !message.author.toLowerCase().includes(loginName.toLowerCase())
      }).length
    : 0
  const activeFlightFinalized = Boolean(activeFlight && (finalizedFlights[activeFlight] || globallyClosedLabels.has(activeFlight)))
  const modulesBlocked = activeFlightFinalized && location.pathname !== '/admin'
  const currentTabIndex = tabs.findIndex((tab) => tab.to === location.pathname)

  const showSaveDialog = (message = 'Updating information...') => {
    setSaveDialogMessage(message)
    setSaveDialogOpen(true)
    window.clearTimeout(saveDialogTimer.current)
    saveDialogTimer.current = window.setTimeout(() => setSaveDialogOpen(false), 3000)
  }

  useEffect(() => {
    const onSessionSaving = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      showSaveDialog(detail?.message ?? 'Updating information...')
    }

    window.addEventListener(SESSION_SAVE_EVENT, onSessionSaving)
    return () => {
      window.removeEventListener(SESSION_SAVE_EVENT, onSessionSaving)
      window.clearTimeout(saveDialogTimer.current)
      window.clearTimeout(gestureTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!activeFlight || !flightMessengerOpen) return
    setLastSeenByFlight((current) => ({ ...current, [activeFlight]: Date.now() }))
  }, [activeFlight, flightMessengerOpen, liveMessages.length])

  useEffect(() => {
    const hadUnread = prevUnreadCount.current
    if (unreadCount > hadUnread) {
      try {
        playNotificationSound(profile.notificationSound)
      } catch {
        // Ignore audio notification failures (autoplay restrictions, etc.)
      }

      if ('vibrate' in navigator) {
        navigator.vibrate?.(45)
      }
    }
    prevUnreadCount.current = unreadCount
  }, [profile.notificationSound, unreadCount])

  const showGestureMessage = (message: string) => {
    setGestureMessage(message)
    window.clearTimeout(gestureTimer.current)
    gestureTimer.current = window.setTimeout(() => setGestureMessage(''), 1300)
  }

  const selectFlightMessageRecipient = (recipient: string) => {
    setFlightMessageRecipient(recipient)
    setFlightMessagePriority(priorityForRecipient(recipient) as 'low' | 'medium' | 'high')
  }

  const markPopupMessagePublished = (messageId: string) => {
    void publishChatMessage(messageId)
      .then(() => refreshLiveMessages())
      .catch(() => {})
  }

  const handlePopupMessageTap = (messageId: string) => {
    const now = Date.now()
    if (popupMessageTap.current?.id === messageId && now - popupMessageTap.current.time < 360) {
      markPopupMessagePublished(messageId)
      popupMessageTap.current = null
      return
    }
    popupMessageTap.current = { id: messageId, time: now }
  }

  const navigateBySwipe = (direction: 'next' | 'previous') => {
    const activeIndex = currentTabIndex === -1 ? 0 : currentTabIndex
    const nextIndex =
      direction === 'next'
        ? Math.min(activeIndex + 1, tabs.length - 1)
        : Math.max(activeIndex - 1, 0)
    const nextTab = tabs[nextIndex]
    if (!nextTab || nextIndex === activeIndex) return
    navigate(nextTab.to)
    showGestureMessage(`${direction === 'next' ? 'Next' : 'Previous'}: ${nextTab.label}`)
  }

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || event.changedTouches.length !== 1) return
    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 80 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return
    navigateBySwipe(deltaX < 0 ? 'next' : 'previous')
  }

  const closeFlight = async () => {
    if (!activeFlight || !finalizeSignature.trim()) return
    setFinalizeStatus('closing')
    showSaveDialog('Closing flight...')
    try {
      await closeFlightGlobally(
        activeFlight,
        finalizeSignature,
        `${loginName || 'Unknown'} (${loginRole || 'Unknown'})`,
        getDeviceLabel(),
      )
      finalizeActiveFlight(finalizeSignature.trim())
      await saveWorkspaceSession(createSimulatorSnapshot(useSimulatorStore.getState()))
      setFinalizeStatus('success')
    } catch {
      setFinalizeStatus('error')
    }
  }

  const getSignaturePoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const drawSignatureSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawingSignature.current = false
    lastSignaturePoint.current = null
    setFinalizeSignature('')
  }

  return (
    <main className="ipad-shell">
      <header className="topbar">
        <div className="brand-block" aria-label="Flight management">
          <span className="brand-mark">a</span>
          <button
            className="brand-menu"
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ≡
          </button>
        </div>
        <div className="flight-strip-wrap">
          {openFlights.length === 0 ? (
            <div className="flight-strip closed">No open flights</div>
          ) : (
            <>
              <div className="flight-strip">
                <button
                  type="button"
                  className="strip-close"
                  title="Close current flight"
                  onClick={() => {
                    closeActiveFlight()
                    setShowOpenFlights(false)
                  }}
                >
                  ✕
                </button>
                <strong>{openFlights[activeFlightIndex]}</strong>
                <button
                  type="button"
                  className="strip-drop"
                  onClick={() => setShowOpenFlights((open) => !open)}
                  title="Switch open flight"
                >
                  ...
                </button>
              </div>
              {showOpenFlights ? (
                <div className="open-flights-list">
                  {openFlights.map((flight, index) => (
                    <button
                      key={flight}
                      type="button"
                      className={index === activeFlightIndex ? 'open-flight active' : 'open-flight'}
                      onClick={() => {
                        setActiveFlightIndex(index)
                        setShowOpenFlights(false)
                      }}
                    >
                      {flight}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="status-tools">
          <button type="button" className="overhead-more" onClick={() => setShowOpenFlights((open) => !open)}>
            ...
          </button>
          <button type="button" className="overhead-refresh" onClick={() => window.location.reload()}>
            ↻
          </button>
          <button
            type="button"
            className="overhead-message"
            onClick={() => {
              if (activeFlight) {
                setLastSeenByFlight((current) => ({ ...current, [activeFlight]: Date.now() }))
              }
              setFlightMessengerOpen(true)
            }}
            disabled={openFlights.length === 0}
          >
            ✉
            {unreadCount > 0 ? (
              <span className="message-notification-dot" aria-label={`${unreadCount} unread messages`} />
            ) : null}
          </button>
          <button
            type="button"
            className="overhead-save"
            title="Save"
            onClick={() => {
              showSaveDialog('Saving information...')
              const snapshot = createSimulatorSnapshot(useSimulatorStore.getState())
              void saveWorkspaceSession(snapshot)
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 3h13l3 3v15H4z" />
              <path d="M7 3v7h9V3" />
              <path d="M7 21v-7h10v7" />
              <path d="M14 5h2v3h-2z" />
            </svg>
          </button>
          <button
            type="button"
            className="overhead-logout"
            title="Logout"
            onClick={() => navigate('/logout')}
          >
            ⎋
          </button>
        </div>
      </header>
      {saveDialogOpen ? (
        <div className="save-loading-dialog" role="status" aria-live="polite">
          <div>
            <span className="save-spinner" />
            <strong>{saveDialogMessage}</strong>
            <p>Please wait while flight data is saved.</p>
          </div>
        </div>
      ) : null}
      {menuOpen ? (
        <div className="menu-overlay" role="dialog" aria-label="Main menu">
          <div className="menu-panel">
            <div className="menu-head">
              <span className="menu-logo">RT</span>
              <div className="menu-user">
                <strong>{loginName || 'User'}</strong>
                <span>{loginRole || 'Simulator'}</span>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)}>
                close
              </button>
            </div>
            <div className="menu-grid">
              {visibleMenuTiles.map((tile, index) => {
                if (tile.type === 'section') {
                  return (
                    <div className="menu-section" key={`${tile.label}-${index}`}>
                      {tile.label}
                    </div>
                  )
                }
                if (tile.type === 'spacer') {
                  return <div className="menu-spacer" key={`spacer-${index}`} />
                }
                if (tile.type === 'blank') {
                  return <div className="menu-blank" key={`blank-${index}`} />
                }

                return (
                  <NavLink
                    key={tile.label}
                    to={tile.to}
                    className={tile.light ? 'menu-tile light' : 'menu-tile'}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="menu-icon">{tile.icon}</span>
                    <strong>{tile.label}</strong>
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
      {flightMessengerOpen ? (
        <div className="flight-message-popup" role="dialog" aria-label="Flight messenger pop-up">
          <header>
            <strong>⚠ Messenger</strong>
            <span>{activeSnappFlightId ? 'SNAPP Ops' : 'Active flight'}</span>
            <button type="button" onClick={() => setFlightMessengerOpen(false)}>
              ×
            </button>
          </header>
          <div className="flight-message-flight">
            {openFlights[activeFlightIndex] ?? 'No active flight'}
          </div>
          <div className="flight-message-list">
            {liveMessages.length === 0 ? (
              <div className="flight-popup-empty">No real messages for this flight yet.</div>
            ) : (
              liveMessages.map((message) => (
                <div
                  key={message.id}
                  className={[
                    'flight-popup-row',
                    'sent',
                    message.priority === 'high' ? 'high' : '',
                    message.status === 'published' ? 'published' : '',
                  ].filter(Boolean).join(' ')}
                  onDoubleClick={() => markPopupMessagePublished(message.id)}
                  onTouchEnd={() => handlePopupMessageTap(message.id)}
                >
                  <strong>{message.status === 'published' ? 'PUBLISHED' : 'SENT'}</strong>
                  <span>{message.text}</span>
                  <em>{priorityLabel(message.priority)} · {message.recipient ?? 'Ramp'}</em>
                  <time>{message.createdAt}</time>
                </div>
              ))
            )}
          </div>
          <div className="flight-popup-recipients">
            {messageRecipients.map((recipient) => (
              <label key={recipient}>
                <input
                  type="radio"
                  name="flightPopupRecipient"
                  checked={flightMessageRecipient === recipient}
                  onChange={() => selectFlightMessageRecipient(recipient)}
                /> {recipient}
              </label>
            ))}
            <label>
              Priority
              <select
                value={flightMessagePriority}
                onChange={(event) => setFlightMessagePriority(event.target.value as 'low' | 'medium' | 'high')}
                disabled={flightMessageRecipient === 'Ramp'}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="flight-popup-compose">
            <div className="chat-shortcuts">
              {shortCommands.map((command) => (
                <button
                  key={command.label}
                  type="button"
                  className="shortcut-chip"
                  onClick={() => {
                    setFlightMessageText((current) =>
                      current.trim() ? `${current.trim()} ${command.text}` : command.text,
                    )
                  }}
                >
                  {command.label}
                </button>
              ))}
            </div>
            <input
              value={flightMessageText}
              onChange={(event) => setFlightMessageText(event.target.value)}
              placeholder="Write message"
            />
            <button
              type="button"
              disabled={!flightMessageText.trim()}
              onClick={() => {
                const trimmed = flightMessageText.trim()
                if (!trimmed || !activeFlight) return
                const author = `${state.flightNo} / ${loginName || 'User'}`
                void sendChatMessage({
                  flightLabel: activeFlight,
                  author,
                  text: trimmed,
                  recipient: flightMessageRecipient,
                  priority: flightMessageRecipient === 'Ramp' ? 'high' : flightMessagePriority,
                  snappFlightId: activeSnappFlightId,
                })
                  .then(() => refreshLiveMessages())
                  .then(() => setFlightMessageText(''))
                  .catch(() => {})
              }}
            >
              Send
            </button>
          </div>
          <button className="flight-popup-close" type="button" onClick={() => setFlightMessengerOpen(false)}>
            Close
          </button>
        </div>
      ) : null}

      <nav className="tabs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
            end={tab.to === '/'}
          >
            {tab.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="finalize-flight-tab"
          disabled={!activeFlight || activeFlightFinalized}
          onClick={() => {
            setFinalizeDialogOpen(true)
            setFinalizeStatus('idle')
            setFinalizeSignature('')
          }}
        >
          FINALIZE FLIGHT
        </button>
      </nav>

      {finalizeDialogOpen ? (
        <div className="modal-backdrop" role="dialog" aria-label="Finalize flight">
          <div className="finalize-modal">
            <header>
              <strong>Finalize Flight</strong>
              <button type="button" onClick={() => setFinalizeDialogOpen(false)}>×</button>
            </header>
            {finalizeStatus === 'closing' ? (
              <div className="finalize-status"><span className="save-spinner" /><strong>Closing flight...</strong></div>
            ) : finalizeStatus === 'success' ? (
              <div className="finalize-status success">
                <strong>Flight closed successfully.</strong>
                <p>{activeFlight} is now locked. Admin must unlock it before changes are allowed.</p>
                <button type="button" onClick={() => setFinalizeDialogOpen(false)}>Close</button>
              </div>
            ) : finalizeStatus === 'error' ? (
              <div className="finalize-status error">
                <strong>Could not close flight.</strong>
                <p>Please check the API connection and try again.</p>
                <button type="button" onClick={() => setFinalizeStatus('idle')}>Try Again</button>
              </div>
            ) : (
              <>
                <p>Enter your signature to close and lock this flight.</p>
                <label>
                  Signature
                  <canvas
                    ref={signatureCanvasRef}
                    className="signature-pad"
                    width={380}
                    height={140}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      const point = getSignaturePoint(event)
                      if (!point) return
                      drawingSignature.current = true
                      lastSignaturePoint.current = point
                    }}
                    onPointerMove={(event) => {
                      if (!drawingSignature.current) return
                      event.preventDefault()
                      const point = getSignaturePoint(event)
                      const previous = lastSignaturePoint.current
                      if (!point || !previous) return
                      drawSignatureSegment(previous, point)
                      lastSignaturePoint.current = point
                    }}
                    onPointerUp={() => {
                      drawingSignature.current = false
                      lastSignaturePoint.current = null
                      const canvas = signatureCanvasRef.current
                      if (!canvas) return
                      setFinalizeSignature(canvas.toDataURL('image/png'))
                    }}
                    onPointerLeave={() => {
                      drawingSignature.current = false
                      lastSignaturePoint.current = null
                    }}
                  />
                </label>
                <div className="signature-actions">
                  <button type="button" onClick={clearSignature}>Clear Signature</button>
                </div>
                <footer>
                  <button type="button" onClick={() => setFinalizeDialogOpen(false)}>Cancel</button>
                  <button type="button" disabled={!finalizeSignature.trim()} onClick={() => void closeFlight()}>
                    Close Flight
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      ) : null}

      {gestureMessage ? <div className="gesture-toast">{gestureMessage}</div> : null}

      <section className="content-grid" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className={modulesBlocked ? 'module-panel flight-locked-panel' : 'module-panel'}>
          <Outlet />
          {modulesBlocked ? (
            <div className="flight-locked-overlay">
              <strong>Flight is closed</strong>
              <p>This flight is locked. Admin must unlock it before changes are allowed.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
